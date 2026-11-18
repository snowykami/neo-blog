import AppKit
import Foundation
import Observation
import os
import SwiftUI

/// 灵动岛显示、跨机接力与内置续播状态中心（浏览器在线时由网页端发声，浏览器断联时无缝接续内置原生音频播放；遵循 swiftui-expert-skill 使用 @Observable 实现属性级细粒度视图失效）
///
/// 【双端同步维护约定】
/// 新增或修改任何音乐灵动岛特性时，必须与网页端 `web/src/components/layout/topbar-island/music-island.tsx`、
/// `music-island-compact.tsx` 及桥接组件 `web/src/components/common/desktop-island-bridge.tsx` 同步实现，禁止单边演进。
@Observable
@MainActor
final class IslandStore {
    static let remotePeerVirtualClientId = UUID(uuidString: "00000000-0000-0000-8000-00000000BEEF")!
    static let autonomousVirtualClientId = UUID(uuidString: "00000000-0000-0000-8000-00000000A070")!

    struct TabSession {
        let clientId: UUID
        var origin: String
        var tabId: String
        var userAgent: String = ""
        var hasEverPlayed: Bool = false
        var track: IslandTrack?
        var accentHex: String?
        var chorus: [TimeIntervalRange] = []
        var lyrics: LyricsBundlePayload = .empty
        var rhythm: RhythmEngineContext = .fallback
        var playlist: [PlaylistTrackItem] = []
        var playlistComplete: Bool = false
        var currentIndex: Int?
        var state: WebStateMessage?
        var lastMediaRawJSON: Data?
        var lastRhythmRawJSON: Data?
        var lastPlaylistRawJSON: Data?
        var lastStateRawJSON: Data?
        var lastPreloadRawJSON: Data?
        var preloadedBundles: [Int: PreloadedTrackBundle] = [:]
        var preloadedOrder: [Int] = []
        var nextTrackIdHint: Int?
        var prevTrackIdHint: Int?
        var optimisticTrackUntil: (id: Int, until: Date)?

        mutating func storePreloaded(_ bundle: PreloadedTrackBundle) {
            let id = bundle.track.id
            preloadedBundles[id] = bundle
            preloadedOrder.removeAll { $0 == id }
            preloadedOrder.append(id)
            while preloadedOrder.count > 12 {
                let evicted = preloadedOrder.removeFirst()
                preloadedBundles.removeValue(forKey: evicted)
            }
        }
    }

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

    @ObservationIgnored private let logger = Logger(subsystem: "org.liteyuki.NeoBlogIsland", category: "IslandStore")
    @ObservationIgnored private let networkServicesEnabled: Bool
    @ObservationIgnored let bridgeServer = LocalBridgeServer()
    let peerService: PeerContinuityService
    let updater: AppUpdateService
    let nativeAudio: NativeAudioEngine
    let debrisEngine = DebrisEngine()
    let stageSpringEngine = StageSpringEngine()
    let compactStageParticles = StageParticlesEngine(scale: 0.7, maxParticles: 20)
    let expandedStageParticles = StageParticlesEngine(scale: 0.7, maxParticles: 80)
    @ObservationIgnored private var tabSessions: [UUID: TabSession] = [:]
    @ObservationIgnored private var snapshotHealTask: Task<Void, Never>?
    @ObservationIgnored private var pendingTabFocus: (token: String, origin: String, userAgent: String, timeoutTask: Task<Void, Never>)? = nil
    @ObservationIgnored private var portPollTimer: Timer?
    @ObservationIgnored private var disconnectTakeoverTask: Task<Void, Never>?
    @ObservationIgnored private var autonomousResolveTask: Task<Void, Never>?
    @ObservationIgnored private var autonomousPrewarmTask: Task<Void, Never>?
    @ObservationIgnored private var autonomousPeekTask: Task<Void, Never>?
    @ObservationIgnored private var autonomousPauseSettleTask: Task<Void, Never>?
    @ObservationIgnored private var autonomousMirrorGlowTask: Task<Void, Never>?
    @ObservationIgnored private var autonomousStatePatchThrottleTask: Task<Void, Never>?
    @ObservationIgnored private var lastAutonomousStatePatchSentAt: Date = .distantPast
    @ObservationIgnored private var consecutiveAutonomousFailures: Int = 0
    @ObservationIgnored private var autonomousTrackStartAnchorMs: Double = 0
    @ObservationIgnored private var offeredAdoptionClientIds: Set<UUID> = []
    @ObservationIgnored var disconnectTakeoverDelayMs: Int = 280
    @ObservationIgnored private var autonomousSessionStorage: AutonomousSessionPayload? = nil

    private(set) var isAutonomousMode: Bool = false
    private(set) var autonomousOrigin: String = ""
    private(set) var autonomousSourceHostPeerId: String = ""
    private(set) var autonomousAudioOwnerPeerId: String = ""
    private(set) var isAutonomousBuffering: Bool = false

    /// 供测试与诊断读取当前内置续播快照（不触发 @Observable 高频字段订阅）
    var autonomousSession: AutonomousSessionPayload? {
        autonomousSessionStorage
    }

    private(set) var activeClientId: UUID?
    private(set) var connectedOrigins: [String] = []
    private(set) var boundPort: UInt16 = 29170

    private(set) var track: IslandTrack?
    private(set) var effectiveDurationMs: Double = 0
    private(set) var accentHex: String?
    private(set) var chorusRanges: [TimeIntervalRange] = []
    private(set) var lyrics: LyricsBundlePayload = .empty
    /// 预先构建的带稳定跨曲目唯一 ID 的歌词行集合，供展开面板直接索引，零 body 内内存分配
    private(set) var indexedLines: [IndexedLyricLine] = []
    /// 预先构建的展开面板完整时间轴条目（含前置/后置和声、≥7s 间奏三圆点与底栏歌词来源）
    private(set) var stageEntries: [StageTimelineEntry] = []
    private(set) var lyricStatus: String = "ready"
    private(set) var lyricSourcesPending: Bool = false
    private(set) var rhythm: RhythmEngineContext = .fallback
    private(set) var playlist: [PlaylistTrackItem] = []
    private(set) var playlistComplete: Bool = false
    private(set) var currentIndex: Int?

    private(set) var webVisible: Bool = false
    private(set) var showPlaying: Bool = false
    private(set) var isPlaying: Bool = false
    private(set) var pendingStep: Int? = nil
    private(set) var playMode: PlayMode = .repeatAll
    private(set) var volume: Double = 0.85
    private(set) var isMuted: Bool = false
    private(set) var peekText: String?
    private(set) var pausedText: String?
    private(set) var glow: IslandGlowPayload?
    private(set) var preferences: IslandLyricPreferences = .default
    private(set) var config: IslandDisplayConfig = .default
    private(set) var seekAtMs: Double = -.infinity

    private var anchorPositionMs: Double = 0
    private var anchorLocalDate: Date = Date()

    var isExpanded: Bool = false
    var isHovering: Bool = false
    var showPlaylistOverlay: Bool = false
    var isDockedInMenuBar: Bool = false
    var expandsUpward: Bool = false
    var isDraggingCapsule: Bool = false
    var hasCustomCapsulePosition: Bool = false
    var isPositionLocked: Bool = UserDefaults.standard.bool(forKey: "NeoBlogIsland.positionLocked")
    var startupBannerText: String? = "桌面灵动岛已就绪 · 等待博客播放音乐"
    var hiddenTrackId: Int? = nil

    // 跨 Mac AWDL 点对点接力与传送门状态
    private(set) var displayOwnership: PeerDisplayOwnership = .singleActiveMac
    private(set) var activeOwnerPeerId: String? = nil
    var portalDragTargetEdge: PortalEdge? = nil
    private(set) var incomingPortalPreview: PeerPortalPayload? = nil
    @ObservationIgnored private var lastSentPortalPreview: PeerPortalPayload? = nil

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
        peerService.isConnected && track != nil
    }

    var isIslandHandedOffToPeer: Bool {
        guard peerService.isConnected, displayOwnership == .singleActiveMac else {
            return false
        }
        if isAutonomousMode {
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

    init(startNetworkServices: Bool = true, peerService: PeerContinuityService? = nil) {
        self.networkServicesEnabled = startNetworkServices
        self.peerService = peerService ?? PeerContinuityService()
        self.updater = AppUpdateService(startBackgroundCheck: startNetworkServices)
        self.nativeAudio = NativeAudioEngine(simulationMode: !startNetworkServices)
        self.disconnectTakeoverDelayMs = startNetworkServices ? 280 : 0
        setupNativeAudioCallbacks()
        setupPeerCallbacks()
        if startNetworkServices {
            setupBridge()
            self.peerService.start()
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.8) { [weak self] in
                withAnimation(.spring(duration: 0.38, bounce: 0.22)) {
                    self?.startupBannerText = nil
                }
            }
        } else {
            self.startupBannerText = nil
        }
    }

    // MARK: - 时钟与时间轴状态（严格毫秒单位，1:1 对齐 timeline.ts getTimelineState & strip-slots.ts）

    func currentPositionMs(at date: Date = Date()) -> Double {
        let clockAdvancing = isPlaying && (!isAutonomousMode || !isAutonomousBuffering)
        let raw = clockAdvancing
            ? anchorPositionMs + date.timeIntervalSince(anchorLocalDate) * 1000.0
            : anchorPositionMs
        if effectiveDurationMs > 0 {
            return max(0, min(effectiveDurationMs, raw))
        }
        return max(0, raw)
    }

    func activeInterlude(at ms: Double) -> TimeIntervalRange? {
        lyrics.interludes.first { ms >= $0.start && ms < $0.end }
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

    /// 1:1 对齐 web/src/lib/lyrics/moments.ts lyricMomentAt：计算当前时刻应展示的前奏导语、关键节点旁白/热评或尾奏热评
    func activeMoment(at ms: Double) -> ResolvedMoment? {
        guard preferences.showLyricMoments else { return nil }
        let mainLines = lyrics.lines.filter { !$0.isBackground }
        guard !mainLines.isEmpty else { return nil }

        let introStartMs = 300.0
        let introLeadMs = 600.0
        let introMinMs = 8000.0
        let noteMs = 9000.0
        let outroDelayMs = 800.0
        let outroEndMs = 300.0

        let outroStart = (mainLines.map(\.end).max() ?? 0) + outroDelayMs
        let notes = lyrics.notes
        if !notes.isEmpty {
            for i in stride(from: notes.count - 1, through: 0, by: -1) {
                let start = notes[i].start
                let nextNoteStart = (i + 1 < notes.count) ? notes[i + 1].start : .infinity
                let outroCap = lyrics.outro != nil ? outroStart : .infinity
                let end = min(start + noteMs, min(nextNoteStart, outroCap))
                if ms >= start && ms < end {
                    let note = notes[i]
                    if note.source == "comment" {
                        return ResolvedMoment(kind: .comment(liked: note.liked ?? 0), text: note.content)
                    }
                    return ResolvedMoment(kind: .narration, text: note.content)
                }
            }
        }

        if let intro = lyrics.intro, !intro.isEmpty,
           ms >= introStartMs,
           ms < max(mainLines[0].start - introLeadMs, introStartMs + introMinMs) {
            return ResolvedMoment(kind: .narration, text: intro)
        }

        if let outro = lyrics.outro, !outro.content.isEmpty,
           ms > outroStart,
           (effectiveDurationMs <= 0 || ms < effectiveDurationMs - outroEndMs) {
            return ResolvedMoment(kind: .comment(liked: outro.liked), text: outro.content)
        }

        return nil
    }

    /// 返回当前活跃行下标集合与焦点主唱行下标（对齐 timeline.ts getTimelineState）
    func timelineState(at ms: Double) -> (active: [Int], focus: Int?, interlude: TimeIntervalRange?) {
        let lines = lyrics.lines
        guard !lines.isEmpty else { return ([], nil, nil) }

        if let inter = activeInterlude(at: ms) {
            let anySinging = lines.contains { ms >= $0.start && ms < $0.end }
            if !anySinging {
                return ([], nil, inter)
            }
        }

        let earliest = lines.map(\.start).min() ?? 0
        let firstMain = lines.firstIndex(where: { !$0.isBackground }) ?? 0
        if ms < earliest {
            return ([], firstMain, nil)
        }

        var directActive: [Int] = []
        for (i, line) in lines.enumerated() where ms >= line.start && ms < line.end {
            directActive.append(i)
        }

        if !directActive.isEmpty {
            var activeSet = Set(directActive)
            for idx in directActive where lines[idx].isBackground {
                let owner = lines[idx].owner
                if owner >= 0 && owner < lines.count {
                    activeSet.insert(owner)
                }
            }
            let active = activeSet.sorted()
            let firstMainActive = directActive.first(where: { !lines[$0].isBackground })
            let ownerFallback = lines[directActive[0]].owner
            let focus = firstMainActive ?? (ownerFallback >= 0 ? ownerFallback : active[0])
            return (active, focus, nil)
        }

        var lastPassedMain: Int? = nil
        for (i, line) in lines.enumerated() where !line.isBackground {
            if line.start <= ms {
                lastPassedMain = i
            } else {
                break
            }
        }
        let allEnded = lines.allSatisfy { ms >= $0.end }
        if allEnded {
            return ([], nil, nil)
        }
        if let prev = lastPassedMain {
            return ([prev], prev, nil)
        }
        return ([], firstMain, nil)
    }

    /// 计算紧凑胶囊单行条此刻应显示的 1～4 句及其槽位（对齐 strip-slots.ts placeStripLines；状态栏矮胶囊同样保留双行与 2x2 四宫格，由视图层自适应缩小字号）
    func stripRenderItems(at ms: Double) -> (items: [StripRenderItem], interlude: TimeIntervalRange?) {
        let state = timelineState(at: ms)
        if let inter = state.interlude {
            return ([], inter)
        }
        guard let focusIdx = state.focus, lyrics.lines.indices.contains(focusIdx) else {
            return ([], nil)
        }

        let tid = track?.id ?? 0
        let lines = lyrics.lines
        let nextStartFor = { (idx: Int) -> Double? in
            for j in (idx + 1)..<lines.count where !lines[j].isBackground {
                return lines[j].start
            }
            return nil
        }

        let makeCandidate = { (idx: Int) -> StripCandidateLine in
            let l = lines[idx]
            return StripCandidateLine(
                index: idx,
                duet: l.isDuet || l.align == "right",
                background: l.isBackground,
                ownedByFocus: l.owner == focusIdx
            )
        }

        let others = state.active.filter { $0 != focusIdx }.map(makeCandidate)
        let slots = StripSlotSolver.placeStripLines(focus: makeCandidate(focusIdx), others: others)

        if slots.isEmpty {
            return ([StripRenderItem(trackId: tid, lineIndex: focusIdx, line: lines[focusIdx], nextLineStart: nextStartFor(focusIdx), slot: nil, isFocus: true)], nil)
        }

        let orderedIndices = slots.keys.sorted()
        let items = orderedIndices.map { idx in
            StripRenderItem(
                trackId: tid,
                lineIndex: idx,
                line: lines[idx],
                nextLineStart: nextStartFor(idx),
                slot: slots[idx],
                isFocus: idx == focusIdx
            )
        }
        return (items, nil)
    }

    // MARK: - 反向控制指令与内置续播路由

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
        } else {
            bridgeServer.sendCommand(command, to: activeClientId)
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
        lastSentPortalPreview = nil
        portalDragTargetEdge = nil
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
        let payload = PeerPortalPayload(
            fromEdge: .right,
            offsetFromTopPt: isDockedInMenuBar ? 14 : 28,
            dockedInMenuBar: isDockedInMenuBar
        )
        commitPortalThrow(payload)
    }

    func recallIslandToThisMac() {
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

    func play() { sendCommand(OutgoingCommand(action: "play")) }
    func pause() { sendCommand(OutgoingCommand(action: "pause")) }
    func togglePlay() { sendCommand(OutgoingCommand(action: "toggle")) }

    func nextTrack() {
        optimisticallySwitchToAdjacent(direction: 1)
        sendCommand(OutgoingCommand(action: "next"))
    }

    func prevTrack() {
        optimisticallySwitchToAdjacent(direction: -1)
        sendCommand(OutgoingCommand(action: "prev"))
    }

    private func optimisticallySwitchToAdjacent(direction: Int) {
        guard let activeId = activeClientId, var session = tabSessions[activeId] else { return }
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

    private func applyOptimisticPreloadIfAvailable(trackId targetId: Int, session: inout TabSession, activeId: UUID) {
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
        tabSessions[activeId] = session

        track = bundle.track
        effectiveDurationMs = bundle.track.durationMs
        accentHex = bundle.accentHex
        chorusRanges = bundle.chorus ?? []
        rhythm = .fallback
        seekAtMs = -.infinity
        anchorPositionMs = 0
        anchorLocalDate = Date()
        debrisEngine.reset()
        stageSpringEngine.reset()
        compactStageParticles.reset()
        expandedStageParticles.reset()
        updateLyrics(bundle.lyrics ?? .empty, trackId: bundle.track.id)
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
        if let activeId = activeClientId,
           var session = tabSessions[activeId],
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

    func resetTranslationLangs() {
        sendCommand(OutgoingCommand(action: "reset_translation_langs"))
    }

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

    /// 1:1 对齐 music-page-controls.tsx handleCopyLyrics：按当前音译/翻译开关动态排版整首歌词写入系统剪贴板
    func copyFormattedLyricsToPasteboard() -> Bool {
        guard !lyrics.lines.isEmpty else { return false }
        let title = track?.name ?? ""
        let artistStr = (track?.artists ?? []).joined(separator: " / ")
        let header = title.isEmpty ? "" : "\(title)\(artistStr.isEmpty ? "" : " - \(artistStr)")\n\n"

        var groups: [[String]] = []
        for line in lyrics.lines {
            let rawOrig = line.plainText.trimmingCharacters(in: .whitespacesAndNewlines)
            if rawOrig.isEmpty { continue }
            let orig: String
            if line.isBackground {
                let alreadyWrapped = (rawOrig.hasPrefix("(") && rawOrig.hasSuffix(")"))
                    || (rawOrig.hasPrefix("（") && rawOrig.hasSuffix("）"))
                orig = alreadyWrapped ? rawOrig : "(\(rawOrig))"
            } else {
                orig = rawOrig
            }
            var parts = [orig]
            if preferences.showRomaji,
               let roma = line.romanization?.trimmingCharacters(in: .whitespacesAndNewlines),
               !roma.isEmpty {
                parts.append(roma)
            }
            if preferences.showTranslation {
                if let trans = line.translation?.trimmingCharacters(in: .whitespacesAndNewlines),
                   !trans.isEmpty {
                    parts.append(trans)
                }
                if let sec = line.secondaryTranslation?.trimmingCharacters(in: .whitespacesAndNewlines),
                   !sec.isEmpty {
                    parts.append(sec)
                }
            }
            groups.append(parts)
        }
        guard !groups.isEmpty else { return false }
        let hasExtra = groups.contains { $0.count > 1 }
        let content = groups.map { $0.joined(separator: "\n") }.joined(separator: hasExtra ? "\n\n" : "\n")
        let fullText = (header + content).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !fullText.isEmpty else { return false }

        let pb = NSPasteboard.general
        pb.clearContents()
        return pb.setString(fullText, forType: .string)
    }

    func requestFullPlaylistIfNeeded() {
        if !playlistComplete {
            sendCommand(OutgoingCommand(action: "ensure_playlist"))
        }
    }

    func openBlogPlayerPage() {
        releaseKeyFocus(restorePreviousApp: false)
        withAnimation(.spring(duration: 0.34, bounce: 0.2)) {
            isExpanded = false
            showPlaylistOverlay = false
        }
        if let auto = autonomousSessionStorage {
            let hasLocalBrowser = tabSessions.values.contains {
                $0.clientId != Self.remotePeerVirtualClientId && Self.isSameOrigin($0.origin, auto.origin)
            }
            let isLoopback = Self.isLoopbackOrigin(auto.origin)
            // 双屏同显或原源为回环地址且当前在对端 Mac 时，交由原源主机唤醒浏览器接管
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

    private func openLocalBrowserPlayerTab() {
        let targetId: UUID?
        if let auto = autonomousSessionStorage {
            // 内置续播态仅向同源本地浏览器标签页发起反向接管，避免误劫持本机打开的其他站点（如 localhost 开发站）
            targetId = tabSessions.values.first {
                $0.clientId != Self.remotePeerVirtualClientId
                    && $0.clientId == activeClientId
                    && Self.isSameOrigin($0.origin, auto.origin)
            }?.clientId
                ?? tabSessions.values.first {
                    $0.clientId != Self.remotePeerVirtualClientId
                        && Self.isSameOrigin($0.origin, auto.origin)
                }?.clientId
        } else {
            targetId = tabSessions.keys.first { $0 != Self.remotePeerVirtualClientId && $0 == activeClientId }
                ?? tabSessions.keys.first { $0 != Self.remotePeerVirtualClientId }
        }
        let session = targetId.flatMap { tabSessions[$0] }
        let origin = session?.origin ?? autonomousSessionStorage?.origin ?? connectedOrigins.first ?? ""
        let userAgent = session?.userAgent ?? ""
        let token = "nbf_\(UUID().uuidString.prefix(8).lowercased())"

        onInterceptCommandForTest?(OutgoingCommand(action: "open_player_page", focusToken: token))

        if targetId == nil, let auto = autonomousSessionStorage, !auto.origin.isEmpty {
            let base = auto.origin.hasSuffix("/") ? String(auto.origin.dropLast()) : auto.origin
            if networkServicesEnabled, let url = URL(string: "\(base)/music?island_handoff=1") {
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

    // MARK: - WebSocket 入站路由与会话粘性仲裁

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

    private struct EnvelopeProbe: Decodable {
        let type: String
        let tab_id: String?
        let origin: String?
        let user_agent: String?
        let focus_token: String?
        let force: Bool?
    }

    private func decodeJSON<T: Decodable>(_ type: T.Type, from data: Data, label: String) -> T? {
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            logger.error("JSON 解码失败 [\(label, privacy: .public), bytes=\(data.count)]: \(String(describing: error), privacy: .public)")
            return nil
        }
    }

    private func setupPeerCallbacks() {
        peerService.onPeerAuthenticated = { [weak self] _, _ in
            guard let self else { return }
            if let auto = self.autonomousSessionStorage {
                // 仅由当前唯一持有发声权的权威端在重连时广播所有权与续播快照，杜绝双主脑裂互相覆盖
                if auto.audioOwnerPeerId == self.peerService.localPeerId {
                    if self.displayOwnership == .singleActiveMac && self.activeOwnerPeerId == nil {
                        self.activeOwnerPeerId = self.peerService.localPeerId
                    }
                    self.peerService.sendOwnershipUpdate(mode: self.displayOwnership, activeOwnerPeerId: self.activeOwnerPeerId)
                    self.broadcastAutonomousFullSyncToPeer()
                }
            } else {
                self.pushFullSnapshotToConnectedPeer()
            }
        }

        peerService.onPeerDisconnected = { [weak self] _ in
            guard let self else { return }
            self.incomingPortalPreview = nil
            self.portalDragTargetEdge = nil
            self.lastSentPortalPreview = nil
            let removedMirrorSession = self.tabSessions.removeValue(forKey: Self.remotePeerVirtualClientId) != nil
            self.displayOwnership = .singleActiveMac

            if let auto = self.autonomousSessionStorage {
                if auto.audioOwnerPeerId == self.peerService.localPeerId {
                    // 本机原本就是发声端（例如单岛已流转到本机，或同显时的原源主机），保留本机 activeOwner 标记并无缝继续播放
                    self.activeOwnerPeerId = self.peerService.localPeerId
                    self.ensureLocalAutonomousAudioMatchesState()
                    self.refreshAutonomousMirrorGlowWatcher()
                } else {
                    // 对端才是发声端（无论是双屏同显从属端，还是单岛「声随岛走」已投送给对端）：本机彻底退出续播态，避免弹窗或重连脑裂
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
                // 对端浏览器未实际出声（如新开空标签页、暂停态页面握手）时，严禁打断本机正在运行的内置续播
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
            if cmd.action == "open_player_page" {
                self.openLocalBrowserPlayerTab()
                return
            }
            if self.isAutonomousMode {
                self.onInterceptCommandForTest?(cmd)
                self.executeAutonomousCommand(cmd)
                return
            }
            let localClient = self.tabSessions.keys.first { $0 != Self.remotePeerVirtualClientId && $0 == self.activeClientId }
                ?? self.tabSessions.keys.first { $0 != Self.remotePeerVirtualClientId }
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

    private func pushFullSnapshotToConnectedPeer() {
        guard peerService.isConnected else { return }
        guard let activeId = activeClientId,
              activeId != Self.remotePeerVirtualClientId,
              let session = tabSessions[activeId] else {
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

    func ingestTestPayload(_ data: Data, clientId: UUID, origin: String = "https://blog.example.com") {
        let meta = LocalBridgeServer.ClientMeta(id: clientId, tabId: "test-tab", origin: origin)
        handleIncomingPayload(clientId: clientId, meta: meta, data: data, fromPeer: false, peerLivePosMs: nil)
    }

    private func handleIncomingPayload(
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

        var session = tabSessions[clientId] ?? TabSession(
            clientId: clientId,
            origin: probe.origin ?? meta.origin,
            tabId: probe.tab_id ?? meta.tabId
        )
        if !fromPeer {
            if let origin = probe.origin, !origin.isEmpty { session.origin = origin }
            if let tabId = probe.tab_id, !tabId.isEmpty { session.tabId = tabId }
            if let ua = probe.user_agent, !ua.isEmpty { session.userAgent = ua }
        }

        switch probe.type {
        case "native_session_adopted":
            tabSessions[clientId] = session
            if !fromPeer && isAutonomousMode {
                exitAutonomousPlayback(adoptedByLocalClient: clientId, notifyPeer: true)
            }

        case "request_native_session":
            tabSessions[clientId] = session
            if !fromPeer, let auto = autonomousSessionStorage {
                maybeOfferAutonomousAdoption(to: clientId, origin: session.origin, auto: auto, force: probe.force ?? false)
            }

        case "focus_ready":
            tabSessions[clientId] = session
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
            guard let msg = decodeJSON(WebMediaMessage.self, from: data, label: "media") else { return }
            if session.track?.id != msg.track?.id {
                session.rhythm = .fallback
            }
            session.track = msg.track
            session.accentHex = msg.accentHex
            session.chorus = msg.chorus ?? []
            session.lyrics = msg.lyrics ?? .empty
            session.optimisticTrackUntil = nil
            session.lastMediaRawJSON = data
            if networkServicesEnabled {
                IslandArtworkCache.shared.preload(urlStrings: [msg.track?.albumPic])
            }
            tabSessions[clientId] = session
            if activeClientId == nil {
                activeClientId = clientId
            }
            if activeClientId == clientId {
                snapshotHealTask?.cancel()
                applyActiveSession(session, updateClock: false)
                if !fromPeer && peerService.isConnected {
                    peerService.sendBridgeFrame(data, livePositionMs: nil)
                }
            }

        case "rhythm":
            guard let msg = decodeJSON(WebRhythmMessage.self, from: data, label: "rhythm") else { return }
            if msg.trackId == nil || msg.trackId == session.track?.id {
                session.rhythm = msg.rhythm.toEngineContext()
                session.lastRhythmRawJSON = data
                tabSessions[clientId] = session
                if activeClientId == clientId {
                    rhythm = session.rhythm
                    if !fromPeer && peerService.isConnected {
                        peerService.sendBridgeFrame(data, livePositionMs: nil)
                    }
                }
            }

        case "playlist":
            guard let msg = decodeJSON(WebPlaylistMessage.self, from: data, label: "playlist") else { return }
            session.playlist = msg.tracks
            session.playlistComplete = msg.complete
            session.currentIndex = msg.currentIndex
            session.lastPlaylistRawJSON = data
            tabSessions[clientId] = session
            if activeClientId == clientId {
                playlist = session.playlist
                playlistComplete = session.playlistComplete
                currentIndex = session.currentIndex
                if !fromPeer && peerService.isConnected {
                    peerService.sendBridgeFrame(data, livePositionMs: nil)
                }
            }

        case "preload":
            guard let msg = decodeJSON(WebPreloadMessage.self, from: data, label: "preload") else { return }
            session.nextTrackIdHint = msg.nextTrackId
            session.prevTrackIdHint = msg.prevTrackId
            session.lastPreloadRawJSON = data
            for item in msg.items {
                session.storePreloaded(item)
            }
            tabSessions[clientId] = session
            if networkServicesEnabled {
                IslandArtworkCache.shared.preload(urlStrings: msg.items.map(\.track.albumPic))
            }
            if activeClientId == clientId && !fromPeer && peerService.isConnected {
                peerService.sendBridgeFrame(data, livePositionMs: nil)
            }

        case "state":
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
            if msg.isPlaying || msg.hasPlayed || msg.showPlaying {
                session.hasEverPlayed = true
            }
            session.state = msg
            session.lastStateRawJSON = data
            tabSessions[clientId] = session

            if msg.visible && !fromPeer {
                startupBannerText = nil
            }

            if !fromPeer, let auto = autonomousSessionStorage {
                let browserAudioOutputConfirmed = msg.isPlaying && (msg.audioPlaying ?? true)
                if browserAudioOutputConfirmed {
                    // 浏览器 <audio> 已完成缓冲并实际出声（非前置 'play' 意图），原子停掉原生播放器并交回浏览器接管
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
            if shouldPromoteClient(clientId, incomingState: msg) {
                activeClientId = clientId
            }

            if activeClientId == clientId {
                applyActiveSession(session, updateClock: true, peerLivePosMs: peerLivePosMs)
                if !fromPeer && peerService.isConnected {
                    if prevActive != clientId {
                        pushFullSnapshotToConnectedPeer()
                    } else {
                        peerService.sendBridgeFrame(data, livePositionMs: currentPositionMs())
                    }
                }
            }

        default:
            break
        }
    }

    private func shouldPromoteClient(_ candidateId: UUID, incomingState msg: WebStateMessage) -> Bool {
        if isAutonomousMode {
            return msg.isPlaying && candidateId != Self.remotePeerVirtualClientId
        }
        guard let curId = activeClientId else { return true }
        if curId == candidateId { return true }
        if msg.isPlaying { return true }
        guard let curSession = tabSessions[curId] else { return true }
        if !curSession.hasEverPlayed && curSession.state?.visible != true && msg.visible {
            return true
        }
        return false
    }

    private func electNextActiveTab() {
        if let playing = tabSessions.values.first(where: { $0.state?.isPlaying == true }) {
            activeClientId = playing.clientId
            applyActiveSession(playing, updateClock: true)
        } else if let playedTab = tabSessions.values.first(where: { $0.hasEverPlayed && $0.state?.visible == true }) {
            activeClientId = playedTab.clientId
            applyActiveSession(playedTab, updateClock: true)
        } else if let visibleTab = tabSessions.values.first(where: { $0.state?.visible == true }) {
            activeClientId = visibleTab.clientId
            applyActiveSession(visibleTab, updateClock: true)
        } else if let anyTab = tabSessions.values.first {
            activeClientId = anyTab.clientId
            applyActiveSession(anyTab, updateClock: true)
        } else {
            withAnimation(.spring(duration: 0.34, bounce: 0.2)) {
                activeClientId = nil
                webVisible = false
                isPlaying = false
                showPlaying = false
                isExpanded = false
                showPlaylistOverlay = false
                track = nil
                effectiveDurationMs = 0
                updateLyrics(.empty, trackId: nil)
                rhythm = .fallback
                debrisEngine.reset()
                stageSpringEngine.reset()
                compactStageParticles.reset()
                expandedStageParticles.reset()
            }
        }
    }

    private func updateLyrics(_ nextLyrics: LyricsBundlePayload, trackId: Int?) {
        let tid = trackId ?? 0
        if lyrics == nextLyrics && indexedLines.first?.id.hasPrefix("\(tid)-") == true {
            return
        }
        lyrics = nextLyrics
        let builtLines: [IndexedLyricLine] = nextLyrics.lines.enumerated().map { idx, line in
            let dots = (line.edgeColors ?? []).prefix(6).enumerated().map { dotIdx, hex in
                SingerColorDot(id: "\(tid)-\(idx)-d\(dotIdx)", hex: hex)
            }
            return IndexedLyricLine(
                id: "\(tid)-\(idx)",
                index: idx,
                line: line,
                singerDots: dots
            )
        }
        indexedLines = builtLines

        // 按 timeline.ts buildTimeline 顺序组装舞台完整条目（歌词行 + ≥7s 间奏三圆点 + 底栏歌词来源）
        var entries: [StageTimelineEntry] = []
        let sortedInterludes = nextLyrics.interludes.sorted { $0.start < $1.start }
        var interCursor = 0

        func nextMainAlign(fromLineIndex startIdx: Int) -> String {
            for j in max(0, startIdx)..<nextLyrics.lines.count where !nextLyrics.lines[j].isBackground {
                return nextLyrics.lines[j].align
            }
            return "left"
        }

        for item in builtLines {
            while interCursor < sortedInterludes.count && sortedInterludes[interCursor].end <= item.line.start + 1.0 {
                let inter = sortedInterludes[interCursor]
                entries.append(
                    .interlude(
                        id: "\(tid)-inter-\(interCursor)",
                        range: inter,
                        align: nextMainAlign(fromLineIndex: item.index)
                    )
                )
                interCursor += 1
            }
            entries.append(.line(item))
        }
        while interCursor < sortedInterludes.count {
            let inter = sortedInterludes[interCursor]
            entries.append(
                .interlude(
                    id: "\(tid)-inter-\(interCursor)",
                    range: inter,
                    align: "left"
                )
            )
            interCursor += 1
        }
        if !builtLines.isEmpty, let footer = nextLyrics.footerLabel, !footer.isEmpty {
            entries.append(.footer(id: "\(tid)-footer", text: footer))
        }
        stageEntries = entries
    }

    private func applyActiveSession(_ session: TabSession, updateClock: Bool, peerLivePosMs: Double? = nil) {
        let prevTrackId = track?.id
        let expectedTrackId = session.state?.trackId ?? session.track?.id
        let mediaMatchesState = (expectedTrackId == nil) || (session.track?.id == expectedTrackId)

        if mediaMatchesState {
            track = session.track
            if let newId = track?.id, newId != prevTrackId {
                hiddenTrackId = nil
                seekAtMs = -.infinity
                debrisEngine.reset()
                stageSpringEngine.reset()
                compactStageParticles.reset()
                expandedStageParticles.reset()
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
                debrisEngine.reset()
                stageSpringEngine.reset()
                compactStageParticles.reset()
                expandedStageParticles.reset()
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
                debrisEngine.reset()
                stageSpringEngine.reset()
                compactStageParticles.reset()
                expandedStageParticles.reset()
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
                  let session = self.tabSessions[clientId],
                  session.track?.id != expectedTrackId else {
                return
            }
            self.logger.notice("检测到曲目 \(expectedTrackId) 元数据未就绪，主动请求重推全量快照")
            self.sendCommand(OutgoingCommand(action: "sync_snapshot"))
        }
    }

    // MARK: - 浏览器断联内置续播 & 跨 Mac 声随岛走 / 双屏同显原主机发声仲裁

    private func setAutonomousSession(_ next: AutonomousSessionPayload?) {
        autonomousSessionStorage = next
        let nextActive = (next != nil)
        let nextOrigin = next?.origin ?? ""
        let nextSource = next?.sourceHostPeerId ?? ""
        let nextAudioOwner = next?.audioOwnerPeerId ?? ""

        if isAutonomousMode != nextActive { isAutonomousMode = nextActive }
        if autonomousOrigin != nextOrigin { autonomousOrigin = nextOrigin }
        if autonomousSourceHostPeerId != nextSource { autonomousSourceHostPeerId = nextSource }
        if autonomousAudioOwnerPeerId != nextAudioOwner { autonomousAudioOwnerPeerId = nextAudioOwner }
        if !nextActive && isAutonomousBuffering { isAutonomousBuffering = false }
    }

    private func setupNativeAudioCallbacks() {
        nativeAudio.onPositionUpdate = { [weak self] posMs, durMs in
            guard let self, self.isAutonomousMode, self.isLocalAutonomousAudioOwner else { return }
            // 仅在硬件时钟与墙钟推算偏差 > 85ms 时修正锚点，且直接写入 @ObservationIgnored 存储，确保稳态播放期间 @Observable 视图树 0Hz 无效重绘
            let predicted = self.currentPositionMs()
            if abs(posMs - predicted) > 85 {
                self.anchorPositionMs = posMs
                self.anchorLocalDate = Date()
            }
            if let durMs, durMs > 0, abs(durMs - self.effectiveDurationMs) > 120 {
                self.effectiveDurationMs = durMs
            }
            // 与前端 MIN_VALID_PLAY_MS 一致：新曲稳定播放满 1.5s 后才清零连续失败熔断计数，防止截断流/残损头死循环切歌
            if self.consecutiveAutonomousFailures > 0 && (posMs - self.autonomousTrackStartAnchorMs) >= 1500 {
                self.consecutiveAutonomousFailures = 0
            }
            self.autonomousSessionStorage?.livePositionMs = posMs
            self.updateAutonomousGlow(at: posMs)
        }

        nativeAudio.onPlaybackStarted = { [weak self] posMs in
            guard let self, self.isAutonomousMode, self.isLocalAutonomousAudioOwner else { return }
            self.autonomousTrackStartAnchorMs = posMs
            self.isAutonomousBuffering = false
            self.anchorPositionMs = posMs
            self.anchorLocalDate = Date()
            self.autonomousSessionStorage?.livePositionMs = posMs
            self.broadcastAutonomousStatePatchToPeer(throttled: false)
        }

        nativeAudio.onPlaybackFailed = { [weak self] failedTrackId in
            guard let self, let auto = self.autonomousSessionStorage, self.isLocalAutonomousAudioOwner else { return }
            guard auto.track.id == failedTrackId else { return }
            self.isAutonomousBuffering = false
            self.consecutiveAutonomousFailures += 1
            let maxSkips = min(3, max(0, auto.playlist.count - 1))
            if auto.playlist.count > 1 && self.consecutiveAutonomousFailures <= maxSkips {
                self.logger.warning("曲目 \(failedTrackId) 流加载失败（连续第 \(self.consecutiveAutonomousFailures) 次），自动跳过至下一首")
                self.stepAutonomousTrack(direction: 1, resetFailureCounter: false)
            } else {
                self.logger.error("内置音频流连续加载失败，自动暂停续播以防无声空跑歌词")
                self.executeAutonomousCommand(OutgoingCommand(action: "pause"))
            }
        }

        nativeAudio.onTrackEnded = { [weak self] in
            self?.handleAutonomousTrackEnded()
        }

        nativeAudio.onRemotePlay = { [weak self] in self?.play() }
        nativeAudio.onRemotePause = { [weak self] in self?.pause() }
        nativeAudio.onRemoteToggle = { [weak self] in self?.togglePlay() }
        nativeAudio.onRemoteNext = { [weak self] in self?.nextTrack() }
        nativeAudio.onRemotePrev = { [weak self] in self?.prevTrack() }
        nativeAudio.onRemoteSeek = { [weak self] ms in self?.seek(toMs: ms) }
    }

    /// 供单元测试模拟本地浏览器 WebSocket 断开
    func simulateClientDisconnectForTesting(_ clientId: UUID) {
        handleLocalClientDisconnected(clientId)
    }

    private func handleLocalClientDisconnected(_ clientId: UUID) {
        offeredAdoptionClientIds.remove(clientId)
        let removed = tabSessions.removeValue(forKey: clientId)

        let hasOtherLocalPlayingBrowser = tabSessions.values.contains {
            $0.clientId != Self.remotePeerVirtualClientId && $0.state?.isPlaying == true
        }

        if clientId == activeClientId,
           !hasOtherLocalPlayingBrowser,
           !isAutonomousMode,
           let removed,
           removed.state?.isPlaying == true,
           let curTrack = removed.track,
           !removed.origin.isEmpty,
           hiddenTrackId != curTrack.id {
            enterAutonomousTakeover(from: removed, track: curTrack)
            return
        }

        if activeClientId == clientId && !isAutonomousMode {
            electNextActiveTab()
        }
    }

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

    func computeDesiredAudioOwnerPeerId(sourceHostPeerId: String, origin: String? = nil) -> String {
        let effectiveOrigin = origin ?? autonomousOrigin
        if displayOwnership == .mirrorBothMacs || Self.isLoopbackOrigin(effectiveOrigin) {
            // 双屏同显或本地回环源（对端 Mac 无法访问源机的 127.0.0.1）：固定由原源主机播放
            return sourceHostPeerId
        }
        if peerService.isConnected {
            // 单岛跨屏流转：声随岛走（谁当前显示灵动岛，谁在本地驱动音频播放）
            return activeOwnerPeerId ?? sourceHostPeerId
        }
        return peerService.localPeerId
    }

    private func enterAutonomousTakeover(from session: TabSession, track curTrack: IslandTrack) {
        let posMs = currentPositionMs()
        let decodedRhythm: RhythmDataPayload? = session.lastRhythmRawJSON.flatMap {
            try? JSONDecoder().decode(WebRhythmMessage.self, from: $0).rhythm
        }
        let sourceHost = peerService.localPeerId
        let desiredAudioOwner = computeDesiredAudioOwnerPeerId(sourceHostPeerId: sourceHost, origin: session.origin)

        let payload = AutonomousSessionPayload(
            origin: session.origin,
            sourceHostPeerId: sourceHost,
            audioOwnerPeerId: desiredAudioOwner,
            track: curTrack,
            accentHex: session.accentHex,
            chorus: session.chorus,
            lyrics: session.lyrics,
            rhythm: decodedRhythm,
            playlist: session.playlist,
            playlistComplete: session.playlistComplete,
            currentIndex: session.currentIndex,
            preloadedBundles: Array(session.preloadedBundles.values),
            livePositionMs: posMs,
            isPlaying: true,
            playMode: playMode,
            volume: volume,
            isMuted: isMuted,
            preferences: preferences,
            config: config
        )

        snapshotHealTask?.cancel()
        consecutiveAutonomousFailures = 0
        setAutonomousSession(payload)
        activeClientId = Self.autonomousVirtualClientId
        webVisible = true
        isPlaying = true
        showPlaying = true
        anchorPositionMs = posMs
        anchorLocalDate = Date()

        disconnectTakeoverTask?.cancel()
        let delayMs = disconnectTakeoverDelayMs
        if delayMs <= 0 {
            activateAutonomousSessionAfterGrace()
        } else {
            disconnectTakeoverTask = Task { @MainActor [weak self] in
                try? await Task.sleep(for: .milliseconds(delayMs))
                guard !Task.isCancelled, let self, self.isAutonomousMode else { return }
                self.activateAutonomousSessionAfterGrace()
            }
        }
    }

    private func activateAutonomousSessionAfterGrace() {
        guard var auto = autonomousSessionStorage else { return }
        let desiredOwner = computeDesiredAudioOwnerPeerId(sourceHostPeerId: auto.sourceHostPeerId)
        auto.audioOwnerPeerId = desiredOwner
        auto.livePositionMs = currentPositionMs()
        setAutonomousSession(auto)

        logger.info("浏览器已断联，进入灵动岛内置续播: track=\(auto.track.id), audioOwner=\(desiredOwner, privacy: .public)")
        ensureLocalAutonomousAudioMatchesState()
        broadcastAutonomousFullSyncToPeer()

        if desiredOwner == peerService.localPeerId {
            // 若断联恰逢切歌瞬间、浏览器尚未推完当前曲目歌词或节拍，主动兜底补拉缺失部分（已有逐字歌词则保留不覆盖）
            let missingLyrics = auto.lyrics.lines.isEmpty && !auto.lyrics.instrumental
            if missingLyrics || auto.rhythm == nil {
                resolveCurrentAutonomousTrack(refresh: false, preserveExistingLyrics: !missingLyrics)
            } else {
                scheduleAutonomousPrewarm()
            }
        }
        refreshAutonomousMirrorGlowWatcher()
    }

    private func reconcileAutonomousOwnershipTransition() {
        guard var auto = autonomousSessionStorage else { return }
        let prevOwner = auto.audioOwnerPeerId
        let desiredOwner = computeDesiredAudioOwnerPeerId(sourceHostPeerId: auto.sourceHostPeerId, origin: auto.origin)

        if prevOwner == peerService.localPeerId && desiredOwner != peerService.localPeerId {
            // 本机原本持有音频输出，现交棒给对端 Mac：精确采样当前硬件毫秒位置后立即停声并推送给对端接续
            let handoffPos = currentPositionMs()
            nativeAudio.stop()
            isAutonomousBuffering = false
            auto.audioOwnerPeerId = desiredOwner
            auto.livePositionMs = handoffPos
            anchorPositionMs = handoffPos
            anchorLocalDate = Date()
            setAutonomousSession(auto)
            broadcastAutonomousStatePatchToPeer(throttled: false)
        } else if desiredOwner == peerService.localPeerId {
            if prevOwner == peerService.localPeerId || !peerService.isConnected {
                auto.audioOwnerPeerId = peerService.localPeerId
                auto.livePositionMs = currentPositionMs()
                setAutonomousSession(auto)
                ensureLocalAutonomousAudioMatchesState()
                broadcastAutonomousStatePatchToPeer(throttled: false)
                let missingLyrics = auto.lyrics.lines.isEmpty && !auto.lyrics.instrumental
                if missingLyrics || auto.rhythm == nil {
                    resolveCurrentAutonomousTrack(refresh: false, preserveExistingLyrics: !missingLyrics)
                } else {
                    scheduleAutonomousPrewarm()
                }
            }
            // 若 prevOwner 是已连接的对端 Mac，对端收到 ownershipUpdate / portalThrow 后会精确采样停声并发送状态包交棒给本机
        }
        refreshAutonomousMirrorGlowWatcher()
    }

    private func applyIncomingAutonomousSync(_ incoming: AutonomousSessionPayload) {
        disconnectTakeoverTask?.cancel()
        snapshotHealTask?.cancel()
        // 清理浏览器在线阶段残留的跨屏镜像虚拟会话，防止后续停止续播或断联时复活幽灵镜像态
        tabSessions.removeValue(forKey: Self.remotePeerVirtualClientId)

        var synced = incoming
        synced.preloadedBundles = autonomousSessionStorage?.preloadedBundles ?? []
        let prevTrackId = track?.id
        let isNewTrack = prevTrackId != synced.track.id

        track = synced.track
        effectiveDurationMs = synced.track.durationMs
        accentHex = synced.accentHex
        chorusRanges = synced.chorus
        updateLyrics(synced.lyrics, trackId: synced.track.id)
        rhythm = synced.rhythm?.toEngineContext() ?? .fallback
        playlist = synced.playlist
        playlistComplete = synced.playlistComplete
        currentIndex = synced.currentIndex
        playMode = synced.playMode
        volume = synced.volume
        isMuted = synced.isMuted
        preferences = synced.preferences
        lyricStatus = synced.lyrics.lines.isEmpty && !synced.lyrics.instrumental ? "loading" : "ready"

        let formChanged = (config.formMode != synced.config.formMode)
        config = synced.config
        if formChanged {
            onLayoutTriggerChanged?()
        }

        if isNewTrack {
            hiddenTrackId = nil
            seekAtMs = -.infinity
            debrisEngine.reset()
            stageSpringEngine.reset()
            compactStageParticles.reset()
            expandedStageParticles.reset()
            if networkServicesEnabled {
                IslandArtworkCache.shared.preload(urlStrings: [synced.track.albumPic])
            }
            triggerAutonomousTrackPeekIfNeeded(for: synced.track)
        }

        let maxDur = effectiveDurationMs > 0 ? effectiveDurationMs : .infinity
        let rawPos = synced.isPlaying
            ? (synced.livePositionMs + peerService.oneWayLatencyMs)
            : synced.livePositionMs
        let clampedPos = max(0, min(maxDur, rawPos))
        anchorPositionMs = clampedPos
        anchorLocalDate = Date()
        synced.livePositionMs = clampedPos
        setAutonomousSession(synced)

        activeClientId = Self.autonomousVirtualClientId
        startupBannerText = nil
        webVisible = true
        applyAutonomousPlayStateUI(playing: synced.isPlaying)
        updateAutonomousGlow(at: clampedPos)

        ensureLocalAutonomousAudioMatchesState()
        if synced.audioOwnerPeerId == peerService.localPeerId {
            let missingLyrics = synced.lyrics.lines.isEmpty && !synced.lyrics.instrumental
            if missingLyrics || synced.rhythm == nil {
                resolveCurrentAutonomousTrack(refresh: false, preserveExistingLyrics: !missingLyrics)
            } else {
                scheduleAutonomousPrewarm()
            }
        }
        refreshAutonomousMirrorGlowWatcher()
        onLayoutTriggerChanged?()
    }

    private func applyIncomingAutonomousStatePatch(_ patch: AutonomousStatePatchPayload) {
        guard var auto = autonomousSessionStorage, auto.track.id == patch.trackId else {
            return
        }
        disconnectTakeoverTask?.cancel()

        auto.sourceHostPeerId = patch.sourceHostPeerId
        auto.audioOwnerPeerId = patch.audioOwnerPeerId
        auto.isPlaying = patch.isPlaying
        auto.playMode = patch.playMode
        auto.volume = patch.volume
        auto.isMuted = patch.isMuted
        auto.preferences = patch.preferences

        let formChanged = (config.formMode != patch.config.formMode)
        auto.config = patch.config
        config = patch.config
        if formChanged {
            onLayoutTriggerChanged?()
        }

        playMode = patch.playMode
        volume = patch.volume
        isMuted = patch.isMuted
        preferences = patch.preferences

        let isNewLocalOwner = patch.audioOwnerPeerId == peerService.localPeerId
        if !isNewLocalOwner {
            isAutonomousBuffering = patch.isBuffering
        }

        let maxDur = effectiveDurationMs > 0 ? effectiveDurationMs : .infinity
        let rawPos = (patch.isPlaying && !patch.isBuffering)
            ? (patch.livePositionMs + peerService.oneWayLatencyMs)
            : patch.livePositionMs
        let clampedPos = max(0, min(maxDur, rawPos))
        anchorPositionMs = clampedPos
        anchorLocalDate = Date()
        auto.livePositionMs = clampedPos
        setAutonomousSession(auto)

        applyAutonomousPlayStateUI(playing: patch.isPlaying)
        updateAutonomousGlow(at: clampedPos)
        ensureLocalAutonomousAudioMatchesState()

        if isNewLocalOwner {
            let missingLyrics = auto.lyrics.lines.isEmpty && !auto.lyrics.instrumental
            if missingLyrics || auto.rhythm == nil {
                resolveCurrentAutonomousTrack(refresh: false, preserveExistingLyrics: !missingLyrics)
            } else {
                scheduleAutonomousPrewarm()
            }
        }
        refreshAutonomousMirrorGlowWatcher()
        onLayoutTriggerChanged?()
    }

    private func ensureLocalAutonomousAudioMatchesState() {
        guard let auto = autonomousSessionStorage else {
            nativeAudio.stop()
            isAutonomousBuffering = false
            return
        }
        guard auto.audioOwnerPeerId == peerService.localPeerId else {
            nativeAudio.stop()
            isAutonomousBuffering = false
            return
        }

        nativeAudio.setVolume(volume, isMuted: isMuted)
        let posMs = currentPositionMs()

        if !nativeAudio.isActive || nativeAudio.activeTrackId != auto.track.id {
            if auto.isPlaying {
                isAutonomousBuffering = networkServicesEnabled
                nativeAudio.startPlayback(
                    origin: auto.origin,
                    track: auto.track,
                    startPositionMs: posMs,
                    autoPlay: true,
                    volume: volume,
                    isMuted: isMuted
                )
                isAutonomousBuffering = nativeAudio.isBuffering
            } else {
                isAutonomousBuffering = false
            }
        } else {
            let drift = abs(nativeAudio.lastObservedPositionMs - posMs)
            if drift > 450 {
                nativeAudio.seek(toMs: posMs)
            }
            if auto.isPlaying && !nativeAudio.isPlaying {
                nativeAudio.play()
                isAutonomousBuffering = nativeAudio.isBuffering
            } else if !auto.isPlaying && nativeAudio.isPlaying {
                nativeAudio.pause()
                isAutonomousBuffering = false
            }
        }
    }

    private func broadcastAutonomousFullSyncToPeer() {
        autonomousStatePatchThrottleTask?.cancel()
        autonomousStatePatchThrottleTask = nil
        guard peerService.isConnected, var auto = autonomousSessionStorage else { return }
        auto.livePositionMs = currentPositionMs()
        auto.isPlaying = isPlaying
        auto.playMode = playMode
        auto.volume = volume
        auto.isMuted = isMuted
        auto.preferences = preferences
        auto.config = config
        setAutonomousSession(auto)
        lastAutonomousStatePatchSentAt = Date()
        peerService.sendAutonomousSync(auto)
    }

    private func broadcastAutonomousStatePatchToPeer(throttled: Bool) {
        guard peerService.isConnected, autonomousSessionStorage != nil else { return }
        if throttled {
            let elapsed = Date().timeIntervalSince(lastAutonomousStatePatchSentAt)
            if elapsed < 0.065 {
                if autonomousStatePatchThrottleTask == nil {
                    let waitMs = max(16, Int((0.065 - elapsed) * 1000.0))
                    autonomousStatePatchThrottleTask = Task { @MainActor [weak self] in
                        try? await Task.sleep(for: .milliseconds(waitMs))
                        guard !Task.isCancelled, let self else { return }
                        self.autonomousStatePatchThrottleTask = nil
                        self.sendAutonomousStatePatchNow()
                    }
                }
                return
            }
        }
        autonomousStatePatchThrottleTask?.cancel()
        autonomousStatePatchThrottleTask = nil
        sendAutonomousStatePatchNow()
    }

    private func sendAutonomousStatePatchNow() {
        guard peerService.isConnected, var auto = autonomousSessionStorage else { return }
        let pos = currentPositionMs()
        auto.livePositionMs = pos
        auto.isPlaying = isPlaying
        auto.playMode = playMode
        auto.volume = volume
        auto.isMuted = isMuted
        auto.preferences = preferences
        auto.config = config
        setAutonomousSession(auto)
        lastAutonomousStatePatchSentAt = Date()

        let patch = AutonomousStatePatchPayload(
            trackId: auto.track.id,
            sourceHostPeerId: auto.sourceHostPeerId,
            audioOwnerPeerId: auto.audioOwnerPeerId,
            livePositionMs: pos,
            isPlaying: isPlaying,
            isBuffering: isAutonomousBuffering,
            playMode: playMode,
            volume: volume,
            isMuted: isMuted,
            preferences: preferences,
            config: config
        )
        peerService.sendAutonomousStatePatch(patch)
    }

    private func executeAutonomousCommand(_ cmd: OutgoingCommand) {
        guard var auto = autonomousSessionStorage else { return }
        if !peerService.isConnected && auto.audioOwnerPeerId != peerService.localPeerId {
            auto.audioOwnerPeerId = peerService.localPeerId
            setAutonomousSession(auto)
        }

        switch cmd.action {
        case "play":
            guard !isPlaying else { return }
            consecutiveAutonomousFailures = 0
            let pos = currentPositionMs()
            anchorPositionMs = pos
            anchorLocalDate = Date()
            auto.isPlaying = true
            auto.livePositionMs = pos
            setAutonomousSession(auto)
            applyAutonomousPlayStateUI(playing: true)
            ensureLocalAutonomousAudioMatchesState()
            broadcastAutonomousStatePatchToPeer(throttled: false)

        case "pause":
            guard isPlaying else { return }
            let pos = currentPositionMs()
            anchorPositionMs = pos
            anchorLocalDate = Date()
            isAutonomousBuffering = false
            auto.isPlaying = false
            auto.livePositionMs = pos
            setAutonomousSession(auto)
            if nativeAudio.isActive {
                nativeAudio.pause()
            }
            applyAutonomousPlayStateUI(playing: false)
            broadcastAutonomousStatePatchToPeer(throttled: false)

        case "toggle":
            if isPlaying {
                executeAutonomousCommand(OutgoingCommand(action: "pause"))
            } else {
                executeAutonomousCommand(OutgoingCommand(action: "play"))
            }

        case "seek":
            if let targetMs = cmd.positionMs, targetMs.isFinite {
                let maxDur = effectiveDurationMs > 0 ? effectiveDurationMs : .infinity
                let clamped = max(0, min(maxDur, targetMs))
                seekAtMs = clamped
                anchorPositionMs = clamped
                anchorLocalDate = Date()
                auto.livePositionMs = clamped
                setAutonomousSession(auto)
                if nativeAudio.isActive {
                    nativeAudio.seek(toMs: clamped)
                }
                updateAutonomousGlow(at: clamped)
                broadcastAutonomousStatePatchToPeer(throttled: false)
            }

        case "next":
            stepAutonomousTrack(direction: 1, resetFailureCounter: true)

        case "prev":
            if currentPositionMs() > 3500 {
                executeAutonomousCommand(OutgoingCommand(action: "seek", positionMs: 0))
            } else {
                stepAutonomousTrack(direction: -1, resetFailureCounter: true)
            }

        case "play_track":
            if let idx = cmd.index {
                consecutiveAutonomousFailures = 0
                switchToAutonomousPlaylistIndex(idx)
            }

        case "set_mode":
            if let mode = cmd.playMode {
                playMode = mode
                auto.playMode = mode
                setAutonomousSession(auto)
                broadcastAutonomousStatePatchToPeer(throttled: false)
            }

        case "set_volume":
            if let vol = cmd.volume, vol.isFinite {
                let clamped = max(0, min(1, vol))
                volume = clamped
                if isMuted && clamped > 0.001 {
                    isMuted = false
                }
                auto.volume = volume
                auto.isMuted = isMuted
                setAutonomousSession(auto)
                nativeAudio.setVolume(volume, isMuted: isMuted)
                broadcastAutonomousStatePatchToPeer(throttled: true)
            }

        case "toggle_muted":
            isMuted.toggle()
            auto.isMuted = isMuted
            setAutonomousSession(auto)
            nativeAudio.setVolume(volume, isMuted: isMuted)
            broadcastAutonomousStatePatchToPeer(throttled: false)

        case "toggle_translation":
            preferences.showTranslation.toggle()
            auto.preferences = preferences
            setAutonomousSession(auto)
            broadcastAutonomousStatePatchToPeer(throttled: false)
            if preferences.showTranslation {
                resolveCurrentAutonomousTrack(refresh: false, preserveExistingLyrics: false)
            }

        case "toggle_romaji":
            preferences.showRomaji.toggle()
            auto.preferences = preferences
            setAutonomousSession(auto)
            broadcastAutonomousStatePatchToPeer(throttled: false)
            if preferences.showRomaji {
                resolveCurrentAutonomousTrack(refresh: false, preserveExistingLyrics: false)
            }

        case "toggle_effects":
            preferences.showLyricEffects.toggle()
            auto.preferences = preferences
            setAutonomousSession(auto)
            broadcastAutonomousStatePatchToPeer(throttled: false)

        case "toggle_moments":
            preferences.showLyricMoments.toggle()
            auto.preferences = preferences
            setAutonomousSession(auto)
            broadcastAutonomousStatePatchToPeer(throttled: false)

        case "toggle_hdr":
            config.hdr.toggle()
            auto.config = config
            setAutonomousSession(auto)
            broadcastAutonomousStatePatchToPeer(throttled: false)

        case "reset_translation_langs":
            preferences.translationSelections = []
            preferences.showTranslation = true
            auto.preferences = preferences
            setAutonomousSession(auto)
            broadcastAutonomousStatePatchToPeer(throttled: false)
            resolveCurrentAutonomousTrack(refresh: false, preserveExistingLyrics: false)

        case "toggle_translation_lang":
            if let lang = cmd.lang, !lang.isEmpty {
                preferences.translationSelections = StandaloneSongResolver.toggleTranslationSelection(
                    current: preferences.translationSelections,
                    lang: lang,
                    preferNative: cmd.preferNative ?? false,
                    hasDualSources: cmd.hasDualSources ?? false
                )
                preferences.showTranslation = true
                auto.preferences = preferences
                setAutonomousSession(auto)
                broadcastAutonomousStatePatchToPeer(throttled: false)
                resolveCurrentAutonomousTrack(refresh: false, preserveExistingLyrics: false)
            }

        case "refresh_lyrics":
            lyricStatus = "loading"
            resolveCurrentAutonomousTrack(refresh: true, preserveExistingLyrics: false)

        case "ensure_playlist":
            scheduleAutonomousPrewarm(forcePlaylist: true)

        default:
            break
        }
    }

    private func handleAutonomousTrackEnded() {
        guard let auto = autonomousSessionStorage, auto.audioOwnerPeerId == peerService.localPeerId else { return }
        if playMode == .repeatOne || auto.playlist.count <= 1 {
            anchorPositionMs = 0
            anchorLocalDate = Date()
            seekAtMs = 0
            nativeAudio.seek(toMs: 0)
            nativeAudio.play()
            broadcastAutonomousStatePatchToPeer(throttled: false)
            return
        }
        stepAutonomousTrack(direction: 1, resetFailureCounter: true)
    }

    private func stepAutonomousTrack(direction: Int, resetFailureCounter: Bool) {
        if resetFailureCounter {
            consecutiveAutonomousFailures = 0
        }
        guard let auto = autonomousSessionStorage, !auto.playlist.isEmpty else {
            executeAutonomousCommand(OutgoingCommand(action: "seek", positionMs: 0))
            return
        }
        let count = auto.playlist.count
        let curPosInArray = auto.playlist.firstIndex(where: { $0.id == auto.track.id }) ?? 0
        let nextPosInArray: Int
        if playMode == .shuffle && count > 1 {
            var pick = Int.random(in: 0..<count)
            if pick == curPosInArray {
                pick = (curPosInArray + 1) % count
            }
            nextPosInArray = pick
        } else {
            nextPosInArray = (curPosInArray + direction + count) % count
        }
        let item = auto.playlist[nextPosInArray]
        switchToAutonomousTrackItem(item)
    }

    private func switchToAutonomousPlaylistIndex(_ targetIndex: Int) {
        guard let auto = autonomousSessionStorage else { return }
        if let matched = auto.playlist.first(where: { $0.index == targetIndex }) {
            switchToAutonomousTrackItem(matched)
        } else if auto.playlist.indices.contains(targetIndex) {
            switchToAutonomousTrackItem(auto.playlist[targetIndex])
        }
    }

    private func switchToAutonomousTrackItem(_ item: PlaylistTrackItem) {
        guard var auto = autonomousSessionStorage else { return }
        autonomousResolveTask?.cancel()

        let cachedPreload = auto.preloadedBundles.first(where: { $0.track.id == item.id })
        let nextTrack = cachedPreload?.track ?? StandaloneSongResolver.makeIslandTrack(from: item)

        auto.track = nextTrack
        auto.accentHex = cachedPreload?.accentHex
        auto.chorus = cachedPreload?.chorus ?? []
        auto.lyrics = cachedPreload?.lyrics ?? .empty
        auto.rhythm = nil
        auto.currentIndex = item.index
        auto.livePositionMs = 0
        auto.isPlaying = true
        setAutonomousSession(auto)

        track = nextTrack
        effectiveDurationMs = nextTrack.durationMs
        accentHex = auto.accentHex
        chorusRanges = auto.chorus
        updateLyrics(auto.lyrics, trackId: nextTrack.id)
        rhythm = .fallback
        currentIndex = item.index
        lyricStatus = cachedPreload?.lyrics != nil ? "ready" : "loading"
        seekAtMs = -.infinity
        anchorPositionMs = 0
        anchorLocalDate = Date()
        hiddenTrackId = nil
        debrisEngine.reset()
        stageSpringEngine.reset()
        compactStageParticles.reset()
        expandedStageParticles.reset()
        if networkServicesEnabled {
            IslandArtworkCache.shared.preload(urlStrings: [nextTrack.albumPic])
        }

        let hasPreloadedLyrics = cachedPreload?.lyrics != nil
            && (!(cachedPreload?.lyrics?.lines.isEmpty ?? true) || cachedPreload?.lyrics?.instrumental == true)
        preferences.availableTranslationLangs = []
        preferences.translationsGenerating = false
        preferences.pronunciationsGenerating = false
        if hasPreloadedLyrics, let preLyrics = cachedPreload?.lyrics {
            syncCapabilityFlagsFromLyrics(preLyrics, availableLangs: nil)
        } else {
            preferences.canToggleTranslation = false
            preferences.canToggleRomaji = false
        }
        auto.preferences = preferences
        setAutonomousSession(auto)

        applyAutonomousPlayStateUI(playing: true)
        triggerAutonomousTrackPeekIfNeeded(for: nextTrack)
        updateAutonomousGlow(at: 0)

        ensureLocalAutonomousAudioMatchesState()
        broadcastAutonomousFullSyncToPeer()

        // 预热包仅含无副作用的基础歌词作 0ms 瞬显占位，必须继续以完整模式覆盖合并 AI 译文、音译、强调特效与歌手分轨
        resolveCurrentAutonomousTrack(refresh: false, preserveExistingLyrics: false)
    }

    private func syncCapabilityFlagsFromLyrics(
        _ bundle: LyricsBundlePayload,
        availableLangs: [AvailableTranslationLangItem]?,
        translationsGenerating: Bool = false,
        pronunciationsGenerating: Bool = false
    ) {
        if let availableLangs {
            preferences.availableTranslationLangs = availableLangs
        }
        let hasVocalLines = !bundle.instrumental && !bundle.lines.isEmpty
        preferences.canToggleTranslation = hasVocalLines
        preferences.canToggleRomaji = hasVocalLines
        preferences.translationsGenerating = translationsGenerating
        preferences.pronunciationsGenerating = pronunciationsGenerating
    }

    private func resolveCurrentAutonomousTrack(
        refresh: Bool,
        preserveExistingLyrics: Bool,
        pollAttempt: Int = 0
    ) {
        guard networkServicesEnabled, let auto = autonomousSessionStorage else { return }
        let origin = auto.origin
        let curTrack = auto.track
        let curPrefs = preferences

        autonomousResolveTask?.cancel()
        autonomousResolveTask = Task { @MainActor [weak self] in
            let resolved = await StandaloneSongResolver.resolveTrackBundle(
                origin: origin,
                track: curTrack,
                preferences: curPrefs,
                refresh: refresh,
                passivePreload: false
            )
            guard !Task.isCancelled,
                  let self,
                  var currentAuto = self.autonomousSessionStorage,
                  currentAuto.track.id == curTrack.id else {
                return
            }
            currentAuto.track = resolved.track
            if let resolvedHex = resolved.accentHex {
                currentAuto.accentHex = resolvedHex
                self.accentHex = resolvedHex
            }
            if !resolved.chorus.isEmpty || currentAuto.chorus.isEmpty {
                currentAuto.chorus = resolved.chorus
                self.chorusRanges = resolved.chorus
            }
            let existingHasLyrics = !currentAuto.lyrics.lines.isEmpty || currentAuto.lyrics.instrumental
            if !preserveExistingLyrics || !existingHasLyrics || refresh {
                if !resolved.lyrics.lines.isEmpty || resolved.lyrics.instrumental || !existingHasLyrics || refresh {
                    currentAuto.lyrics = resolved.lyrics
                    self.updateLyrics(resolved.lyrics, trackId: resolved.track.id)
                }
            }
            if let rData = resolved.rhythmData {
                currentAuto.rhythm = rData
                self.rhythm = rData.toEngineContext()
            }
            self.syncCapabilityFlagsFromLyrics(
                currentAuto.lyrics,
                availableLangs: resolved.availableTranslationLangs ?? [],
                translationsGenerating: resolved.translationsGenerating,
                pronunciationsGenerating: resolved.pronunciationsGenerating
            )
            currentAuto.preferences = self.preferences
            self.setAutonomousSession(currentAuto)

            self.track = resolved.track
            if resolved.track.durationMs > 0 && self.effectiveDurationMs <= 0 {
                self.effectiveDurationMs = resolved.track.durationMs
            }
            self.lyricStatus = currentAuto.lyrics.lines.isEmpty && !currentAuto.lyrics.instrumental ? "none" : "ready"
            self.updateAutonomousGlow(at: self.currentPositionMs())
            self.refreshAutonomousMirrorGlowWatcher()
            self.broadcastAutonomousFullSyncToPeer()
            if pollAttempt == 0 {
                self.scheduleAutonomousPrewarm()
            }
            // 若当前曲目的按需 AI 翻译或音译仍在后台生成（pending），最多轻量轮询 6 次直至落盘刷新
            if (resolved.translationsGenerating || resolved.pronunciationsGenerating) && pollAttempt < 6 {
                try? await Task.sleep(for: .milliseconds(2500))
                guard !Task.isCancelled,
                      self.autonomousSessionStorage?.track.id == curTrack.id else {
                    return
                }
                self.resolveCurrentAutonomousTrack(
                    refresh: false,
                    preserveExistingLyrics: false,
                    pollAttempt: pollAttempt + 1
                )
            }
        }
    }

    private func scheduleAutonomousPrewarm(forcePlaylist: Bool = false) {
        guard networkServicesEnabled, let auto = autonomousSessionStorage, auto.audioOwnerPeerId == peerService.localPeerId else {
            return
        }
        let origin = auto.origin
        let needPlaylist = forcePlaylist || !auto.playlistComplete || auto.playlist.isEmpty
        let curTrackId = auto.track.id
        let curPrefs = preferences

        autonomousPrewarmTask?.cancel()
        autonomousPrewarmTask = Task { @MainActor [weak self] in
            guard let self else { return }
            if needPlaylist, let fullList = await StandaloneSongResolver.fetchPlaylist(origin: origin), !Task.isCancelled {
                if var latest = self.autonomousSessionStorage {
                    latest.playlist = fullList
                    latest.playlistComplete = true
                    if let matched = fullList.first(where: { $0.id == latest.track.id }) {
                        latest.currentIndex = matched.index
                        self.currentIndex = matched.index
                    }
                    self.setAutonomousSession(latest)
                    self.playlist = fullList
                    self.playlistComplete = true
                    self.broadcastAutonomousFullSyncToPeer()
                }
            }

            guard !Task.isCancelled, let latest = self.autonomousSessionStorage, latest.track.id == curTrackId, latest.playlist.count > 1 else {
                return
            }
            let list = latest.playlist
            guard let idx = list.firstIndex(where: { $0.id == curTrackId }) else { return }
            let nextItem = list[(idx + 1) % list.count]
            let prevItem = list[(idx - 1 + list.count) % list.count]

            for candidate in [nextItem, prevItem] where candidate.id != curTrackId {
                if Task.isCancelled { return }
                if self.autonomousSessionStorage?.preloadedBundles.contains(where: { $0.track.id == candidate.id }) == true {
                    continue
                }
                let candidateTrack = StandaloneSongResolver.makeIslandTrack(from: candidate)
                let resolved = await StandaloneSongResolver.resolveTrackBundle(
                    origin: origin,
                    track: candidateTrack,
                    preferences: curPrefs,
                    passivePreload: true
                )
                guard !Task.isCancelled, var targetAuto = self.autonomousSessionStorage else { return }
                let preload = PreloadedTrackBundle(
                    track: resolved.track,
                    accentHex: resolved.accentHex,
                    chorus: resolved.chorus,
                    lyrics: resolved.lyrics
                )
                targetAuto.preloadedBundles.removeAll { $0.track.id == candidate.id }
                targetAuto.preloadedBundles.append(preload)
                if targetAuto.preloadedBundles.count > 8 {
                    targetAuto.preloadedBundles.removeFirst()
                }
                self.setAutonomousSession(targetAuto)
            }
        }
    }

    private func applyAutonomousPlayStateUI(playing: Bool) {
        autonomousPauseSettleTask?.cancel()
        if playing {
            withAnimation(.spring(duration: 0.36, bounce: 0.22)) {
                isPlaying = true
                showPlaying = true
            }
            pausedText = nil
            refreshAutonomousMirrorGlowWatcher()
        } else {
            let pos = currentPositionMs()
            let focusIdx = timelineState(at: pos).focus
            let focusLineText = focusIdx.flatMap { lyrics.lines.indices.contains($0) ? lyrics.lines[$0].plainText : nil }
            let cleanFocus = focusLineText?.trimmingCharacters(in: .whitespacesAndNewlines)
            pausedText = (cleanFocus?.isEmpty == false) ? cleanFocus : track?.inlineTitle
            withAnimation(.spring(duration: 0.36, bounce: 0.22)) {
                isPlaying = false
            }
            refreshAutonomousMirrorGlowWatcher()
            autonomousPauseSettleTask = Task { @MainActor [weak self] in
                try? await Task.sleep(for: .milliseconds(350))
                guard !Task.isCancelled, let self, self.isAutonomousMode, !self.isPlaying else { return }
                withAnimation(.spring(duration: 0.36, bounce: 0.22)) {
                    self.showPlaying = false
                }
            }
        }
    }

    private func triggerAutonomousTrackPeekIfNeeded(for nextTrack: IslandTrack) {
        autonomousPeekTask?.cancel()
        guard !nextTrack.inlineTitle.isEmpty else {
            peekText = nil
            return
        }
        peekText = nextTrack.inlineTitle
        autonomousPeekTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(1500))
            guard !Task.isCancelled, let self else { return }
            withAnimation(.easeOut(duration: 0.24)) {
                self.peekText = nil
            }
        }
    }

    private func updateAutonomousGlow(at ms: Double) {
        guard config.chorusGlow else {
            if glow != nil { glow = nil }
            return
        }
        let inChorus = chorusRanges.contains { ms >= $0.start && ms <= $0.end }
        if inChorus {
            let hex = accentHex ?? "#2dd4bf"
            if glow?.color != hex {
                glow = IslandGlowPayload(color: hex, strong: true)
            }
        } else if glow != nil {
            glow = nil
        }
    }

    private func refreshAutonomousMirrorGlowWatcher() {
        let needsWatcher = isAutonomousMode
            && !isLocalAutonomousAudioOwner
            && isPlaying
            && config.chorusGlow
            && !chorusRanges.isEmpty
        if !needsWatcher {
            autonomousMirrorGlowTask?.cancel()
            autonomousMirrorGlowTask = nil
            if !config.chorusGlow && glow != nil {
                glow = nil
            }
            return
        }
        guard autonomousMirrorGlowTask == nil else { return }
        autonomousMirrorGlowTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(350))
                guard !Task.isCancelled, let self else { return }
                guard self.isAutonomousMode && !self.isLocalAutonomousAudioOwner && self.isPlaying else {
                    self.autonomousMirrorGlowTask = nil
                    return
                }
                self.updateAutonomousGlow(at: self.currentPositionMs())
            }
        }
    }

    private func maybeOfferAutonomousAdoption(to clientId: UUID, origin: String, auto: AutonomousSessionPayload, force: Bool) {
        if !force && offeredAdoptionClientIds.contains(clientId) {
            return
        }
        // 仅在当前本机正持有灵动岛显示与发声权时才向本机新开浏览器提供反向接管，严禁已甩屏隐藏的原主机抢回对端播放权
        guard auto.audioOwnerPeerId == peerService.localPeerId && !isIslandHandedOffToPeer else {
            return
        }
        guard Self.isSameOrigin(origin, auto.origin) else { return }
        sendAdoptCommandToBrowserClient(clientId, force: force)
    }

    private func sendAdoptCommandToBrowserClient(_ clientId: UUID, force: Bool) {
        guard let auto = autonomousSessionStorage else { return }
        if !force && offeredAdoptionClientIds.contains(clientId) {
            return
        }
        offeredAdoptionClientIds.insert(clientId)
        let cmd = OutgoingCommand(
            action: "adopt_native_session",
            positionMs: currentPositionMs(),
            playMode: playMode,
            volume: volume,
            trackId: auto.track.id,
            isPlaying: isPlaying,
            muted: isMuted,
            force: force,
            hdr: config.hdr,
            preferences: preferences
        )
        onInterceptCommandForTest?(cmd)
        bridgeServer.sendCommand(cmd, to: clientId)
    }

    func stopAutonomousPlayback(notifyPeer: Bool = true) {
        exitAutonomousPlayback(adoptedByLocalClient: nil, notifyPeer: notifyPeer)
    }

    private func exitAutonomousPlayback(adoptedByLocalClient clientId: UUID?, notifyPeer: Bool) {
        disconnectTakeoverTask?.cancel()
        disconnectTakeoverTask = nil
        autonomousResolveTask?.cancel()
        autonomousResolveTask = nil
        autonomousPrewarmTask?.cancel()
        autonomousPrewarmTask = nil
        autonomousPeekTask?.cancel()
        autonomousPeekTask = nil
        autonomousPauseSettleTask?.cancel()
        autonomousPauseSettleTask = nil
        autonomousMirrorGlowTask?.cancel()
        autonomousMirrorGlowTask = nil
        autonomousStatePatchThrottleTask?.cancel()
        autonomousStatePatchThrottleTask = nil
        consecutiveAutonomousFailures = 0
        offeredAdoptionClientIds.removeAll()

        nativeAudio.stop()
        setAutonomousSession(nil)

        if notifyPeer && peerService.isConnected {
            peerService.sendAutonomousStop()
        }

        if let clientId, let session = tabSessions[clientId] {
            activeClientId = clientId
            applyActiveSession(session, updateClock: true)
            if peerService.isConnected {
                pushFullSnapshotToConnectedPeer()
            }
        } else {
            if tabSessions[Self.remotePeerVirtualClientId]?.state?.isPlaying != true {
                tabSessions.removeValue(forKey: Self.remotePeerVirtualClientId)
            }
            electNextActiveTab()
        }
        onLayoutTriggerChanged?()
    }
}
