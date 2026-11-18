import AppKit
import Foundation
import Observation
import os
import SwiftUI

/// 灵动岛统一状态与播放协调中心：
/// - **有博客页面播放时（浏览器伴侣模式）**：网页驱动发声，灵动岛实时展示逐字歌词、律动特效并转发遥控指令，同时将站点歌单、曲目快照与播放偏好静默同步到本地曲库；
/// - **无博客页面播放时（独立播放器模式）**：直连绑定的博客拉取歌单、歌词与音频流独立播放；若博客暂不可达，自动回退沿用上一次连接的歌单缓存与播放模式/外观设置；
/// - 具体职责已拆分为独立子模块：`StageTimelineEngine`（纯舞台时间轴求解）、`StandaloneLibraryStore`（站点曲库与持久化）、`WebBridgeSessionManager`（多标签页桥接仲裁）、`IslandStore+StandalonePlayer`（原生独立播放与跨机协同）。
@Observable
@MainActor
final class IslandStore {
    static let remotePeerVirtualClientId = UUID(uuidString: "00000000-0000-0000-8000-00000000BEEF")!
    static let autonomousVirtualClientId = UUID(uuidString: "00000000-0000-0000-8000-00000000A070")!

    struct StripRenderItem: Identifiable, Equatable {
        var id: String { "\(trackId)-\(lineIndex)" }
        let trackId: Int
        let lineIndex: Int
        let line: LyricLinePayload
        let nextLineStart: Double?
        let slot: StripSlotAssignment?
        let isFocus: Bool
    }

    struct ResolvedMoment: Equatable {
        enum Kind: Equatable {
            case narration
            case comment(liked: Int)
        }
        let kind: Kind
        let text: String
    }

    @ObservationIgnored let logger = Logger(subsystem: "org.liteyuki.NeoBlogIsland", category: "IslandStore")
    @ObservationIgnored let networkServicesEnabled: Bool
    @ObservationIgnored let bridgeServer = LocalBridgeServer()
    @ObservationIgnored let webSessions = WebBridgeSessionManager()
    let peerService: PeerContinuityService
    let updater: AppUpdateService
    let library: StandaloneLibraryStore
    let nativeAudio: NativeAudioEngine
    let debrisEngine = DebrisEngine()
    let stageSpringEngine = StageSpringEngine()
    let compactStageParticles = StageParticlesEngine(scale: 0.7, maxParticles: 20)
    let expandedStageParticles = StageParticlesEngine(scale: 0.7, maxParticles: 80)

    @ObservationIgnored var snapshotHealTask: Task<Void, Never>?
    @ObservationIgnored var pendingTabFocus: (token: String, origin: String, userAgent: String, timeoutTask: Task<Void, Never>)? = nil
    @ObservationIgnored var portPollTimer: Timer?
    @ObservationIgnored var disconnectTakeoverTask: Task<Void, Never>?
    @ObservationIgnored var standaloneColdLaunchTask: Task<Void, Never>?
    @ObservationIgnored var autonomousResolveTask: Task<Void, Never>?
    @ObservationIgnored var autonomousPrewarmTask: Task<Void, Never>?
    @ObservationIgnored var autonomousPeekTask: Task<Void, Never>?
    @ObservationIgnored var autonomousPauseSettleTask: Task<Void, Never>?
    @ObservationIgnored var autonomousMirrorGlowTask: Task<Void, Never>?
    @ObservationIgnored var autonomousStatePatchThrottleTask: Task<Void, Never>?
    @ObservationIgnored var lastAutonomousStatePatchSentAt: Date = .distantPast
    @ObservationIgnored var consecutiveAutonomousFailures: Int = 0
    @ObservationIgnored var autonomousTrackStartAnchorMs: Double = 0
    @ObservationIgnored var fallbackSnapshotBeforeFailure: StandaloneLibraryStore.CachedTrackSnapshot? = nil
    @ObservationIgnored var lastIslandPauseCommandAt: Date = .distantPast
    @ObservationIgnored var disconnectTakeoverDelayMs: Int = 280
    @ObservationIgnored var autonomousSessionStorage: AutonomousSessionPayload? = nil
    /// 区分「浏览器断联自动续播」与「用户主动开启独立播放器」（主动独立播放时新开普通文章页不被动抢回音频）
    @ObservationIgnored var standaloneInitiatedFromBrowserDisconnect: Bool = false
    /// 意外 AWDL 闪断前的双机同显状态（仅在本机作为播放源持有者且非手动断开时记录，重连成功后无缝恢复同显）
    @ObservationIgnored var ownershipBeforeUnexpectedPeerDrop: PeerDisplayOwnership? = nil

    private var isLocalPlaybackSourceOwner: Bool {
        if let auto = autonomousSessionStorage {
            return auto.audioOwnerPeerId == peerService.localPeerId
        }
        guard let activeId = activeClientId,
              activeId != Self.remotePeerVirtualClientId,
              let session = webSessions[activeId] else {
            return false
        }
        return session.hasActivePlayerSession && track != nil
    }

    private(set) var isAutonomousMode: Bool = false
    private(set) var autonomousOrigin: String = ""
    private(set) var autonomousSourceHostPeerId: String = ""
    private(set) var autonomousAudioOwnerPeerId: String = ""
    private(set) var isAutonomousBuffering: Bool = false

    /// 供测试与诊断读取当前独立播放会话快照（不触发 @Observable 高频字段订阅）
    var autonomousSession: AutonomousSessionPayload? {
        autonomousSessionStorage
    }

    private(set) var activeClientId: UUID?
    private(set) var connectedOrigins: [String] = []
    private(set) var boundPort: UInt16 = 29170

    private(set) var track: IslandTrack?
    var effectiveDurationMs: Double = 0
    var accentHex: String?
    var chorusRanges: [TimeIntervalRange] = []
    private(set) var lyrics: LyricsBundlePayload = .empty
    private(set) var indexedLines: [IndexedLyricLine] = []
    private(set) var stageEntries: [StageTimelineEntry] = []
    var lyricStatus: String = "ready"
    var lyricSourcesPending: Bool = false
    var rhythm: RhythmEngineContext = .fallback
    var playlist: [PlaylistTrackItem] = []
    var playlistComplete: Bool = false
    var currentIndex: Int?

    var webVisible: Bool = false
    var showPlaying: Bool = false
    var isPlaying: Bool = false
    var pendingStep: Int? = nil
    var playMode: PlayMode = .repeatAll
    var volume: Double = 0.85
    var isMuted: Bool = false
    var peekText: String?
    var pausedText: String?
    var glow: IslandGlowPayload?
    var preferences: IslandLyricPreferences = .default
    var config: IslandDisplayConfig = .default
    var seekAtMs: Double = -.infinity

    private var pausedClockRevision: UInt64 = 0
    @ObservationIgnored var anchorPositionMs: Double = 0 {
        didSet {
            let clockFrozen = !isPlaying || (isAutonomousMode && isAutonomousBuffering)
            if clockFrozen && abs(anchorPositionMs - oldValue) > 0.5 {
                pausedClockRevision &+= 1
            }
        }
    }
    @ObservationIgnored var anchorLocalDate: Date = Date()

    var isExpanded: Bool = false
    var isHovering: Bool = false
    var showPlaylistOverlay: Bool = false
    var isDockedInMenuBar: Bool = false
    var expandsUpward: Bool = false
    var isDraggingCapsule: Bool = false
    var hasCustomCapsulePosition: Bool = false
    var isPositionLocked: Bool = UserDefaults.standard.bool(forKey: "NeoBlogIsland.positionLocked")
    var startupBannerText: String? = "桌面灵动岛已就绪 · 支持独立播放与博客伴随"
    var hiddenTrackId: Int? = nil

    // 跨 Mac AWDL 点对点接力与传送门状态
    var displayOwnership: PeerDisplayOwnership = .singleActiveMac
    var activeOwnerPeerId: String? = nil
    var portalDragTargetEdge: PortalEdge? = nil
    var incomingPortalPreview: PeerPortalPayload? = nil
    @ObservationIgnored var lastSentPortalPreview: PeerPortalPayload? = nil

    @ObservationIgnored var onRequestKeyFocus: (() -> Void)?
    @ObservationIgnored var onReleaseKeyFocus: ((Bool) -> Void)?
    @ObservationIgnored var onResetCapsulePosition: (() -> Void)?
    @ObservationIgnored var onLayoutTriggerChanged: (() -> Void)?
    @ObservationIgnored var onReceivePortalArrival: ((PeerPortalPayload) -> Void)?
    @ObservationIgnored var onInterceptCommandForTest: ((OutgoingCommand) -> Void)?
    @ObservationIgnored var scrubberCanvasRect: CGRect = .zero
    @ObservationIgnored private var lastDragEndedAt: Date = .distantPast

    var shouldSuppressTapAfterDrag: Bool {
        Date().timeIntervalSince(lastDragEndedAt) < 0.18
    }

    func markDragEnded() {
        lastDragEndedAt = Date()
    }

    func requestKeyFocus() {
        onRequestKeyFocus?()
    }

    func releaseKeyFocus(restorePreviousApp: Bool = true) {
        onReleaseKeyFocus?(restorePreviousApp)
    }

    func resetCapsulePosition() {
        onResetCapsulePosition?()
    }

    func togglePositionLock() {
        isPositionLocked.toggle()
        UserDefaults.standard.set(isPositionLocked, forKey: "NeoBlogIsland.positionLocked")
    }

    /// 当前是否正由网页浏览器（本机或跨屏镜像）驱动展示
    var isBrowserCompanionMode: Bool {
        !isAutonomousMode && (!connectedOrigins.isEmpty || isDisplayingRemotePeerSession)
    }

    var isLocalAutonomousAudioOwner: Bool {
        guard isAutonomousMode else { return false }
        return autonomousAudioOwnerPeerId == peerService.localPeerId
    }

    var autonomousAudioOwnerLabel: String {
        guard isAutonomousMode else { return "" }
        if autonomousAudioOwnerPeerId == peerService.localPeerId {
            return "本机"
        }
        return peerService.connectedPeerName ?? "跨屏 Mac"
    }

    var isDisplayingRemotePeerSession: Bool {
        if isAutonomousMode {
            return autonomousSourceHostPeerId != peerService.localPeerId
        }
        return activeClientId == Self.remotePeerVirtualClientId
    }

    var canPortalThrowToPeer: Bool {
        guard peerService.isConnected, track != nil else { return false }
        if isAutonomousMode && !peerService.peerSupportsAutonomousContinuity {
            return false
        }
        return true
    }

    var isIslandHandedOffToPeer: Bool {
        guard peerService.isConnected, displayOwnership == .singleActiveMac else {
            return false
        }
        if isAutonomousMode {
            if !peerService.peerSupportsAutonomousContinuity {
                return autonomousSourceHostPeerId != peerService.localPeerId
            }
            let effectiveOwner = activeOwnerPeerId ?? autonomousSourceHostPeerId
            return effectiveOwner != peerService.localPeerId
        }
        if let owner = activeOwnerPeerId {
            return owner != peerService.localPeerId
        }
        return isDisplayingRemotePeerSession
    }

    var shouldDisplayIsland: Bool {
        if peerService.pendingPairRequest != nil { return true }
        if startupBannerText != nil { return true }
        if incomingPortalPreview != nil && track != nil { return true }
        guard activeClientId != nil, let track else { return false }
        if hiddenTrackId == track.id { return false }
        if isIslandHandedOffToPeer { return false }
        if isExpanded { return true }
        return webVisible
    }

    var accentColor: Color {
        Color(cssColor: glow?.color ?? accentHex)
    }

    /// 供音量 Slider 通过 @Bindable KeyPath ($store.sliderVolume) 绑定，避免在视图 body 中构造闭包 Binding
    var sliderVolume: Double {
        get { isMuted ? 0 : volume }
        set { setVolume(newValue) }
    }

    init(
        startNetworkServices: Bool = true,
        peerService: PeerContinuityService? = nil,
        libraryStore: StandaloneLibraryStore? = nil
    ) {
        self.networkServicesEnabled = startNetworkServices
        self.peerService = peerService ?? PeerContinuityService()
        self.updater = AppUpdateService(startBackgroundCheck: startNetworkServices)
        let resolvedLibrary = libraryStore ?? (
            startNetworkServices
                ? StandaloneLibraryStore(networkEnabled: true)
                : StandaloneLibraryStore.inMemoryForTesting()
        )
        self.library = resolvedLibrary
        self.nativeAudio = NativeAudioEngine(simulationMode: !startNetworkServices)
        self.disconnectTakeoverDelayMs = startNetworkServices ? 280 : 0

        // 启动即恢复上一次连接或独立播放保存的播放模式、音量、形态开关与多语翻译偏好
        let saved = resolvedLibrary.savedSettings
        self.playMode = saved.playMode
        self.volume = saved.volume
        self.isMuted = saved.isMuted
        self.preferences = saved.preferences
        self.config = saved.config
        if !resolvedLibrary.playlist.isEmpty {
            self.playlist = resolvedLibrary.playlist
            self.playlistComplete = true
        }

        setupNativeAudioCallbacks()
        setupPeerCallbacks()
        if startNetworkServices {
            setupBridge()
            self.peerService.start()
            resolvedLibrary.refreshOnLaunchIfConfigured()
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.8) { [weak self] in
                withAnimation(.spring(duration: 0.38, bounce: 0.22)) {
                    self?.startupBannerText = nil
                }
            }
        } else {
            self.startupBannerText = nil
        }
    }

    // MARK: - 舞台与时间轴派生接口（委托给纯函数式 StageTimelineEngine）

    func setTrack(_ nextTrack: IslandTrack?) {
        track = nextTrack
    }

    func setActiveClientId(_ nextId: UUID?) {
        activeClientId = nextId
    }

    func setAutonomousFlags(
        active: Bool,
        origin: String,
        sourceHost: String,
        audioOwner: String,
        buffering: Bool? = nil
    ) {
        if isAutonomousMode != active { isAutonomousMode = active }
        if autonomousOrigin != origin { autonomousOrigin = origin }
        if autonomousSourceHostPeerId != sourceHost { autonomousSourceHostPeerId = sourceHost }
        if autonomousAudioOwnerPeerId != audioOwner { autonomousAudioOwnerPeerId = audioOwner }
        if let buffering, isAutonomousBuffering != buffering {
            isAutonomousBuffering = buffering
        } else if !active && isAutonomousBuffering {
            isAutonomousBuffering = false
        }
    }

    func setAutonomousBuffering(_ buffering: Bool) {
        if isAutonomousBuffering != buffering {
            isAutonomousBuffering = buffering
        }
    }

    func currentPositionMs(at date: Date = Date()) -> Double {
        let clockAdvancing = isPlaying && (!isAutonomousMode || !isAutonomousBuffering)
        if !clockAdvancing {
            _ = pausedClockRevision
        }
        let raw = clockAdvancing
            ? anchorPositionMs + date.timeIntervalSince(anchorLocalDate) * 1000.0
            : anchorPositionMs
        if effectiveDurationMs > 0 {
            return max(0, min(effectiveDurationMs, raw))
        }
        return max(0, raw)
    }

    func activeInterlude(at ms: Double) -> TimeIntervalRange? {
        StageTimelineEngine.activeInterlude(in: lyrics, at: ms)
    }

    func spotlightState(at ms: Double) -> (line: Int, level: Double)? {
        guard preferences.showLyricEffects else { return nil }
        return StageSignalsSolver.spotlightAt(lyrics: lyrics, timeMs: ms)
    }

    func stageSignals(at ms: Double) -> StageSignalsSnapshot {
        guard preferences.showLyricEffects else { return .zero }
        return StageSignalsSolver.compute(
            lyrics: lyrics,
            chorusRanges: chorusRanges,
            rhythm: rhythm,
            timeMs: ms
        )
    }

    func activeMoment(at ms: Double) -> ResolvedMoment? {
        StageTimelineEngine.activeMoment(
            lyrics: lyrics,
            effectiveDurationMs: effectiveDurationMs,
            showMoments: preferences.showLyricMoments,
            at: ms
        )
    }

    func timelineState(at ms: Double) -> (active: [Int], focus: Int?, interlude: TimeIntervalRange?) {
        StageTimelineEngine.timelineState(lyrics: lyrics, at: ms)
    }

    func stripRenderItems(at ms: Double) -> (items: [StripRenderItem], interlude: TimeIntervalRange?) {
        StageTimelineEngine.stripRenderItems(lyrics: lyrics, trackId: track?.id ?? 0, at: ms)
    }

    func updateLyrics(_ nextLyrics: LyricsBundlePayload, trackId: Int?) {
        let tid = trackId ?? 0
        if lyrics == nextLyrics && indexedLines.first?.id.hasPrefix("\(tid)-") == true {
            return
        }
        lyrics = nextLyrics
        let built = StageTimelineEngine.buildStageArtifacts(from: nextLyrics, trackId: trackId)
        indexedLines = built.indexedLines
        stageEntries = built.stageEntries
    }

    func resetStageVisualEngines() {
        debrisEngine.reset()
        stageSpringEngine.reset()
        compactStageParticles.reset()
        expandedStageParticles.reset()
    }

    func copyFormattedLyricsToPasteboard() -> Bool {
        guard let fullText = StageTimelineEngine.formatLyricsForClipboard(
            track: track,
            lyrics: lyrics,
            preferences: preferences
        ) else {
            return false
        }
        let pb = NSPasteboard.general
        pb.clearContents()
        return pb.setString(fullText, forType: .string)
    }

    // MARK: - 统一播放控制指令路由（独立播放器 / 浏览器伴侣 / 跨屏遥控）

    func sendCommand(_ command: OutgoingCommand) {
        onInterceptCommandForTest?(command)
        if isAutonomousMode {
            if isLocalAutonomousAudioOwner || !peerService.isConnected {
                executeAutonomousCommand(command)
            } else {
                peerService.sendRemoteCommand(command)
            }
            return
        }
        if activeClientId == Self.remotePeerVirtualClientId {
            peerService.sendRemoteCommand(command)
        } else if activeClientId != nil {
            bridgeServer.sendCommand(command, to: activeClientId)
        } else if library.hasBoundOrigin {
            // 无浏览器在线且尚未激活独立会话时，点击播放自动冷启动独立播放器
            if command.action == "play" || command.action == "toggle" {
                startStandalonePlayback(autoPlay: true)
            }
        }
    }

    func play() { sendCommand(OutgoingCommand(action: "play")) }

    func pause() {
        lastIslandPauseCommandAt = Date()
        sendCommand(OutgoingCommand(action: "pause"))
    }

    func togglePlay() {
        if isPlaying {
            lastIslandPauseCommandAt = Date()
        }
        sendCommand(OutgoingCommand(action: "toggle"))
    }

    func nextTrack() {
        optimisticallySwitchToAdjacent(direction: 1)
        sendCommand(OutgoingCommand(action: "next"))
    }

    func prevTrack() {
        optimisticallySwitchToAdjacent(direction: -1)
        sendCommand(OutgoingCommand(action: "prev"))
    }

    func seek(toMs ms: Double) {
        let maxBound = effectiveDurationMs > 0 ? effectiveDurationMs : .infinity
        let clamped = max(0, min(maxBound, ms))
        seekAtMs = clamped
        anchorPositionMs = clamped
        anchorLocalDate = Date()
        sendCommand(OutgoingCommand(action: "seek", positionMs: clamped))
    }

    func playTrack(at index: Int) {
        showPlaylistOverlay = false
        releaseKeyFocus(restorePreviousApp: true)
        if !isAutonomousMode,
           let activeId = activeClientId,
           var session = webSessions[activeId],
           let item = session.playlist.first(where: { $0.index == index }) {
            applyOptimisticPreloadIfAvailable(trackId: item.id, session: &session, activeId: activeId)
        }
        sendCommand(OutgoingCommand(action: "play_track", index: index))
    }

    func cyclePlayMode() {
        sendCommand(OutgoingCommand(action: "set_mode", playMode: playMode.next()))
    }

    func setVolume(_ val: Double) {
        let clamped = max(0, min(1, val))
        volume = clamped
        if isMuted && clamped > 0.001 {
            isMuted = false
        }
        sendCommand(OutgoingCommand(action: "set_volume", volume: clamped))
    }

    func toggleMuted() { sendCommand(OutgoingCommand(action: "toggle_muted")) }
    func toggleTranslation() { sendCommand(OutgoingCommand(action: "toggle_translation")) }
    func toggleRomaji() { sendCommand(OutgoingCommand(action: "toggle_romaji")) }
    func toggleEffects() { sendCommand(OutgoingCommand(action: "toggle_effects")) }
    func toggleMoments() { sendCommand(OutgoingCommand(action: "toggle_moments")) }
    func toggleHdr() { sendCommand(OutgoingCommand(action: "toggle_hdr")) }
    func refreshLyrics() { sendCommand(OutgoingCommand(action: "refresh_lyrics")) }
    func resetTranslationLangs() { sendCommand(OutgoingCommand(action: "reset_translation_langs")) }

    func toggleTranslationLang(lang: String, preferNative: Bool, hasDualSources: Bool) {
        sendCommand(
            OutgoingCommand(
                action: "toggle_translation_lang",
                lang: lang,
                preferNative: preferNative,
                hasDualSources: hasDualSources
            )
        )
    }

    func requestFullPlaylistIfNeeded() {
        if !playlistComplete {
            sendCommand(OutgoingCommand(action: "ensure_playlist"))
        }
    }

    func hideCurrentTrack() {
        if isAutonomousMode {
            stopAutonomousPlayback(notifyPeer: true)
            return
        }
        guard let id = track?.id else { return }
        withAnimation(.spring(duration: 0.34, bounce: 0.2)) {
            isExpanded = false
            showPlaylistOverlay = false
            hiddenTrackId = id
        }
    }

    // MARK: - 跨 Mac 边缘传送门投送 / 双机同显 / 召回

    func updatePortalDragPreview(_ payload: PeerPortalPayload?) {
        let nextEdge = payload?.fromEdge
        if portalDragTargetEdge != nextEdge {
            withAnimation(.easeOut(duration: 0.16)) {
                portalDragTargetEdge = nextEdge
            }
        }
        guard peerService.isConnected else { return }
        if lastSentPortalPreview != payload {
            lastSentPortalPreview = payload
            peerService.sendPortalPreview(payload)
        }
    }

    func commitPortalThrow(_ payload: PeerPortalPayload) {
        ownershipBeforeUnexpectedPeerDrop = nil
        lastSentPortalPreview = nil
        portalDragTargetEdge = nil
        if isAutonomousMode && !peerService.peerSupportsAutonomousContinuity {
            return
        }
        guard let remoteId = peerService.connectedPeerId else { return }
        withAnimation(.spring(duration: 0.34, bounce: 0.18)) {
            isExpanded = false
            showPlaylistOverlay = false
            displayOwnership = .singleActiveMac
            activeOwnerPeerId = remoteId
        }
        peerService.sendPortalThrow(payload)
        reconcileAutonomousOwnershipTransition()
        onLayoutTriggerChanged?()
    }

    func handoffToConnectedPeer() {
        ownershipBeforeUnexpectedPeerDrop = nil
        let payload = PeerPortalPayload(
            fromEdge: .right,
            offsetFromTopPt: isDockedInMenuBar ? 14 : 28,
            dockedInMenuBar: isDockedInMenuBar
        )
        commitPortalThrow(payload)
    }

    func recallIslandToThisMac() {
        ownershipBeforeUnexpectedPeerDrop = nil
        withAnimation(.spring(duration: 0.34, bounce: 0.22)) {
            displayOwnership = .singleActiveMac
            activeOwnerPeerId = peerService.localPeerId
            incomingPortalPreview = nil
        }
        peerService.sendOwnershipUpdate(mode: .singleActiveMac, activeOwnerPeerId: peerService.localPeerId)
        reconcileAutonomousOwnershipTransition()
        onLayoutTriggerChanged?()
    }

    func toggleMirrorBothMacs() {
        ownershipBeforeUnexpectedPeerDrop = nil
        let nextMode: PeerDisplayOwnership = (displayOwnership == .mirrorBothMacs) ? .singleActiveMac : .mirrorBothMacs
        let nextOwner = (nextMode == .singleActiveMac) ? peerService.localPeerId : nil
        withAnimation(.spring(duration: 0.34, bounce: 0.22)) {
            displayOwnership = nextMode
            activeOwnerPeerId = nextOwner
            incomingPortalPreview = nil
        }
        peerService.sendOwnershipUpdate(mode: nextMode, activeOwnerPeerId: nextOwner)
        reconcileAutonomousOwnershipTransition()
        onLayoutTriggerChanged?()
    }

    // MARK: - 网页播放器页唤醒与反向接管

    func openBlogPlayerPage() {
        releaseKeyFocus(restorePreviousApp: false)
        withAnimation(.spring(duration: 0.34, bounce: 0.2)) {
            isExpanded = false
            showPlaylistOverlay = false
        }
        if let auto = autonomousSessionStorage {
            let hasLocalBrowser = webSessions.sessions.values.contains {
                $0.clientId != Self.remotePeerVirtualClientId && Self.isSameOrigin($0.origin, auto.origin)
            }
            let isLoopback = Self.isLoopbackOrigin(auto.origin)
            if !hasLocalBrowser && auto.sourceHostPeerId != peerService.localPeerId && peerService.isConnected
                && (displayOwnership == .mirrorBothMacs || isLoopback) {
                peerService.sendRemoteCommand(OutgoingCommand(action: "open_player_page"))
                return
            }
            openLocalBrowserPlayerTab()
            return
        }
        if isDisplayingRemotePeerSession && peerService.isConnected {
            peerService.sendRemoteCommand(OutgoingCommand(action: "open_player_page"))
            return
        }
        openLocalBrowserPlayerTab()
    }

    func openLocalBrowserPlayerTab() {
        let targetId: UUID?
        if let auto = autonomousSessionStorage {
            targetId = webSessions.preferredLocalClient(activeClientId: activeClientId, matchingOrigin: auto.origin)
        } else {
            targetId = webSessions.preferredLocalClient(activeClientId: activeClientId)
        }
        let session = targetId.flatMap { webSessions[$0] }
        let origin = session?.origin
            ?? autonomousSessionStorage?.origin
            ?? connectedOrigins.first
            ?? library.boundOrigin
        let userAgent = session?.userAgent ?? ""
        let token = "nbf_\(UUID().uuidString.prefix(8).lowercased())"

        onInterceptCommandForTest?(OutgoingCommand(action: "open_player_page", focusToken: token))

        if targetId == nil, !origin.isEmpty {
            let base = origin.hasSuffix("/") ? String(origin.dropLast()) : origin
            let suffix = isAutonomousMode ? "/music?island_handoff=1" : "/music"
            if networkServicesEnabled, let url = URL(string: "\(base)\(suffix)") {
                NSWorkspace.shared.open(url)
            }
            return
        }

        if let targetId, isAutonomousMode {
            sendAdoptCommandToBrowserClient(targetId, force: true)
        }

        pendingTabFocus?.timeoutTask.cancel()
        let timeoutTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(90))
            guard !Task.isCancelled, let self, let pending = self.pendingTabFocus, pending.token == token else {
                return
            }
            self.pendingTabFocus = nil
            if self.networkServicesEnabled {
                BrowserTabActivator.activatePlayingTab(
                    origin: pending.origin,
                    focusToken: pending.token,
                    userAgent: pending.userAgent
                )
            }
        }
        pendingTabFocus = (token: token, origin: origin, userAgent: userAgent, timeoutTask: timeoutTask)
        bridgeServer.sendCommand(OutgoingCommand(action: "open_player_page", focusToken: token), to: targetId)
    }

    // MARK: - 本地浏览器 WebSocket 桥接与跨机 AWDL 回调装配

    private func setupBridge() {
        bridgeServer.onClientsChanged = { [weak self] metas in
            guard let self else { return }
            let realOrigins = metas.map(\.origin).filter { $0 != "connecting" && !$0.isEmpty }
            let sorted = Array(Set(realOrigins)).sorted()
            if self.connectedOrigins != sorted {
                self.connectedOrigins = sorted
            }
            if self.bridgeServer.boundPort > 0 && self.boundPort != self.bridgeServer.boundPort {
                self.boundPort = self.bridgeServer.boundPort
            }
        }

        bridgeServer.onClientDisconnected = { [weak self] clientId, _ in
            self?.handleLocalClientDisconnected(clientId)
        }

        bridgeServer.onRawJSONMessage = { [weak self] clientId, meta, data in
            self?.handleIncomingPayload(clientId: clientId, meta: meta, data: data)
        }

        bridgeServer.start()

        portPollTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                if self.bridgeServer.boundPort > 0 {
                    self.boundPort = self.bridgeServer.boundPort
                    self.portPollTimer?.invalidate()
                    self.portPollTimer = nil
                }
            }
        }
    }

    private func setupPeerCallbacks() {
        peerService.onPeerAuthenticated = { [weak self] _, _ in
            guard let self else { return }
            let restoreMirror = (self.ownershipBeforeUnexpectedPeerDrop == .mirrorBothMacs)
            self.ownershipBeforeUnexpectedPeerDrop = nil

            if let auto = self.autonomousSessionStorage {
                guard auto.audioOwnerPeerId == self.peerService.localPeerId else { return }
                if restoreMirror {
                    self.displayOwnership = .mirrorBothMacs
                    self.activeOwnerPeerId = nil
                } else if self.displayOwnership == .singleActiveMac && self.activeOwnerPeerId == nil {
                    self.activeOwnerPeerId = self.peerService.localPeerId
                }
                if self.peerService.peerSupportsAutonomousContinuity {
                    // 单包原子同步会话快照与显示归属权，避免双机离线各自起播后相遇时先到的 ownershipUpdate 冲毁本地裁决状态
                    self.broadcastAutonomousFullSyncToPeer()
                } else {
                    self.peerService.sendOwnershipUpdate(mode: self.displayOwnership, activeOwnerPeerId: self.activeOwnerPeerId)
                }
                self.onLayoutTriggerChanged?()
            } else {
                let hasLocalBrowserSession = self.isLocalPlaybackSourceOwner
                if restoreMirror && hasLocalBrowserSession {
                    self.displayOwnership = .mirrorBothMacs
                    self.activeOwnerPeerId = nil
                }
                if self.displayOwnership == .mirrorBothMacs && hasLocalBrowserSession {
                    self.peerService.sendOwnershipUpdate(mode: .mirrorBothMacs, activeOwnerPeerId: nil)
                }
                self.pushFullSnapshotToConnectedPeer()
            }
        }

        peerService.onPeerDisconnected = { [weak self] _ in
            guard let self else { return }
            if self.peerService.isAutoReconnectPausedByUser || !self.isLocalPlaybackSourceOwner {
                self.ownershipBeforeUnexpectedPeerDrop = nil
            } else if self.displayOwnership == .mirrorBothMacs {
                self.ownershipBeforeUnexpectedPeerDrop = .mirrorBothMacs
            }
            self.incomingPortalPreview = nil
            self.portalDragTargetEdge = nil
            self.lastSentPortalPreview = nil
            let removedMirrorSession = self.webSessions.removeSession(Self.remotePeerVirtualClientId) != nil
            self.displayOwnership = .singleActiveMac

            if let auto = self.autonomousSessionStorage {
                if auto.audioOwnerPeerId == self.peerService.localPeerId {
                    self.activeOwnerPeerId = self.peerService.localPeerId
                    self.ensureLocalAutonomousAudioMatchesState()
                    self.refreshAutonomousMirrorGlowWatcher()
                } else {
                    self.activeOwnerPeerId = nil
                    self.exitAutonomousPlayback(adoptedByLocalClient: nil, notifyPeer: false)
                }
                self.onLayoutTriggerChanged?()
                return
            }

            self.activeOwnerPeerId = nil
            if removedMirrorSession, self.activeClientId == Self.remotePeerVirtualClientId {
                self.electNextActiveTab()
            }
            self.onLayoutTriggerChanged?()
        }

        peerService.onReceiveFullSnapshot = { [weak self] snap in
            guard let self else { return }
            if self.isAutonomousMode {
                let decodedState = snap.stateRawJSON.flatMap {
                    self.decodeJSON(WebStateMessage.self, from: $0, label: "peer-snapshot-state")
                }
                let peerBrowserPlaying = snap.isPlaying
                    && (decodedState == nil || (decodedState!.isPlaying && (decodedState!.audioPlaying ?? true)))
                guard peerBrowserPlaying else { return }
                self.exitAutonomousPlayback(adoptedByLocalClient: nil, notifyPeer: false)
            }
            let peerOrigin = "peer://\(self.peerService.connectedPeerName ?? "Mac")"
            let meta = LocalBridgeServer.ClientMeta(
                id: Self.remotePeerVirtualClientId,
                tabId: "peer-mirror",
                origin: peerOrigin
            )
            if let media = snap.mediaRawJSON {
                self.handleIncomingPayload(clientId: Self.remotePeerVirtualClientId, meta: meta, data: media, fromPeer: true, peerLivePosMs: nil)
            }
            if let rhythm = snap.rhythmRawJSON {
                self.handleIncomingPayload(clientId: Self.remotePeerVirtualClientId, meta: meta, data: rhythm, fromPeer: true, peerLivePosMs: nil)
            }
            if let playlist = snap.playlistRawJSON {
                self.handleIncomingPayload(clientId: Self.remotePeerVirtualClientId, meta: meta, data: playlist, fromPeer: true, peerLivePosMs: nil)
            }
            if let preload = snap.preloadRawJSON {
                self.handleIncomingPayload(clientId: Self.remotePeerVirtualClientId, meta: meta, data: preload, fromPeer: true, peerLivePosMs: nil)
            }
            if let state = snap.stateRawJSON {
                self.handleIncomingPayload(clientId: Self.remotePeerVirtualClientId, meta: meta, data: state, fromPeer: true, peerLivePosMs: snap.livePositionMs)
            }
        }

        peerService.onReceiveBridgeFrame = { [weak self] raw, livePosMs in
            guard let self else { return }
            let peerOrigin = "peer://\(self.peerService.connectedPeerName ?? "Mac")"
            let meta = LocalBridgeServer.ClientMeta(
                id: Self.remotePeerVirtualClientId,
                tabId: "peer-mirror",
                origin: peerOrigin
            )
            self.handleIncomingPayload(
                clientId: Self.remotePeerVirtualClientId,
                meta: meta,
                data: raw,
                fromPeer: true,
                peerLivePosMs: livePosMs
            )
        }

        peerService.onReceiveRemoteCommand = { [weak self] cmd in
            guard let self else { return }
            if cmd.action == "pause" || (cmd.action == "toggle" && self.isPlaying) {
                self.lastIslandPauseCommandAt = Date()
            }
            if cmd.action == "open_player_page" {
                self.openLocalBrowserPlayerTab()
                return
            }
            if self.isAutonomousMode {
                self.onInterceptCommandForTest?(cmd)
                self.executeAutonomousCommand(cmd)
                return
            }
            let localClient = self.webSessions.preferredLocalClient(activeClientId: self.activeClientId)
            self.onInterceptCommandForTest?(cmd)
            if let localClient {
                self.bridgeServer.sendCommand(cmd, to: localClient)
            }
        }

        peerService.onReceivePortalPreview = { [weak self] preview in
            guard let self else { return }
            withAnimation(.spring(duration: 0.26, bounce: 0.14)) {
                self.incomingPortalPreview = preview
            }
            if let preview {
                self.onReceivePortalArrival?(preview)
            } else {
                self.onLayoutTriggerChanged?()
            }
        }

        peerService.onReceivePortalThrow = { [weak self] portal in
            guard let self else { return }
            withAnimation(.spring(duration: 0.36, bounce: 0.22)) {
                self.incomingPortalPreview = nil
                self.displayOwnership = .singleActiveMac
                self.activeOwnerPeerId = self.peerService.localPeerId
                self.isExpanded = portal.isExpanded ?? false
                self.showPlaylistOverlay = false
                self.startupBannerText = nil
                self.hiddenTrackId = nil
            }
            self.reconcileAutonomousOwnershipTransition()
            self.onReceivePortalArrival?(portal)
        }

        peerService.onReceiveOwnershipUpdate = { [weak self] mode, ownerId in
            guard let self else { return }
            withAnimation(.spring(duration: 0.34, bounce: 0.20)) {
                self.incomingPortalPreview = nil
                self.displayOwnership = mode
                self.activeOwnerPeerId = ownerId
                if mode == .singleActiveMac && ownerId != self.peerService.localPeerId {
                    self.isExpanded = false
                    self.showPlaylistOverlay = false
                }
            }
            self.reconcileAutonomousOwnershipTransition()
            self.onLayoutTriggerChanged?()
        }

        peerService.onReceiveAutonomousSync = { [weak self] payload in
            self?.applyIncomingAutonomousSync(payload)
        }

        peerService.onReceiveAutonomousStatePatch = { [weak self] patch in
            self?.applyIncomingAutonomousStatePatch(patch)
        }

        peerService.onReceiveAutonomousStop = { [weak self] in
            self?.exitAutonomousPlayback(adoptedByLocalClient: nil, notifyPeer: false)
        }
    }

    func pushFullSnapshotToConnectedPeer() {
        guard peerService.isConnected else { return }
        guard let activeId = activeClientId,
              activeId != Self.remotePeerVirtualClientId,
              let session = webSessions[activeId] else {
            return
        }
        let snap = PeerFullSnapshot(
            mediaRawJSON: session.lastMediaRawJSON,
            rhythmRawJSON: session.lastRhythmRawJSON,
            playlistRawJSON: session.lastPlaylistRawJSON,
            stateRawJSON: session.lastStateRawJSON,
            preloadRawJSON: session.lastPreloadRawJSON,
            livePositionMs: currentPositionMs(),
            isPlaying: isPlaying
        )
        peerService.sendFullSnapshot(snap)
    }

    // MARK: - 浏览器帧解码与会话同步

    private struct EnvelopeProbe: Decodable {
        let type: String
        let tab_id: String?
        let origin: String?
        let user_agent: String?
        let focus_token: String?
        let force: Bool?
    }

    func decodeJSON<T: Decodable>(_ type: T.Type, from data: Data, label: String) -> T? {
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            logger.error("解码 \(label, privacy: .public) JSON 失败: \(error.localizedDescription, privacy: .public)")
            return nil
        }
    }

    func ingestTestPayload(_ data: Data, clientId: UUID, origin: String = "https://blog.example.com") {
        let meta = LocalBridgeServer.ClientMeta(id: clientId, tabId: "test-tab", origin: origin)
        handleIncomingPayload(clientId: clientId, meta: meta, data: data, fromPeer: false, peerLivePosMs: nil)
    }

    func handleIncomingPayload(
        clientId: UUID,
        meta: LocalBridgeServer.ClientMeta,
        data: Data,
        fromPeer: Bool = false,
        peerLivePosMs: Double? = nil
    ) {
        guard let probe = decodeJSON(EnvelopeProbe.self, from: data, label: "envelope") else { return }
        if !fromPeer {
            bridgeServer.updateClientInfo(id: clientId, tabId: probe.tab_id, origin: probe.origin)
        }

        var session = webSessions.session(
            for: clientId,
            defaultOrigin: probe.origin ?? meta.origin,
            defaultTabId: probe.tab_id ?? meta.tabId
        )
        if !fromPeer {
            if let origin = probe.origin, !origin.isEmpty {
                session.origin = origin
                library.learnOriginFromSession(origin)
            }
            if let tabId = probe.tab_id, !tabId.isEmpty { session.tabId = tabId }
            if let ua = probe.user_agent, !ua.isEmpty { session.userAgent = ua }
        } else if let remoteOrigin = probe.origin, !remoteOrigin.isEmpty {
            library.learnOriginFromSession(remoteOrigin)
        }

        switch probe.type {
        case "native_session_adopted":
            webSessions[clientId] = session
            if !fromPeer && isAutonomousMode {
                exitAutonomousPlayback(adoptedByLocalClient: clientId, notifyPeer: true)
            }

        case "request_native_session":
            webSessions[clientId] = session
            if !fromPeer, let auto = autonomousSessionStorage {
                maybeOfferAutonomousAdoption(to: clientId, origin: session.origin, auto: auto, force: probe.force ?? false)
            }

        case "focus_ready":
            webSessions[clientId] = session
            if let token = probe.focus_token, !token.isEmpty,
               let pending = pendingTabFocus, pending.token == token {
                pending.timeoutTask.cancel()
                pendingTabFocus = nil
                if networkServicesEnabled {
                    BrowserTabActivator.activatePlayingTab(
                        origin: session.origin.isEmpty ? pending.origin : session.origin,
                        focusToken: token,
                        userAgent: session.userAgent.isEmpty ? pending.userAgent : session.userAgent
                    )
                }
            }

        case "media":
            handleMediaFrame(data: data, clientId: clientId, session: &session, fromPeer: fromPeer)

        case "rhythm":
            handleRhythmFrame(data: data, clientId: clientId, session: &session, fromPeer: fromPeer)

        case "playlist":
            handlePlaylistFrame(data: data, clientId: clientId, session: &session, fromPeer: fromPeer)

        case "preload":
            handlePreloadFrame(data: data, clientId: clientId, session: &session, fromPeer: fromPeer)

        case "state":
            handleStateFrame(
                data: data,
                clientId: clientId,
                session: &session,
                fromPeer: fromPeer,
                peerLivePosMs: peerLivePosMs
            )

        default:
            break
        }
    }

    private func handleMediaFrame(
        data: Data,
        clientId: UUID,
        session: inout WebBridgeSessionManager.TabSession,
        fromPeer: Bool
    ) {
        guard let msg = decodeJSON(WebMediaMessage.self, from: data, label: "media") else { return }
        if session.track?.id != msg.track?.id {
            session.rhythm = .fallback
            session.lastPausedFromPlayingAt = nil
        }
        session.track = msg.track
        session.accentHex = msg.accentHex
        session.chorus = msg.chorus ?? []
        session.lyrics = msg.lyrics ?? .empty
        session.lastMediaRawJSON = data
        if networkServicesEnabled, let pic = msg.track?.albumPic {
            IslandArtworkCache.shared.preload(urlStrings: [pic])
        }
        webSessions[clientId] = session
        if activeClientId == nil && !isAutonomousMode {
            activeClientId = clientId
        }
        if !fromPeer && !isAutonomousMode && activeClientId == clientId && session.hasActivePlayerSession,
           let curTrack = msg.track {
            let matchedPos = (session.state?.trackId == curTrack.id) ? session.state?.positionMs : 0
            library.updateTrackSnapshot(
                origin: session.origin,
                track: curTrack,
                accentHex: session.accentHex,
                chorus: session.chorus,
                lyrics: session.lyrics,
                rhythm: nil,
                positionMs: matchedPos
            )
        }
        if activeClientId == clientId {
            snapshotHealTask?.cancel()
            applyActiveSession(session, updateClock: false)
            if !fromPeer && peerService.isConnected {
                peerService.sendBridgeFrame(data, livePositionMs: nil)
            }
        }
    }

    private func handleRhythmFrame(
        data: Data,
        clientId: UUID,
        session: inout WebBridgeSessionManager.TabSession,
        fromPeer: Bool
    ) {
        guard let msg = decodeJSON(WebRhythmMessage.self, from: data, label: "rhythm") else { return }
        guard msg.trackId == nil || msg.trackId == session.track?.id else { return }
        session.rhythm = msg.rhythm.toEngineContext()
        session.lastRhythmRawJSON = data
        if !fromPeer && !isAutonomousMode && activeClientId == clientId && session.hasActivePlayerSession,
           let curTrack = session.track {
            let matchedPos = (session.state?.trackId == curTrack.id) ? session.state?.positionMs : 0
            library.updateTrackSnapshot(
                origin: session.origin,
                track: curTrack,
                accentHex: session.accentHex,
                chorus: session.chorus,
                lyrics: session.lyrics,
                rhythm: msg.rhythm,
                positionMs: matchedPos
            )
        }
        webSessions[clientId] = session
        if activeClientId == clientId {
            rhythm = session.rhythm
            if !fromPeer && peerService.isConnected {
                peerService.sendBridgeFrame(data, livePositionMs: nil)
            }
        }
    }

    private func handlePlaylistFrame(
        data: Data,
        clientId: UUID,
        session: inout WebBridgeSessionManager.TabSession,
        fromPeer: Bool
    ) {
        guard let msg = decodeJSON(WebPlaylistMessage.self, from: data, label: "playlist") else { return }
        session.playlist = msg.tracks
        session.playlistComplete = msg.complete
        session.currentIndex = msg.currentIndex
        session.lastPlaylistRawJSON = data
        if !fromPeer && (!isAutonomousMode || library.playlist.isEmpty) {
            library.updatePlaylistFromSession(origin: session.origin, tracks: msg.tracks, complete: msg.complete)
        }
        webSessions[clientId] = session
        if activeClientId == clientId {
            playlist = session.playlist
            playlistComplete = session.playlistComplete
            currentIndex = session.currentIndex
            if !fromPeer && peerService.isConnected {
                peerService.sendBridgeFrame(data, livePositionMs: nil)
            }
        }
    }

    private func handlePreloadFrame(
        data: Data,
        clientId: UUID,
        session: inout WebBridgeSessionManager.TabSession,
        fromPeer: Bool
    ) {
        guard let msg = decodeJSON(WebPreloadMessage.self, from: data, label: "preload") else { return }
        session.nextTrackIdHint = msg.nextTrackId
        session.prevTrackIdHint = msg.prevTrackId
        session.lastPreloadRawJSON = data
        for item in msg.items {
            session.storePreloaded(item)
        }
        webSessions[clientId] = session
        if networkServicesEnabled {
            IslandArtworkCache.shared.preload(urlStrings: msg.items.map(\.track.albumPic))
        }
        if activeClientId == clientId && !fromPeer && peerService.isConnected {
            peerService.sendBridgeFrame(data, livePositionMs: nil)
        }
    }

    private func handleStateFrame(
        data: Data,
        clientId: UUID,
        session: inout WebBridgeSessionManager.TabSession,
        fromPeer: Bool,
        peerLivePosMs: Double?
    ) {
        guard let msg = decodeJSON(WebStateMessage.self, from: data, label: "state") else { return }
        if let opt = session.optimisticTrackUntil {
            if msg.trackId == opt.id {
                session.optimisticTrackUntil = nil
            } else if Date() < opt.until {
                return
            } else {
                session.optimisticTrackUntil = nil
            }
        }
        let wasActivePlayer = session.hasActivePlayerSession
        session.recordIncomingState(msg, fromPeer: fromPeer)
        session.lastStateRawJSON = data
        webSessions[clientId] = session

        if msg.visible && !fromPeer {
            startupBannerText = nil
        }

        if !fromPeer, let auto = autonomousSessionStorage {
            let browserAudioOutputConfirmed = msg.isPlaying && (msg.audioPlaying ?? true)
            if browserAudioOutputConfirmed {
                exitAutonomousPlayback(adoptedByLocalClient: clientId, notifyPeer: true)
            } else {
                maybeOfferAutonomousAdoption(to: clientId, origin: session.origin, auto: auto, force: false)
                return
            }
        } else if fromPeer && isAutonomousMode {
            let peerAudioOutputConfirmed = msg.isPlaying && (msg.audioPlaying ?? true)
            if peerAudioOutputConfirmed {
                exitAutonomousPlayback(adoptedByLocalClient: nil, notifyPeer: false)
            } else {
                return
            }
        }

        let prevActive = activeClientId
        if webSessions.shouldPromoteClient(
            clientId,
            incomingState: msg,
            activeClientId: activeClientId,
            isAutonomousMode: isAutonomousMode
        ) {
            activeClientId = clientId
        }

        guard activeClientId == clientId else { return }
        applyActiveSession(session, updateClock: true, peerLivePosMs: peerLivePosMs)

        if !fromPeer && !isAutonomousMode && session.hasActivePlayerSession {
            library.savePlayerSettings(
                playMode: msg.playMode,
                volume: msg.volume,
                isMuted: msg.muted,
                preferences: msg.preferences,
                config: msg.config
            )
            if let curTrack = session.track {
                let needsFullSync = !wasActivePlayer
                    || prevActive != clientId
                    || !library.hasCachedSnapshot(forTrackId: curTrack.id)
                if needsFullSync {
                    let decodedRhythm: RhythmDataPayload? = session.lastRhythmRawJSON.flatMap {
                        try? JSONDecoder().decode(WebRhythmMessage.self, from: $0).rhythm
                    }
                    let matchedPos = (msg.trackId == curTrack.id) ? msg.positionMs : 0
                    library.updateTrackSnapshot(
                        origin: session.origin,
                        track: curTrack,
                        accentHex: session.accentHex,
                        chorus: session.chorus,
                        lyrics: session.lyrics,
                        rhythm: decodedRhythm,
                        positionMs: matchedPos
                    )
                } else if let tid = msg.trackId {
                    library.recordProgressOnly(trackId: tid, positionMs: msg.positionMs, immediate: !msg.isPlaying)
                }
            } else if let tid = msg.trackId {
                library.recordProgressOnly(trackId: tid, positionMs: msg.positionMs, immediate: !msg.isPlaying)
            }
        }

        if !fromPeer && peerService.isConnected {
            if prevActive != clientId {
                pushFullSnapshotToConnectedPeer()
            } else {
                peerService.sendBridgeFrame(data, livePositionMs: currentPositionMs())
            }
        }
    }

    // MARK: - 活跃浏览器会话投影与乐观预加载

    private func optimisticallySwitchToAdjacent(direction: Int) {
        guard !isAutonomousMode,
              let activeId = activeClientId,
              var session = webSessions[activeId] else {
            return
        }
        let hintedId = direction > 0 ? session.nextTrackIdHint : session.prevTrackIdHint
        let fallbackId: Int? = {
            guard playMode != .shuffle,
                  let cur = session.currentIndex,
                  !session.playlist.isEmpty else { return nil }
            let len = session.playlist.count
            let idx = (cur + direction + len) % len
            return session.playlist.indices.contains(idx) ? session.playlist[idx].id : nil
        }()
        if let targetId = hintedId ?? fallbackId, targetId != track?.id {
            applyOptimisticPreloadIfAvailable(trackId: targetId, session: &session, activeId: activeId)
        }
    }

    private func applyOptimisticPreloadIfAvailable(
        trackId targetId: Int,
        session: inout WebBridgeSessionManager.TabSession,
        activeId: UUID
    ) {
        guard let bundle = session.preloadedBundles[targetId] else { return }
        session.track = bundle.track
        session.accentHex = bundle.accentHex
        session.chorus = bundle.chorus ?? []
        session.lyrics = bundle.lyrics ?? .empty
        session.rhythm = .fallback
        session.optimisticTrackUntil = (targetId, Date().addingTimeInterval(0.65))
        if let matchedIdx = session.playlist.first(where: { $0.id == targetId })?.index {
            session.currentIndex = matchedIdx
            currentIndex = matchedIdx
        }
        webSessions[activeId] = session

        track = bundle.track
        effectiveDurationMs = bundle.track.durationMs
        accentHex = bundle.accentHex
        chorusRanges = bundle.chorus ?? []
        rhythm = .fallback
        seekAtMs = -.infinity
        anchorPositionMs = 0
        anchorLocalDate = Date()
        resetStageVisualEngines()
        updateLyrics(bundle.lyrics ?? .empty, trackId: bundle.track.id)
    }

    func electNextActiveTab() {
        if let candidate = webSessions.electNextActiveSession() {
            activeClientId = candidate.clientId
            applyActiveSession(candidate, updateClock: true)
        } else {
            withAnimation(.spring(duration: 0.34, bounce: 0.2)) {
                activeClientId = nil
                ownershipBeforeUnexpectedPeerDrop = nil
                webVisible = false
                isPlaying = false
                showPlaying = false
                isExpanded = false
                showPlaylistOverlay = false
                track = nil
                effectiveDurationMs = 0
                updateLyrics(.empty, trackId: nil)
                rhythm = .fallback
                resetStageVisualEngines()
            }
        }
    }

    func applyActiveSession(
        _ session: WebBridgeSessionManager.TabSession,
        updateClock: Bool,
        peerLivePosMs: Double? = nil
    ) {
        let prevTrackId = track?.id
        let expectedTrackId = session.state?.trackId ?? session.track?.id
        let mediaMatchesState = (expectedTrackId == nil) || (session.track?.id == expectedTrackId)

        if mediaMatchesState {
            track = session.track
            if let newId = track?.id, newId != prevTrackId {
                hiddenTrackId = nil
                seekAtMs = -.infinity
                resetStageVisualEngines()
            }
            accentHex = session.accentHex
            chorusRanges = session.chorus
            updateLyrics(session.lyrics, trackId: session.track?.id)
            rhythm = session.rhythm
        } else if let expectedId = expectedTrackId, let bundle = session.preloadedBundles[expectedId] {
            track = bundle.track
            if expectedId != prevTrackId {
                hiddenTrackId = nil
                seekAtMs = -.infinity
                resetStageVisualEngines()
            }
            accentHex = bundle.accentHex
            chorusRanges = bundle.chorus ?? []
            updateLyrics(bundle.lyrics ?? .empty, trackId: expectedId)
            rhythm = .fallback
            scheduleSnapshotHeal(for: session.clientId, expectedTrackId: expectedTrackId)
        } else {
            if prevTrackId != nil && prevTrackId != expectedTrackId {
                updateLyrics(.empty, trackId: expectedTrackId)
                rhythm = .fallback
                seekAtMs = -.infinity
                resetStageVisualEngines()
            }
            scheduleSnapshotHeal(for: session.clientId, expectedTrackId: expectedTrackId)
        }

        let stateDurationMs = session.state?.durationMs ?? 0
        let trackDurationMs = mediaMatchesState ? (session.track?.durationMs ?? 0) : 0
        effectiveDurationMs = stateDurationMs > 0 ? stateDurationMs : trackDurationMs

        playlist = session.playlist
        playlistComplete = session.playlistComplete
        currentIndex = session.currentIndex

        if let st = session.state {
            let formChanged = (config.formMode != st.config.formMode)
            withAnimation(.spring(duration: 0.36, bounce: 0.22)) {
                webVisible = st.visible
                showPlaying = st.showPlaying
                isPlaying = st.isPlaying
                config = st.config
                if !st.config.expandable && isExpanded {
                    isExpanded = false
                }
            }
            if formChanged {
                onLayoutTriggerChanged?()
            }
            pendingStep = st.pendingStep
            lyricStatus = st.lyricStatus
            lyricSourcesPending = st.lyricSourcesPending
            playMode = st.playMode
            volume = st.volume
            isMuted = st.muted
            peekText = st.peekText
            pausedText = st.pausedText
            glow = st.glow
            preferences = st.preferences
            if let s = st.seekAtMs {
                seekAtMs = s
            }

            if updateClock {
                if let peerLivePosMs {
                    anchorPositionMs = st.isPlaying ? (peerLivePosMs + peerService.oneWayLatencyMs) : peerLivePosMs
                    anchorLocalDate = Date()
                } else {
                    let transitMs = max(0, Date().timeIntervalSince1970 * 1000.0 - st.anchorMs)
                    anchorPositionMs = st.isPlaying ? (st.positionMs + min(transitMs, 200)) : st.positionMs
                    anchorLocalDate = Date()
                }
            }
        }
    }

    private func scheduleSnapshotHeal(for clientId: UUID, expectedTrackId: Int?) {
        guard let expectedTrackId else { return }
        snapshotHealTask?.cancel()
        snapshotHealTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled, let self else { return }
            guard self.activeClientId == clientId,
                  let session = self.webSessions[clientId],
                  session.track?.id != expectedTrackId else {
                return
            }
            self.logger.notice("检测到曲目 \(expectedTrackId) 元数据未就绪，主动请求重推全量快照")
            self.sendCommand(OutgoingCommand(action: "sync_snapshot"))
        }
    }

    // MARK: - 通用 Origin 工具

    nonisolated static func isSameOrigin(_ a: String, _ b: String) -> Bool {
        let normA = a.trimmingCharacters(in: CharacterSet(charactersIn: "/ ")).lowercased()
        let normB = b.trimmingCharacters(in: CharacterSet(charactersIn: "/ ")).lowercased()
        return !normA.isEmpty && normA == normB
    }

    nonisolated static func isLoopbackOrigin(_ raw: String) -> Bool {
        guard let url = URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
              let host = url.host?.lowercased() else {
            let lower = raw.lowercased()
            return lower.contains("://localhost") || lower.contains("://127.0.0.1") || lower.contains("://[::1]")
        }
        return host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "[::1]"
    }
}
