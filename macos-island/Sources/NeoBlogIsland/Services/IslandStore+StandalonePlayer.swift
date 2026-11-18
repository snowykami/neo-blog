import Foundation
import SwiftUI

extension IslandStore {
    // MARK: - 独立播放器入口（无浏览器连接时直连博客歌单 & 离线回退最近连接信息）

    @discardableResult
    func bindBlogOrigin(_ rawInput: String, autoStartPlayback: Bool = false) -> Bool {
        let prevOrigin = library.boundOrigin
        let ok = library.bindOriginManually(rawInput)
        guard ok else { return false }
        let originChanged = !Self.isSameOrigin(prevOrigin, library.boundOrigin)
        if originChanged {
            standaloneColdLaunchTask?.cancel()
            standaloneColdLaunchTask = nil
            if isAutonomousMode {
                stopAutonomousPlayback(notifyPeer: true)
            }
        }
        if !isBrowserCompanionMode && !isAutonomousMode {
            playlist = library.playlist
            playlistComplete = !library.playlist.isEmpty
        }
        if autoStartPlayback {
            startStandalonePlayback(autoPlay: true)
        }
        return true
    }

    func refreshStandalonePlaylist() {
        library.syncPlaylist(force: true)
    }

    /// 启动灵动岛独立播放器：
    /// - 优先恢复上次听到的曲目与毫秒进度（或指定 `trackId`），并完整套用上一次连接保存的 `playMode`、`volume`、外观与歌词偏好；
    /// - 若博客暂时请求不到，直接回退使用本地缓存的歌单与曲目快照，绝不丢失上次连接状态。
    func startStandalonePlayback(
        trackId: Int? = nil,
        autoPlay: Bool = true,
        openPlaylistPanel: Bool = false
    ) {
        let origin = library.boundOrigin
        guard !origin.isEmpty else { return }

        standaloneColdLaunchTask?.cancel()
        standaloneColdLaunchTask = nil

        // 若当前本机尚无任何缓存歌单或单曲快照，等待歌单同步完成后再自动起播（复用进行中的请求，不重复取消，完整对齐 15s 超时）
        if library.playlist.isEmpty && library.lastTrackSnapshot == nil {
            guard networkServicesEnabled else { return }
            if !library.isSyncingPlaylist {
                library.syncPlaylist(force: true)
            }
            standaloneColdLaunchTask = Task { @MainActor [weak self] in
                guard let self else { return }
                await self.library.waitForActiveSync()
                guard !Task.isCancelled,
                      Self.isSameOrigin(self.library.boundOrigin, origin),
                      !self.webSessions.hasAnyLocalPlayingBrowser,
                      !self.library.playlist.isEmpty || self.library.lastTrackSnapshot != nil else {
                    return
                }
                self.launchStandaloneFromAvailableLibrary(
                    origin: origin,
                    explicitTrackId: trackId,
                    autoPlay: autoPlay,
                    openPlaylistPanel: openPlaylistPanel
                )
            }
            return
        }

        launchStandaloneFromAvailableLibrary(
            origin: origin,
            explicitTrackId: trackId,
            autoPlay: autoPlay,
            openPlaylistPanel: openPlaylistPanel
        )
    }

    private func launchStandaloneFromAvailableLibrary(
        origin: String,
        explicitTrackId: Int?,
        autoPlay: Bool,
        openPlaylistPanel: Bool
    ) {
        let saved = library.savedSettings
        playMode = saved.playMode
        volume = saved.volume
        isMuted = saved.isMuted
        preferences = saved.preferences
        let prevFormMode = config.formMode
        config = saved.config

        let currentList = library.playlist
        let targetItem: PlaylistTrackItem? = {
            if let explicitTrackId {
                return currentList.first(where: { $0.id == explicitTrackId })
            }
            return library.resumablePlaylistItem
        }()

        let cachedSnap = library.lastTrackSnapshot
        let resolvedTrack: IslandTrack
        let resolvedIndex: Int?
        if let item = targetItem {
            if let snap = cachedSnap, snap.track.id == item.id {
                resolvedTrack = snap.track
            } else {
                resolvedTrack = StandaloneSongResolver.makeIslandTrack(from: item)
            }
            resolvedIndex = item.index
        } else if let snap = cachedSnap {
            resolvedTrack = snap.track
            resolvedIndex = nil
        } else {
            return
        }

        let matchesCachedSnap = (cachedSnap?.track.id == resolvedTrack.id)
        let isExplicitTrackSwitch = (explicitTrackId != nil && explicitTrackId != library.lastPlayedTrackId)
        let rawResumePos: Double = {
            if isExplicitTrackSwitch { return 0 }
            if matchesCachedSnap {
                return max(library.lastPlayedPositionMs, cachedSnap?.positionMs ?? 0)
            }
            if library.lastPlayedTrackId == resolvedTrack.id {
                return library.lastPlayedPositionMs
            }
            return 0
        }()
        let startPosMs: Double = {
            if resolvedTrack.durationMs > 2500 && rawResumePos >= resolvedTrack.durationMs - 1500 {
                return 0
            }
            return max(0, rawResumePos)
        }()

        let initialLyrics = matchesCachedSnap
            ? RomanizationAligner.withRomanizationWords(cachedSnap?.lyrics ?? .empty)
            : .empty
        let initialChorus = matchesCachedSnap ? (cachedSnap?.chorus ?? []) : []
        let initialAccent = matchesCachedSnap ? cachedSnap?.accentHex : nil
        let initialRhythm = matchesCachedSnap ? cachedSnap?.rhythm : nil
        let initialSongLangLabel: String? = {
            if matchesCachedSnap {
                if let snapLabel = cachedSnap?.songLangLabel, !snapLabel.isEmpty {
                    return snapLabel
                }
                return StandaloneSongResolver.detectLocalLyricsSongLangLabel(initialLyrics) ?? preferences.songLangLabel
            }
            return nil
        }()
        preferences.songLangLabel = initialSongLangLabel
        if !matchesCachedSnap {
            preferences.availableTranslationLangs = []
            preferences.translationsGenerating = false
            preferences.pronunciationsGenerating = false
        }

        let sourceHost = peerService.localPeerId
        if activeOwnerPeerId == nil && peerService.isConnected && displayOwnership == .singleActiveMac {
            activeOwnerPeerId = sourceHost
        }
        let desiredOwner = computeDesiredAudioOwnerPeerId(sourceHostPeerId: sourceHost, origin: origin)

        let payload = AutonomousSessionPayload(
            origin: origin,
            sourceHostPeerId: sourceHost,
            audioOwnerPeerId: desiredOwner,
            track: resolvedTrack,
            accentHex: initialAccent,
            chorus: initialChorus,
            lyrics: initialLyrics,
            rhythm: initialRhythm,
            playlist: currentList,
            playlistComplete: !currentList.isEmpty,
            currentIndex: resolvedIndex,
            preloadedBundles: [],
            livePositionMs: startPosMs,
            isPlaying: autoPlay,
            playMode: playMode,
            volume: volume,
            isMuted: isMuted,
            preferences: preferences,
            config: config
        )

        disconnectTakeoverTask?.cancel()
        snapshotHealTask?.cancel()
        ownershipBeforeUnexpectedPeerDrop = nil
        standaloneInitiatedFromBrowserDisconnect = false
        fallbackSnapshotBeforeFailure = cachedSnap
        consecutiveAutonomousFailures = 0
        setAutonomousSession(payload)

        setActiveClientId(Self.autonomousVirtualClientId)
        startupBannerText = nil
        hiddenTrackId = nil
        setTrack(resolvedTrack)
        effectiveDurationMs = resolvedTrack.durationMs
        accentHex = initialAccent
        chorusRanges = initialChorus
        updateLyrics(initialLyrics, trackId: resolvedTrack.id)
        rhythm = initialRhythm?.toEngineContext() ?? .fallback
        playlist = currentList
        playlistComplete = !currentList.isEmpty
        currentIndex = resolvedIndex
        let hasInitialLyrics = !initialLyrics.lines.isEmpty || initialLyrics.instrumental
        lyricStatus = hasInitialLyrics ? "ready" : (networkServicesEnabled ? "loading" : "ready")
        syncCapabilityFlagsFromLyrics(
            initialLyrics,
            songLangLabel: initialSongLangLabel,
            overwriteSongLang: true,
            availableLangs: preferences.availableTranslationLangs
        )
        seekAtMs = -.infinity
        anchorPositionMs = startPosMs
        anchorLocalDate = Date()
        webVisible = true
        resetStageVisualEngines()

        if networkServicesEnabled {
            IslandArtworkCache.shared.preload(urlStrings: [resolvedTrack.albumPic])
        }

        withAnimation(.spring(duration: 0.36, bounce: 0.22)) {
            isPlaying = autoPlay
            showPlaying = autoPlay
            if openPlaylistPanel && config.expandable {
                isExpanded = true
                showPlaylistOverlay = true
            }
        }
        if !autoPlay {
            let focusIdx = timelineState(at: startPosMs).focus
            let focusLineText = focusIdx.flatMap { lyrics.lines.indices.contains($0) ? lyrics.lines[$0].plainText : nil }
            let cleanFocus = focusLineText?.trimmingCharacters(in: .whitespacesAndNewlines)
            pausedText = (cleanFocus?.isEmpty == false) ? cleanFocus : resolvedTrack.inlineTitle
        } else {
            pausedText = nil
        }

        if prevFormMode != config.formMode || openPlaylistPanel {
            onLayoutTriggerChanged?()
        }

        updateAutonomousGlow(at: startPosMs)
        ensureLocalAutonomousAudioMatchesState()
        broadcastAutonomousFullSyncToPeer()

        if desiredOwner == peerService.localPeerId {
            resolveCurrentAutonomousTrack(refresh: false, preserveExistingLyrics: false)
            if currentList.isEmpty {
                scheduleAutonomousPrewarm(forcePlaylist: true)
            }
        }
        refreshAutonomousMirrorGlowWatcher()
    }

    // MARK: - 原生音频引擎回调与浏览器断联无缝续播

    func setupNativeAudioCallbacks() {
        nativeAudio.onPositionUpdate = { [weak self] posMs, durMs in
            guard let self, self.isAutonomousMode, self.isLocalAutonomousAudioOwner else { return }
            let predicted = self.currentPositionMs()
            if abs(posMs - predicted) > 85 {
                self.anchorPositionMs = posMs
                self.anchorLocalDate = Date()
            }
            if let durMs, durMs > 0, abs(durMs - self.effectiveDurationMs) > 120 {
                self.effectiveDurationMs = durMs
            }
            if self.consecutiveAutonomousFailures > 0 && (posMs - self.autonomousTrackStartAnchorMs) >= 1500 {
                self.consecutiveAutonomousFailures = 0
                self.fallbackSnapshotBeforeFailure = nil
                self.persistCurrentStandaloneSnapshotToLibrary(immediate: false)
            }
            self.autonomousSessionStorage?.livePositionMs = posMs
            if self.consecutiveAutonomousFailures == 0, let tid = self.autonomousSessionStorage?.track.id {
                self.library.recordProgressOnly(trackId: tid, positionMs: posMs, immediate: false)
            }
            self.updateAutonomousGlow(at: posMs)
        }

        nativeAudio.onPlaybackStarted = { [weak self] posMs in
            guard let self, self.isAutonomousMode, self.isLocalAutonomousAudioOwner else { return }
            self.autonomousTrackStartAnchorMs = posMs
            self.setAutonomousBuffering(false)
            self.anchorPositionMs = posMs
            self.anchorLocalDate = Date()
            self.autonomousSessionStorage?.livePositionMs = posMs
            if self.consecutiveAutonomousFailures == 0 {
                self.fallbackSnapshotBeforeFailure = nil
                self.persistCurrentStandaloneSnapshotToLibrary(immediate: false)
            }
            self.broadcastAutonomousStatePatchToPeer(throttled: false)
        }

        nativeAudio.onPlaybackFailed = { [weak self] failedTrackId in
            guard let self, let auto = self.autonomousSessionStorage, self.isLocalAutonomousAudioOwner else { return }
            guard auto.track.id == failedTrackId else { return }
            if self.consecutiveAutonomousFailures == 0 && self.fallbackSnapshotBeforeFailure == nil {
                self.fallbackSnapshotBeforeFailure = self.library.lastTrackSnapshot
            }
            self.setAutonomousBuffering(false)
            self.consecutiveAutonomousFailures += 1
            let maxSkips = min(3, max(0, auto.playlist.count - 1))
            if auto.playlist.count > 1 && self.consecutiveAutonomousFailures <= maxSkips {
                self.logger.warning("曲目 \(failedTrackId) 流加载失败（连续第 \(self.consecutiveAutonomousFailures) 次），自动跳过至下一首")
                self.stepAutonomousTrack(direction: 1, resetFailureCounter: false)
            } else {
                self.logger.error("内置音频流连续加载失败，自动暂停并保留上次缓存快照以防无声空跑或冲掉离线缓存")
                if let fallback = self.fallbackSnapshotBeforeFailure {
                    self.restoreCachedSnapshotAfterOfflineFailure(fallback)
                } else {
                    self.executeAutonomousCommand(OutgoingCommand(action: "pause"))
                }
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

    func setAutonomousSession(_ next: AutonomousSessionPayload?) {
        autonomousSessionStorage = next
        setAutonomousFlags(
            active: next != nil,
            origin: next?.origin ?? "",
            sourceHost: next?.sourceHostPeerId ?? "",
            audioOwner: next?.audioOwnerPeerId ?? ""
        )
    }

    /// 供单元测试模拟本地浏览器 WebSocket 断开
    func simulateClientDisconnectForTesting(_ clientId: UUID) {
        handleLocalClientDisconnected(clientId)
    }

    func handleLocalClientDisconnected(_ clientId: UUID) {
        let removed = webSessions.removeSession(clientId)
        let hasOtherLocalPlayingBrowser = webSessions.hasAnyLocalPlayingBrowser
        let wasExplicitlyPlaying = (removed?.state?.isPlaying == true)
        let teardownPauseRescuedPositionMs = WebBridgeSessionManager.detectTeardownPauseRescuePositionMs(
            removed: removed,
            lastIslandPauseCommandAt: lastIslandPauseCommandAt
        )

        if clientId == activeClientId,
           !hasOtherLocalPlayingBrowser,
           !isAutonomousMode,
           let removed,
           (wasExplicitlyPlaying || teardownPauseRescuedPositionMs != nil),
           let curTrack = removed.track,
           !removed.origin.isEmpty,
           hiddenTrackId != curTrack.id {
            enterAutonomousTakeover(
                from: removed,
                track: curTrack,
                overridePositionMs: teardownPauseRescuedPositionMs
            )
            return
        }

        if activeClientId == clientId && !isAutonomousMode {
            electNextActiveTab()
        }
    }

    func computeDesiredAudioOwnerPeerId(sourceHostPeerId: String, origin: String? = nil) -> String {
        let effectiveOrigin = origin ?? autonomousOrigin
        if displayOwnership == .mirrorBothMacs || Self.isLoopbackOrigin(effectiveOrigin) {
            return sourceHostPeerId
        }
        if peerService.isConnected {
            guard peerService.peerSupportsAutonomousContinuity else {
                return sourceHostPeerId
            }
            return activeOwnerPeerId ?? sourceHostPeerId
        }
        return peerService.localPeerId
    }

    private func enterAutonomousTakeover(
        from session: WebBridgeSessionManager.TabSession,
        track curTrack: IslandTrack,
        overridePositionMs: Double? = nil
    ) {
        let posMs = overridePositionMs ?? currentPositionMs()
        let decodedRhythm: RhythmDataPayload? = session.lastRhythmRawJSON.flatMap {
            try? JSONDecoder().decode(WebRhythmMessage.self, from: $0).rhythm
        }
        let sourceHost = peerService.localPeerId
        let desiredAudioOwner = computeDesiredAudioOwnerPeerId(sourceHostPeerId: sourceHost, origin: session.origin)
        let effectivePlaylist = session.playlist.isEmpty ? library.playlist : session.playlist
        let effectivePlaylistComplete = session.playlistComplete || (!session.playlist.isEmpty ? false : !library.playlist.isEmpty)

        let payload = AutonomousSessionPayload(
            origin: session.origin,
            sourceHostPeerId: sourceHost,
            audioOwnerPeerId: desiredAudioOwner,
            track: curTrack,
            accentHex: session.accentHex,
            chorus: session.chorus,
            lyrics: session.lyrics,
            rhythm: decodedRhythm,
            playlist: effectivePlaylist,
            playlistComplete: effectivePlaylistComplete,
            currentIndex: session.currentIndex ?? effectivePlaylist.first(where: { $0.id == curTrack.id })?.index,
            preloadedBundles: Array(session.preloadedBundles.values),
            livePositionMs: posMs,
            isPlaying: true,
            playMode: playMode,
            volume: volume,
            isMuted: isMuted,
            preferences: preferences,
            config: config
        )

        standaloneColdLaunchTask?.cancel()
        snapshotHealTask?.cancel()
        standaloneInitiatedFromBrowserDisconnect = true
        consecutiveAutonomousFailures = 0
        setAutonomousSession(payload)
        setActiveClientId(Self.autonomousVirtualClientId)
        playlist = effectivePlaylist
        playlistComplete = effectivePlaylistComplete
        webVisible = true
        isPlaying = true
        showPlaying = true
        anchorPositionMs = posMs
        anchorLocalDate = Date()
        updateAutonomousGlow(at: posMs)

        persistCurrentStandaloneSnapshotToLibrary(immediate: true)
        fallbackSnapshotBeforeFailure = library.lastTrackSnapshot

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
        if peerService.isConnected
            && !peerService.peerSupportsAutonomousContinuity
            && displayOwnership == .singleActiveMac
            && activeOwnerPeerId != peerService.localPeerId {
            activeOwnerPeerId = peerService.localPeerId
            peerService.sendOwnershipUpdate(mode: .singleActiveMac, activeOwnerPeerId: peerService.localPeerId)
            onLayoutTriggerChanged?()
        }
        let desiredOwner = computeDesiredAudioOwnerPeerId(sourceHostPeerId: auto.sourceHostPeerId, origin: auto.origin)
        auto.audioOwnerPeerId = desiredOwner
        auto.livePositionMs = currentPositionMs()
        setAutonomousSession(auto)

        logger.info("进入灵动岛独立播放模式: track=\(auto.track.id), audioOwner=\(desiredOwner, privacy: .public)")
        ensureLocalAutonomousAudioMatchesState()
        broadcastAutonomousFullSyncToPeer()

        if desiredOwner == peerService.localPeerId {
            let missingLyrics = auto.lyrics.lines.isEmpty && !auto.lyrics.instrumental
            if missingLyrics || auto.rhythm == nil {
                resolveCurrentAutonomousTrack(refresh: false, preserveExistingLyrics: !missingLyrics)
            } else {
                scheduleAutonomousPrewarm()
            }
        }
        refreshAutonomousMirrorGlowWatcher()
    }

    // MARK: - 跨 Mac 发声权仲裁与报文收发

    func reconcileAutonomousOwnershipTransition() {
        guard var auto = autonomousSessionStorage else { return }
        let prevOwner = auto.audioOwnerPeerId
        let desiredOwner = computeDesiredAudioOwnerPeerId(sourceHostPeerId: auto.sourceHostPeerId, origin: auto.origin)

        if prevOwner == peerService.localPeerId && desiredOwner != peerService.localPeerId {
            let handoffPos = currentPositionMs()
            nativeAudio.stop()
            setAutonomousBuffering(false)
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
        }
        refreshAutonomousMirrorGlowWatcher()
    }

    func applyIncomingAutonomousSync(_ incoming: AutonomousSessionPayload) {
        if let localAuto = autonomousSessionStorage,
           localAuto.audioOwnerPeerId == peerService.localPeerId,
           incoming.audioOwnerPeerId != peerService.localPeerId,
           localAuto.sourceHostPeerId != incoming.sourceHostPeerId {
            // 两台 Mac 离线各自冷启动了独立播放后相遇：播放态优先于暂停态，同态按 peerId 字典序做确定性裁决
            let localWins = (isPlaying != incoming.isPlaying)
                ? isPlaying
                : (peerService.localPeerId < incoming.audioOwnerPeerId)
            if localWins {
                if displayOwnership == .singleActiveMac && activeOwnerPeerId == nil {
                    activeOwnerPeerId = peerService.localPeerId
                }
                broadcastAutonomousFullSyncToPeer()
                return
            }
        }

        disconnectTakeoverTask?.cancel()
        standaloneColdLaunchTask?.cancel()
        snapshotHealTask?.cancel()
        webSessions.removeSession(Self.remotePeerVirtualClientId)

        var synced = incoming
        if let incomingOwnership = synced.displayOwnership {
            displayOwnership = incomingOwnership
            activeOwnerPeerId = synced.activeOwnerPeerId
            if incomingOwnership == .singleActiveMac && synced.activeOwnerPeerId != peerService.localPeerId {
                isExpanded = false
                showPlaylistOverlay = false
            }
        }
        synced.preloadedBundles = autonomousSessionStorage?.preloadedBundles ?? []
        let prevTrackId = track?.id
        let isNewTrack = prevTrackId != synced.track.id

        library.learnOriginFromSession(synced.origin)
        if !synced.playlist.isEmpty {
            library.updatePlaylistFromSession(origin: synced.origin, tracks: synced.playlist, complete: synced.playlistComplete)
        }

        setTrack(synced.track)
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
            resetStageVisualEngines()
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

        setActiveClientId(Self.autonomousVirtualClientId)
        startupBannerText = nil
        webVisible = true
        applyAutonomousPlayStateUI(playing: synced.isPlaying)
        updateAutonomousGlow(at: clampedPos)
        persistSettingsToLibrary()

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

    func applyIncomingAutonomousStatePatch(_ patch: AutonomousStatePatchPayload) {
        guard var auto = autonomousSessionStorage, auto.track.id == patch.trackId else {
            return
        }
        let formChanged = (config.formMode != patch.config.formMode)
        config = patch.config
        if formChanged {
            onLayoutTriggerChanged?()
        }

        auto.sourceHostPeerId = patch.sourceHostPeerId
        auto.audioOwnerPeerId = patch.audioOwnerPeerId
        auto.isPlaying = patch.isPlaying
        auto.playMode = patch.playMode
        auto.volume = patch.volume
        auto.isMuted = patch.isMuted
        auto.preferences = patch.preferences
        auto.config = patch.config

        playMode = patch.playMode
        volume = patch.volume
        isMuted = patch.isMuted
        preferences = patch.preferences

        let isNewLocalOwner = patch.audioOwnerPeerId == peerService.localPeerId
        if !isNewLocalOwner {
            setAutonomousBuffering(patch.isBuffering)
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
        persistSettingsToLibrary()
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

    func ensureLocalAutonomousAudioMatchesState() {
        guard let auto = autonomousSessionStorage else {
            nativeAudio.stop()
            setAutonomousBuffering(false)
            return
        }
        guard auto.audioOwnerPeerId == peerService.localPeerId else {
            nativeAudio.stop()
            setAutonomousBuffering(false)
            return
        }

        nativeAudio.setVolume(volume, isMuted: isMuted)
        let posMs = currentPositionMs()

        if !nativeAudio.isActive || nativeAudio.activeTrackId != auto.track.id {
            if auto.isPlaying {
                setAutonomousBuffering(networkServicesEnabled)
                nativeAudio.startPlayback(
                    origin: auto.origin,
                    track: auto.track,
                    startPositionMs: posMs,
                    autoPlay: true,
                    volume: volume,
                    isMuted: isMuted
                )
                setAutonomousBuffering(nativeAudio.isBuffering)
            } else {
                setAutonomousBuffering(false)
            }
        } else {
            let drift = abs(nativeAudio.lastObservedPositionMs - posMs)
            if drift > 450 {
                nativeAudio.seek(toMs: posMs)
            }
            if auto.isPlaying && !nativeAudio.isPlaying {
                nativeAudio.play()
                setAutonomousBuffering(nativeAudio.isBuffering)
            } else if !auto.isPlaying && nativeAudio.isPlaying {
                nativeAudio.pause()
                setAutonomousBuffering(false)
            }
        }
    }

    func broadcastAutonomousFullSyncToPeer() {
        autonomousStatePatchThrottleTask?.cancel()
        autonomousStatePatchThrottleTask = nil
        guard peerService.isConnected, peerService.peerSupportsAutonomousContinuity, var auto = autonomousSessionStorage else { return }
        auto.livePositionMs = currentPositionMs()
        auto.isPlaying = isPlaying
        auto.playMode = playMode
        auto.volume = volume
        auto.isMuted = isMuted
        auto.preferences = preferences
        auto.config = config
        auto.displayOwnership = displayOwnership
        auto.activeOwnerPeerId = activeOwnerPeerId
        setAutonomousSession(auto)
        lastAutonomousStatePatchSentAt = Date()
        peerService.sendAutonomousSync(auto)
    }

    func broadcastAutonomousStatePatchToPeer(throttled: Bool) {
        guard peerService.isConnected, peerService.peerSupportsAutonomousContinuity, autonomousSessionStorage != nil else { return }
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
        guard peerService.isConnected, peerService.peerSupportsAutonomousContinuity, var auto = autonomousSessionStorage else { return }
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

    // MARK: - 独立播放器指令执行、切歌预热与持久化

    func executeAutonomousCommand(_ cmd: OutgoingCommand) {
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
            setAutonomousBuffering(false)
            auto.isPlaying = false
            auto.livePositionMs = pos
            setAutonomousSession(auto)
            if nativeAudio.isActive {
                nativeAudio.pause()
            }
            applyAutonomousPlayStateUI(playing: false)
            if consecutiveAutonomousFailures == 0 {
                library.recordProgressOnly(trackId: auto.track.id, positionMs: pos, immediate: true)
            }
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
                library.recordProgressOnly(trackId: auto.track.id, positionMs: clamped, immediate: true)
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
                persistSettingsToLibrary()
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
                persistSettingsToLibrary()
                broadcastAutonomousStatePatchToPeer(throttled: true)
            }

        case "toggle_muted":
            isMuted.toggle()
            auto.isMuted = isMuted
            setAutonomousSession(auto)
            nativeAudio.setVolume(volume, isMuted: isMuted)
            persistSettingsToLibrary()
            broadcastAutonomousStatePatchToPeer(throttled: false)

        case "toggle_translation":
            preferences.showTranslation.toggle()
            auto.preferences = preferences
            setAutonomousSession(auto)
            persistSettingsToLibrary()
            broadcastAutonomousStatePatchToPeer(throttled: false)
            if preferences.showTranslation {
                resolveCurrentAutonomousTrack(refresh: false, preserveExistingLyrics: false)
            }

        case "toggle_romaji":
            preferences.showRomaji.toggle()
            auto.preferences = preferences
            setAutonomousSession(auto)
            persistSettingsToLibrary()
            broadcastAutonomousStatePatchToPeer(throttled: false)
            if preferences.showRomaji {
                resolveCurrentAutonomousTrack(refresh: false, preserveExistingLyrics: false)
            }

        case "toggle_effects":
            preferences.showLyricEffects.toggle()
            auto.preferences = preferences
            setAutonomousSession(auto)
            persistSettingsToLibrary()
            broadcastAutonomousStatePatchToPeer(throttled: false)

        case "toggle_moments":
            preferences.showLyricMoments.toggle()
            auto.preferences = preferences
            setAutonomousSession(auto)
            persistSettingsToLibrary()
            broadcastAutonomousStatePatchToPeer(throttled: false)

        case "toggle_hdr":
            config.hdr.toggle()
            auto.config = config
            setAutonomousSession(auto)
            persistSettingsToLibrary()
            broadcastAutonomousStatePatchToPeer(throttled: false)

        case "reset_translation_langs":
            preferences.translationSelections = []
            preferences.showTranslation = true
            auto.preferences = preferences
            setAutonomousSession(auto)
            persistSettingsToLibrary()
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
                persistSettingsToLibrary()
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

    private func persistSettingsToLibrary() {
        library.savePlayerSettings(
            playMode: playMode,
            volume: volume,
            isMuted: isMuted,
            preferences: preferences,
            config: config
        )
    }

    private func persistCurrentStandaloneSnapshotToLibrary(immediate: Bool) {
        persistSettingsToLibrary()
        guard let auto = autonomousSessionStorage else { return }
        library.updateTrackSnapshot(
            origin: auto.origin,
            track: auto.track,
            accentHex: auto.accentHex,
            chorus: auto.chorus,
            lyrics: auto.lyrics,
            rhythm: auto.rhythm,
            songLangLabel: preferences.songLangLabel,
            positionMs: currentPositionMs(),
            immediateFlush: immediate
        )
    }

    private func handleAutonomousTrackEnded() {
        guard let auto = autonomousSessionStorage, auto.audioOwnerPeerId == peerService.localPeerId else { return }
        if playMode == .repeatOne || auto.playlist.count <= 1 {
            anchorPositionMs = 0
            anchorLocalDate = Date()
            seekAtMs = 0
            updateAutonomousGlow(at: 0)
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
        switchToAutonomousTrackItem(auto.playlist[nextPosInArray])
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

        setTrack(nextTrack)
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
        resetStageVisualEngines()
        if networkServicesEnabled {
            IslandArtworkCache.shared.preload(urlStrings: [nextTrack.albumPic])
        }

        let hasPreloadedLyrics = cachedPreload?.lyrics != nil
            && (!(cachedPreload?.lyrics?.lines.isEmpty ?? true) || cachedPreload?.lyrics?.instrumental == true)
        preferences.songLangLabel = nil
        preferences.availableTranslationLangs = []
        preferences.translationsGenerating = false
        preferences.pronunciationsGenerating = false
        if hasPreloadedLyrics, let preLyrics = cachedPreload?.lyrics {
            syncCapabilityFlagsFromLyrics(
                preLyrics,
                songLangLabel: StandaloneSongResolver.detectLocalLyricsSongLangLabel(preLyrics),
                overwriteSongLang: true,
                availableLangs: nil
            )
        } else {
            preferences.canToggleTranslation = false
            preferences.canToggleRomaji = false
        }
        auto.preferences = preferences
        setAutonomousSession(auto)

        applyAutonomousPlayStateUI(playing: true)
        triggerAutonomousTrackPeekIfNeeded(for: nextTrack)
        updateAutonomousGlow(at: 0)
        // 仅在非故障跳曲且离线模拟模式下立即落盘；真实网络模式下待 onPlaybackStarted 或歌词实际返回后再更新缓存曲目，防止整站不可达时冲毁上次缓存
        if consecutiveAutonomousFailures == 0 && !networkServicesEnabled {
            persistCurrentStandaloneSnapshotToLibrary(immediate: true)
        }

        ensureLocalAutonomousAudioMatchesState()
        broadcastAutonomousFullSyncToPeer()
        resolveCurrentAutonomousTrack(refresh: false, preserveExistingLyrics: false)
    }

    private func restoreCachedSnapshotAfterOfflineFailure(_ fallback: StandaloneLibraryStore.CachedTrackSnapshot) {
        guard var auto = autonomousSessionStorage else { return }
        autonomousResolveTask?.cancel()
        nativeAudio.stop()
        setAutonomousBuffering(false)

        let resumePos = max(0, fallback.positionMs)
        let upgradedFallbackLyrics = RomanizationAligner.withRomanizationWords(fallback.lyrics)
        auto.track = fallback.track
        auto.accentHex = fallback.accentHex
        auto.chorus = fallback.chorus
        auto.lyrics = upgradedFallbackLyrics
        auto.rhythm = fallback.rhythm
        auto.currentIndex = auto.playlist.first(where: { $0.id == fallback.track.id })?.index
        auto.livePositionMs = resumePos
        auto.isPlaying = false
        setAutonomousSession(auto)

        setTrack(fallback.track)
        effectiveDurationMs = fallback.track.durationMs
        accentHex = fallback.accentHex
        chorusRanges = fallback.chorus
        updateLyrics(upgradedFallbackLyrics, trackId: fallback.track.id)
        rhythm = fallback.rhythm?.toEngineContext() ?? .fallback
        currentIndex = auto.currentIndex
        lyricStatus = (!fallback.lyrics.lines.isEmpty || fallback.lyrics.instrumental) ? "ready" : "none"
        let restoredSongLangLabel = fallback.songLangLabel
            ?? StandaloneSongResolver.detectLocalLyricsSongLangLabel(upgradedFallbackLyrics)
        syncCapabilityFlagsFromLyrics(
            fallback.lyrics,
            songLangLabel: restoredSongLangLabel,
            overwriteSongLang: true,
            availableLangs: library.savedSettings.preferences.availableTranslationLangs
        )
        auto.preferences = preferences
        setAutonomousSession(auto)
        consecutiveAutonomousFailures = 0
        fallbackSnapshotBeforeFailure = nil
        anchorPositionMs = resumePos
        anchorLocalDate = Date()
        library.updateTrackSnapshot(
            origin: auto.origin,
            track: fallback.track,
            accentHex: fallback.accentHex,
            chorus: fallback.chorus,
            lyrics: fallback.lyrics,
            rhythm: fallback.rhythm,
            songLangLabel: restoredSongLangLabel,
            positionMs: resumePos,
            immediateFlush: true
        )
        applyAutonomousPlayStateUI(playing: false)
        updateAutonomousGlow(at: resumePos)
        broadcastAutonomousFullSyncToPeer()
    }

    private func syncCapabilityFlagsFromLyrics(
        _ bundle: LyricsBundlePayload,
        songLangLabel: String? = nil,
        overwriteSongLang: Bool = false,
        availableLangs: [AvailableTranslationLangItem]?,
        translationsGenerating: Bool = false,
        pronunciationsGenerating: Bool = false
    ) {
        let cleanedSongLang = songLangLabel?.trimmingCharacters(in: .whitespacesAndNewlines)
        if overwriteSongLang {
            preferences.songLangLabel = (cleanedSongLang?.isEmpty == false) ? cleanedSongLang : nil
        } else if let cleanedSongLang, !cleanedSongLang.isEmpty {
            preferences.songLangLabel = cleanedSongLang
        }
        if let availableLangs {
            preferences.availableTranslationLangs = availableLangs
        }
        let hasVocalLines = !bundle.instrumental && !bundle.lines.isEmpty
        preferences.canToggleTranslation = hasVocalLines
        preferences.canToggleRomaji = hasVocalLines
        preferences.translationsGenerating = translationsGenerating
        preferences.pronunciationsGenerating = pronunciationsGenerating
    }

    func resolveCurrentAutonomousTrack(
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
            let existingHasRichExtras = currentAuto.lyrics.lines.contains {
                $0.translation != nil || $0.secondaryTranslation != nil || $0.romanization != nil
            }
            let resolvedHasRichExtras = resolved.lyrics.lines.contains {
                $0.translation != nil || $0.secondaryTranslation != nil || $0.romanization != nil
            }
            let isOfflinePartialHit = existingHasLyrics
                && !refresh
                && resolved.availableTranslationLangs == nil
                && !resolved.lyrics.instrumental
                && existingHasRichExtras
                && !resolvedHasRichExtras
            if (!preserveExistingLyrics && !isOfflinePartialHit) || !existingHasLyrics || refresh {
                if !resolved.lyrics.lines.isEmpty || resolved.lyrics.instrumental || !existingHasLyrics {
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
                songLangLabel: resolved.songLangLabel,
                overwriteSongLang: !isOfflinePartialHit,
                availableLangs: resolved.availableTranslationLangs,
                translationsGenerating: resolved.translationsGenerating,
                pronunciationsGenerating: resolved.pronunciationsGenerating
            )
            currentAuto.preferences = self.preferences
            self.setAutonomousSession(currentAuto)

            self.setTrack(resolved.track)
            if resolved.track.durationMs > 0 && self.effectiveDurationMs <= 0 {
                self.effectiveDurationMs = resolved.track.durationMs
            }
            self.lyricStatus = currentAuto.lyrics.lines.isEmpty && !currentAuto.lyrics.instrumental ? "none" : "ready"
            let fetchedMeaningfulMetadata = !resolved.lyrics.lines.isEmpty
                || resolved.lyrics.instrumental
                || resolved.rhythmData != nil
                || resolved.availableTranslationLangs != nil
            if fetchedMeaningfulMetadata && self.consecutiveAutonomousFailures == 0 {
                self.persistCurrentStandaloneSnapshotToLibrary(immediate: false)
            }
            self.updateAutonomousGlow(at: self.currentPositionMs())
            self.refreshAutonomousMirrorGlowWatcher()
            self.broadcastAutonomousFullSyncToPeer()
            if pollAttempt == 0 {
                self.scheduleAutonomousPrewarm()
            }
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

    func scheduleAutonomousPrewarm(forcePlaylist: Bool = false) {
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
                self.library.updatePlaylistFromSession(origin: origin, tracks: fullList, complete: true)
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

    // MARK: - 独立模式 UI 辅助与反向移交浏览器

    private func applyAutonomousPlayStateUI(playing: Bool) {
        autonomousPauseSettleTask?.cancel()
        if playing {
            withAnimation(.spring(duration: 0.36, bounce: 0.22)) {
                isPlaying = true
                showPlaying = true
            }
            pausedText = nil
            updateAutonomousGlow(at: currentPositionMs())
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
            updateAutonomousGlow(at: pos)
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

    func updateAutonomousGlow(at ms: Double) {
        let nextGlow = StageTimelineEngine.chorusGlow(
            at: ms,
            lyrics: lyrics,
            chorusRanges: chorusRanges,
            enabled: config.chorusGlow && isPlaying,
            accentHex: accentHex
        )
        if glow != nextGlow {
            glow = nextGlow
        }
    }

    func refreshAutonomousMirrorGlowWatcher() {
        let needsTimer = isAutonomousMode && !isLocalAutonomousAudioOwner && isPlaying && config.chorusGlow && !chorusRanges.isEmpty
        if !needsTimer {
            autonomousMirrorGlowTask?.cancel()
            autonomousMirrorGlowTask = nil
            if (!config.chorusGlow || !isPlaying) && glow != nil {
                glow = nil
            }
            return
        }
        guard autonomousMirrorGlowTask == nil else { return }
        autonomousMirrorGlowTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(250))
                guard !Task.isCancelled, let self else { return }
                guard self.isAutonomousMode && !self.isLocalAutonomousAudioOwner && self.isPlaying else {
                    self.autonomousMirrorGlowTask = nil
                    return
                }
                self.updateAutonomousGlow(at: self.currentPositionMs())
            }
        }
    }

    func maybeOfferAutonomousAdoption(
        to clientId: UUID,
        origin: String,
        auto: AutonomousSessionPayload,
        force: Bool
    ) {
        // 用户主动开启的独立播放器模式（非浏览器断联续播），新开普通博客文章页不主动抢回播放权；仅在用户点击「交回浏览器播放」或浏览器主动起播时切换
        if !force && !standaloneInitiatedFromBrowserDisconnect {
            return
        }
        if !force && webSessions.offeredAdoptionClientIds.contains(clientId) {
            return
        }
        guard auto.audioOwnerPeerId == peerService.localPeerId && !isIslandHandedOffToPeer else {
            return
        }
        guard Self.isSameOrigin(origin, auto.origin) else { return }
        sendAdoptCommandToBrowserClient(clientId, force: force)
    }

    func sendAdoptCommandToBrowserClient(_ clientId: UUID, force: Bool) {
        guard let auto = autonomousSessionStorage else { return }
        if !force && webSessions.offeredAdoptionClientIds.contains(clientId) {
            return
        }
        webSessions.offeredAdoptionClientIds.insert(clientId)
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

    func exitAutonomousPlayback(adoptedByLocalClient clientId: UUID?, notifyPeer: Bool) {
        if consecutiveAutonomousFailures == 0 {
            persistCurrentStandaloneSnapshotToLibrary(immediate: true)
        } else {
            persistSettingsToLibrary()
        }
        fallbackSnapshotBeforeFailure = nil

        disconnectTakeoverTask?.cancel()
        disconnectTakeoverTask = nil
        standaloneColdLaunchTask?.cancel()
        standaloneColdLaunchTask = nil
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
        standaloneInitiatedFromBrowserDisconnect = false
        webSessions.offeredAdoptionClientIds.removeAll()

        nativeAudio.stop()
        setAutonomousSession(nil)

        if notifyPeer && peerService.isConnected && peerService.peerSupportsAutonomousContinuity {
            peerService.sendAutonomousStop()
        }

        if let clientId, let session = webSessions[clientId] {
            setActiveClientId(clientId)
            applyActiveSession(session, updateClock: true)
            if peerService.isConnected {
                pushFullSnapshotToConnectedPeer()
            }
        } else {
            if webSessions[Self.remotePeerVirtualClientId]?.state?.isPlaying != true {
                webSessions.removeSession(Self.remotePeerVirtualClientId)
            }
            ownershipBeforeUnexpectedPeerDrop = nil
            electNextActiveTab()
        }
        onLayoutTriggerChanged?()
    }
}
