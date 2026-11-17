import AppKit
import Foundation
import Observation
import os
import SwiftUI

/// 灵动岛显示与遥控状态中心（纯显示端，声音在浏览器播放，遵循 swiftui-expert-skill 使用 @Observable 实现属性级细粒度视图失效）
///
/// 【双端同步维护约定】
/// 新增或修改任何音乐灵动岛特性时，必须与网页端 `web/src/components/layout/topbar-island/music-island.tsx`、
/// `music-island-compact.tsx` 及桥接组件 `web/src/components/common/desktop-island-bridge.tsx` 同步实现，禁止单边演进。
@Observable
@MainActor
final class IslandStore {
    static let remotePeerVirtualClientId = UUID(uuidString: "00000000-0000-0000-8000-00000000BEEF")!

    struct TabSession {
        let clientId: UUID
        var origin: String
        var tabId: String
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
    @ObservationIgnored let bridgeServer = LocalBridgeServer()
    let peerService: PeerContinuityService
    let debrisEngine = DebrisEngine()
    let stageSpringEngine = StageSpringEngine()
    let compactStageParticles = StageParticlesEngine(scale: 0.7, maxParticles: 20)
    let expandedStageParticles = StageParticlesEngine(scale: 0.7, maxParticles: 80)
    @ObservationIgnored private var tabSessions: [UUID: TabSession] = [:]
    @ObservationIgnored private var snapshotHealTask: Task<Void, Never>?
    @ObservationIgnored private var portPollTimer: Timer?

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

    var isDisplayingRemotePeerSession: Bool {
        activeClientId == Self.remotePeerVirtualClientId
    }

    var canPortalThrowToPeer: Bool {
        peerService.isConnected && track != nil
    }

    var isIslandHandedOffToPeer: Bool {
        guard peerService.isConnected, displayOwnership == .singleActiveMac else {
            return false
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
        self.peerService = peerService ?? PeerContinuityService()
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
        let raw = isPlaying
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

    // MARK: - 反向控制指令

    func sendCommand(_ command: OutgoingCommand) {
        onInterceptCommandForTest?(command)
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
        onLayoutTriggerChanged?()
    }

    func play() { sendCommand(OutgoingCommand(action: "play")) }
    func pause() { sendCommand(OutgoingCommand(action: "pause")) }
    func togglePlay() { sendCommand(OutgoingCommand(action: "toggle")) }
    func nextTrack() { sendCommand(OutgoingCommand(action: "next")) }
    func prevTrack() { sendCommand(OutgoingCommand(action: "prev")) }

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
        withAnimation(.spring(duration: 0.34, bounce: 0.2)) {
            isExpanded = false
            showPlaylistOverlay = false
        }
        sendCommand(OutgoingCommand(action: "open_player_page"))
    }

    func hideCurrentTrack() {
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
            guard let self else { return }
            self.tabSessions.removeValue(forKey: clientId)
            if self.activeClientId == clientId {
                self.electNextActiveTab()
            }
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
            self.pushFullSnapshotToConnectedPeer()
        }

        peerService.onPeerDisconnected = { [weak self] _ in
            guard let self else { return }
            self.incomingPortalPreview = nil
            self.portalDragTargetEdge = nil
            self.lastSentPortalPreview = nil
            self.displayOwnership = .singleActiveMac
            self.activeOwnerPeerId = nil
            if self.tabSessions.removeValue(forKey: Self.remotePeerVirtualClientId) != nil,
               self.activeClientId == Self.remotePeerVirtualClientId {
                self.electNextActiveTab()
            }
            self.onLayoutTriggerChanged?()
        }

        peerService.onReceiveFullSnapshot = { [weak self] snap in
            guard let self else { return }
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
            }
            self.onLayoutTriggerChanged?()
        }

        peerService.onReceivePortalThrow = { [weak self] portal in
            guard let self else { return }
            withAnimation(.spring(duration: 0.36, bounce: 0.22)) {
                self.incomingPortalPreview = nil
                self.displayOwnership = .singleActiveMac
                self.activeOwnerPeerId = self.peerService.localPeerId
                self.startupBannerText = nil
                self.hiddenTrackId = nil
            }
            self.onReceivePortalArrival?(portal)
            self.onLayoutTriggerChanged?()
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
            self.onLayoutTriggerChanged?()
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
        }

        switch probe.type {
        case "media":
            guard let msg = decodeJSON(WebMediaMessage.self, from: data, label: "media") else { return }
            if session.track?.id != msg.track?.id {
                session.rhythm = .fallback
            }
            session.track = msg.track
            session.accentHex = msg.accentHex
            session.chorus = msg.chorus ?? []
            session.lyrics = msg.lyrics ?? .empty
            session.lastMediaRawJSON = data
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

        case "state":
            guard let msg = decodeJSON(WebStateMessage.self, from: data, label: "state") else { return }
            if msg.isPlaying || msg.hasPlayed || msg.showPlaying {
                session.hasEverPlayed = true
            }
            session.state = msg
            session.lastStateRawJSON = data
            tabSessions[clientId] = session

            if msg.visible && !fromPeer {
                startupBannerText = nil
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
            let dots = (line.edgeColors ?? []).prefix(3).enumerated().map { dotIdx, hex in
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
}
