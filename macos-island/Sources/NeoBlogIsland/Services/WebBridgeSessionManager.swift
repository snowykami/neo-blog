import Foundation

/// 本地浏览器多标签页与跨屏镜像 WebSocket 会话管理中心（隔离 Tab 粘性仲裁、乐观预加载与页面卸载抢跑暂停识别）
@MainActor
final class WebBridgeSessionManager {
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
        var lastActivelyPlayingAt: Date? = nil
        var lastPausedFromPlayingAt: Date? = nil
        var lastPlayingTrackId: Int? = nil
        var lastPlayingPositionMs: Double = 0

        var hasActivePlayerSession: Bool {
            guard let st = state else { return false }
            return st.isPlaying || st.hasPlayed || st.visible
        }

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

        mutating func recordIncomingState(_ msg: WebStateMessage, fromPeer: Bool, now: Date = Date()) {
            if msg.isPlaying || msg.hasPlayed || msg.showPlaying {
                hasEverPlayed = true
            }
            if !fromPeer {
                if msg.isPlaying {
                    let transitMs = max(0, now.timeIntervalSince1970 * 1000.0 - msg.anchorMs)
                    lastActivelyPlayingAt = now
                    lastPausedFromPlayingAt = nil
                    lastPlayingTrackId = msg.trackId ?? track?.id
                    lastPlayingPositionMs = msg.positionMs + min(transitMs, 200)
                } else if state?.isPlaying == true {
                    // 仅在 true -> false 下降沿记录一次暂停跳变时刻与暂停前推算进度（防止 +350ms pauseSettled 二次帧刷新该时间戳）
                    if let lastPlayAt = lastActivelyPlayingAt {
                        let deltaMs = max(0, now.timeIntervalSince(lastPlayAt) * 1000.0)
                        lastPlayingPositionMs = max(msg.positionMs, lastPlayingPositionMs + deltaMs)
                    } else {
                        lastPlayingPositionMs = max(msg.positionMs, lastPlayingPositionMs)
                    }
                    lastPausedFromPlayingAt = now
                } else if msg.trackId != lastPlayingTrackId {
                    lastPausedFromPlayingAt = nil
                }
            }
            state = msg
        }
    }

    private(set) var sessions: [UUID: TabSession] = [:]
    var offeredAdoptionClientIds: Set<UUID> = []

    subscript(id: UUID) -> TabSession? {
        get { sessions[id] }
        set { sessions[id] = newValue }
    }

    func session(for clientId: UUID, defaultOrigin: String, defaultTabId: String) -> TabSession {
        sessions[clientId] ?? TabSession(clientId: clientId, origin: defaultOrigin, tabId: defaultTabId)
    }

    @discardableResult
    func removeSession(_ clientId: UUID) -> TabSession? {
        offeredAdoptionClientIds.remove(clientId)
        return sessions.removeValue(forKey: clientId)
    }

    var hasAnyLocalPlayingBrowser: Bool {
        sessions.values.contains {
            $0.clientId != IslandStore.remotePeerVirtualClientId && $0.state?.isPlaying == true
        }
    }

    func preferredLocalClient(activeClientId: UUID?, matchingOrigin targetOrigin: String? = nil) -> UUID? {
        let matchesOrigin: (TabSession) -> Bool = { session in
            guard session.clientId != IslandStore.remotePeerVirtualClientId else { return false }
            guard let targetOrigin else { return true }
            return IslandStore.isSameOrigin(session.origin, targetOrigin)
        }
        if let activeClientId,
           let activeSession = sessions[activeClientId],
           matchesOrigin(activeSession) {
            return activeClientId
        }
        return sessions.values.first(where: matchesOrigin)?.clientId
    }

    func shouldPromoteClient(
        _ candidateId: UUID,
        incomingState msg: WebStateMessage,
        activeClientId: UUID?,
        isAutonomousMode: Bool
    ) -> Bool {
        if isAutonomousMode {
            return msg.isPlaying && candidateId != IslandStore.remotePeerVirtualClientId
        }
        guard let curId = activeClientId else { return true }
        if curId == candidateId { return true }
        if msg.isPlaying { return true }
        guard let curSession = sessions[curId] else { return true }
        if !curSession.hasEverPlayed && curSession.state?.visible != true && msg.visible {
            return true
        }
        return false
    }

    func electNextActiveSession() -> TabSession? {
        if let playing = sessions.values.first(where: { $0.state?.isPlaying == true }) {
            return playing
        }
        if let playedTab = sessions.values.first(where: { $0.hasEverPlayed && $0.state?.visible == true }) {
            return playedTab
        }
        if let visibleTab = sessions.values.first(where: { $0.state?.visible == true }) {
            return visibleTab
        }
        return sessions.values.first
    }

    /// 检测刚断连的本地标签页是否属于「页面卸载瞬间 `<audio>` 抢跑发出了 `pause`」并推算卸载前真实毫秒位置
    static func detectTeardownPauseRescuePositionMs(
        removed: TabSession?,
        lastIslandPauseCommandAt: Date,
        now: Date = Date()
    ) -> Double? {
        guard let removed,
              removed.state?.isPlaying != true,
              let curTrack = removed.track,
              let pausedAt = removed.lastPausedFromPlayingAt,
              removed.lastPlayingTrackId == curTrack.id else {
            return nil
        }
        let elapsedSincePause = now.timeIntervalSince(pausedAt)
        guard elapsedSincePause >= 0,
              elapsedSincePause <= 0.65,
              now.timeIntervalSince(lastIslandPauseCommandAt) > 1.2 else {
            return nil
        }
        let extrapolated = removed.lastPlayingPositionMs + elapsedSincePause * 1000.0
        let statePos = removed.state?.positionMs ?? 0
        let candidatePos = max(statePos, extrapolated)
        let durMs = max(removed.state?.durationMs ?? 0, curTrack.durationMs)
        if durMs > 1000 && candidatePos >= durMs - 350 {
            return nil
        }
        return durMs > 0 ? min(durMs, candidatePos) : candidatePos
    }
}
