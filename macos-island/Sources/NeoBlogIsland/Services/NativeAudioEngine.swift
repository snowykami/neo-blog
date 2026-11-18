import AppKit
import AVFoundation
import Foundation
import MediaPlayer
import Observation
import os

/// 灵动岛内置独立音频播放引擎（仅在浏览器断联且本机被选举为 Audio Owner 时激活）：
/// - 基于 AVPlayer 流式播放博客公开音频地址，起播跳转期间先静音定位再开声，杜绝漏出 0:00 首帧杂音；
/// - 激活期间自动接管 macOS 系统媒体中心（MPNowPlayingInfoCenter + MPRemoteCommandCenter），支持键盘媒体键与 AirPods 控播；
/// - 一旦浏览器重连或音频归属流转给另一台 Mac，立即释放 AVPlayer 并注销系统媒体中心回调，将媒体键归还给浏览器。
@Observable
@MainActor
final class NativeAudioEngine {
    @ObservationIgnored private let logger = Logger(subsystem: "org.liteyuki.NeoBlogIsland", category: "NativeAudio")
    @ObservationIgnored private let simulationMode: Bool

    @ObservationIgnored private var player: AVPlayer?
    @ObservationIgnored private var timeObserverToken: Any?
    @ObservationIgnored private var endObserver: NSObjectProtocol?
    @ObservationIgnored private var failObserver: NSObjectProtocol?
    @ObservationIgnored private var itemStatusObservation: NSKeyValueObservation?
    @ObservationIgnored private var timeControlObservation: NSKeyValueObservation?
    @ObservationIgnored private var commandTargets: [(MPRemoteCommand, Any)] = []
    @ObservationIgnored private var loadGeneration: UInt64 = 0
    @ObservationIgnored private var urlResolveTask: Task<Void, Never>?
    @ObservationIgnored private var artworkLoadTask: Task<Void, Never>?
    @ObservationIgnored private var hasReportedPlaybackStartForCurrentItem: Bool = false
    @ObservationIgnored private var hasReportedFailureForCurrentItem: Bool = false
    @ObservationIgnored private var isInitialSeeking: Bool = false
    @ObservationIgnored private var isSeekInFlight: Bool = false
    @ObservationIgnored private var pendingSeekGeneration: UInt64 = 0

    private(set) var isActive: Bool = false
    private(set) var isPlaying: Bool = false
    private(set) var isBuffering: Bool = false
    private(set) var activeTrackId: Int? = nil
    private(set) var activeOrigin: String? = nil
    @ObservationIgnored private var activeAlbumPic: String? = nil
    private(set) var lastObservedPositionMs: Double = 0
    private(set) var resolvedDurationMs: Double = 0

    @ObservationIgnored private var currentVolume: Double = 0.85
    @ObservationIgnored private var currentMuted: Bool = false

    @ObservationIgnored var onPositionUpdate: ((Double, Double?) -> Void)?
    @ObservationIgnored var onPlaybackStarted: ((Double) -> Void)?
    @ObservationIgnored var onPlaybackFailed: ((Int) -> Void)?
    @ObservationIgnored var onTrackEnded: (() -> Void)?
    @ObservationIgnored var onRemotePlay: (() -> Void)?
    @ObservationIgnored var onRemotePause: (() -> Void)?
    @ObservationIgnored var onRemoteToggle: (() -> Void)?
    @ObservationIgnored var onRemoteNext: (() -> Void)?
    @ObservationIgnored var onRemotePrev: (() -> Void)?
    @ObservationIgnored var onRemoteSeek: ((Double) -> Void)?

    init(simulationMode: Bool = false) {
        self.simulationMode = simulationMode
    }

    func startPlayback(
        origin: String,
        track: IslandTrack,
        startPositionMs: Double,
        autoPlay: Bool,
        volume: Double,
        isMuted: Bool
    ) {
        loadGeneration &+= 1
        let gen = loadGeneration
        urlResolveTask?.cancel()
        artworkLoadTask?.cancel()
        hasReportedPlaybackStartForCurrentItem = false
        hasReportedFailureForCurrentItem = false
        isInitialSeeking = false
        isSeekInFlight = false
        pendingSeekGeneration &+= 1

        // 切歌瞬间立即卸载并停止上一首 AVPlayerItem，杜绝异步解析新音频地址期间旧歌继续串音或接收新歌的 Seek/Pause 操作
        if !simulationMode {
            teardownPlayerObservers()
            player?.pause()
            player?.replaceCurrentItem(with: nil)
        }

        currentVolume = max(0, min(1, volume))
        currentMuted = isMuted
        let clampedStartMs = max(0, startPositionMs)

        isActive = true
        isPlaying = autoPlay
        isBuffering = autoPlay && !simulationMode
        activeTrackId = track.id
        activeOrigin = origin
        activeAlbumPic = track.albumPic
        lastObservedPositionMs = clampedStartMs
        resolvedDurationMs = track.durationMs

        if simulationMode {
            if autoPlay {
                hasReportedPlaybackStartForCurrentItem = true
                onPlaybackStarted?(clampedStartMs)
            }
            return
        }

        registerRemoteCommandsIfNeeded()
        updateNowPlayingMetadata(
            track: track,
            positionMs: clampedStartMs,
            durationMs: track.durationMs,
            playing: autoPlay,
            generation: gen
        )

        urlResolveTask = Task { @MainActor [weak self] in
            guard let self, self.loadGeneration == gen else { return }
            let audioURL = await Self.resolveStreamURL(origin: origin, trackId: track.id)
            guard !Task.isCancelled, self.loadGeneration == gen else { return }
            guard let audioURL else {
                self.logger.error("无法解析曲目 \(track.id) 的音频播放地址")
                self.reportCurrentItemFailed(trackId: track.id, generation: gen)
                return
            }
            self.mountPlayerItem(
                url: audioURL,
                track: track,
                startPositionMs: self.lastObservedPositionMs,
                autoPlay: self.isPlaying,
                generation: gen
            )
        }
    }

    /// 供单元测试模拟当前音频流加载/播放失败（403/404/断网）
    func simulateFailureForTesting() {
        guard isActive, let tid = activeTrackId else { return }
        reportCurrentItemFailed(trackId: tid, generation: loadGeneration)
    }

    func play() {
        guard isActive else { return }
        isPlaying = true
        if simulationMode {
            onPlaybackStarted?(lastObservedPositionMs)
            return
        }
        guard let player, player.currentItem != nil else {
            isBuffering = true
            return
        }
        if !isInitialSeeking {
            player.volume = currentMuted ? 0 : Float(currentVolume)
            player.isMuted = currentMuted
            player.play()
        }
        if player.timeControlStatus != .playing {
            isBuffering = true
        }
        syncNowPlayingPlaybackState()
    }

    func pause() {
        guard isActive else { return }
        isPlaying = false
        isBuffering = false
        if simulationMode { return }
        player?.pause()
        syncNowPlayingPlaybackState()
    }

    func seek(toMs ms: Double) {
        guard isActive else { return }
        let clamped = max(0, ms)
        lastObservedPositionMs = clamped
        if simulationMode { return }
        guard let player, player.currentItem != nil else { return }
        let gen = loadGeneration
        pendingSeekGeneration &+= 1
        let seekGen = pendingSeekGeneration
        isSeekInFlight = true
        let target = CMTime(seconds: clamped / 1000.0, preferredTimescale: 1000)
        player.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] finished in
            Task { @MainActor in
                guard let self, self.loadGeneration == gen, self.isActive, self.pendingSeekGeneration == seekGen else {
                    return
                }
                self.isSeekInFlight = false
                if finished {
                    self.lastObservedPositionMs = clamped
                }
                if self.isInitialSeeking {
                    self.isInitialSeeking = false
                    self.player?.volume = self.currentMuted ? 0 : Float(self.currentVolume)
                    self.player?.isMuted = self.currentMuted
                    if self.isPlaying {
                        self.player?.play()
                    }
                }
                if self.player?.timeControlStatus == .playing,
                   (self.isBuffering || !self.hasReportedPlaybackStartForCurrentItem) {
                    self.isBuffering = false
                    self.hasReportedPlaybackStartForCurrentItem = true
                    self.onPlaybackStarted?(clamped)
                }
                self.syncNowPlayingPlaybackState()
            }
        }
    }

    func setVolume(_ volume: Double, isMuted: Bool) {
        currentVolume = max(0, min(1, volume))
        currentMuted = isMuted
        guard isActive, !simulationMode, !isInitialSeeking, let player else { return }
        player.volume = isMuted ? 0 : Float(currentVolume)
        player.isMuted = isMuted
    }

    func stop() {
        loadGeneration &+= 1
        urlResolveTask?.cancel()
        urlResolveTask = nil
        artworkLoadTask?.cancel()
        artworkLoadTask = nil
        hasReportedPlaybackStartForCurrentItem = false
        hasReportedFailureForCurrentItem = false
        isInitialSeeking = false
        isSeekInFlight = false
        pendingSeekGeneration &+= 1

        let wasActive = isActive
        isActive = false
        isPlaying = false
        isBuffering = false
        activeTrackId = nil
        activeOrigin = nil
        activeAlbumPic = nil
        lastObservedPositionMs = 0
        resolvedDurationMs = 0

        if simulationMode { return }

        teardownPlayerObservers()
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        player = nil

        if wasActive {
            unregisterRemoteCommands()
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            MPNowPlayingInfoCenter.default().playbackState = .stopped
        }
    }

    // MARK: - AVPlayer 挂载与精确静音寻址起播

    private func mountPlayerItem(
        url: URL,
        track: IslandTrack,
        startPositionMs: Double,
        autoPlay: Bool,
        generation: UInt64
    ) {
        teardownPlayerObservers()

        let asset = AVURLAsset(url: url)
        let item = AVPlayerItem(asset: asset)
        let avPlayer: AVPlayer
        if let existing = player {
            existing.pause()
            existing.replaceCurrentItem(with: item)
            avPlayer = existing
        } else {
            avPlayer = AVPlayer(playerItem: item)
            avPlayer.automaticallyWaitsToMinimizeStalling = true
            self.player = avPlayer
        }

        // 先置位初始寻址与在途跳转锁，防止 addPeriodicTimeObserver 注册首拍吐出 0.0s 把进度条与接管锚点拽回曲首
        let needsInitialSeek = startPositionMs > 25
        isInitialSeeking = needsInitialSeek
        isSeekInFlight = needsInitialSeek
        pendingSeekGeneration &+= 1
        let initialSeekGen = pendingSeekGeneration
        avPlayer.isMuted = true
        avPlayer.volume = 0

        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.loadGeneration == generation, self.isActive else { return }
                self.onTrackEnded?()
            }
        }

        failObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemFailedToPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.logger.warning("内置音频流中途断流")
                self.reportCurrentItemFailed(trackId: track.id, generation: generation)
            }
        }

        itemStatusObservation = item.observe(\.status, options: [.initial, .new]) { [weak self] observedItem, _ in
            let status = observedItem.status
            let errDesc = observedItem.error?.localizedDescription
            Task { @MainActor in
                guard let self, self.loadGeneration == generation, self.isActive else { return }
                if status == .failed {
                    self.logger.error("AVPlayerItem 加载失败 (track=\(track.id)): \(errDesc ?? "unknown", privacy: .public)")
                    self.reportCurrentItemFailed(trackId: track.id, generation: generation)
                }
            }
        }

        timeControlObservation = avPlayer.observe(\.timeControlStatus, options: [.initial, .new]) { [weak self] observedPlayer, _ in
            let tcStatus = observedPlayer.timeControlStatus
            let curSec = CMTimeGetSeconds(observedPlayer.currentTime())
            Task { @MainActor in
                guard let self, self.loadGeneration == generation, self.isActive else { return }
                switch tcStatus {
                case .playing:
                    guard !self.isInitialSeeking, !self.isSeekInFlight else { return }
                    let posMs = (curSec.isFinite && curSec >= 0) ? (curSec * 1000.0) : self.lastObservedPositionMs
                    self.lastObservedPositionMs = posMs
                    if self.isBuffering || !self.hasReportedPlaybackStartForCurrentItem {
                        self.isBuffering = false
                        self.hasReportedPlaybackStartForCurrentItem = true
                        self.onPlaybackStarted?(posMs)
                    }
                    self.syncNowPlayingPlaybackState()
                case .waitingToPlayAtSpecifiedRate:
                    if self.isPlaying {
                        self.isBuffering = true
                    }
                case .paused:
                    if !self.isPlaying {
                        self.isBuffering = false
                    }
                @unknown default:
                    break
                }
            }
        }

        let interval = CMTime(seconds: 0.25, preferredTimescale: 600)
        timeObserverToken = avPlayer.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] cmTime in
            Task { @MainActor in
                guard let self, self.loadGeneration == generation, self.isActive else { return }
                guard !self.isInitialSeeking, !self.isSeekInFlight else { return }
                let sec = CMTimeGetSeconds(cmTime)
                guard sec.isFinite && sec >= 0 else { return }
                let posMs = sec * 1000.0
                self.lastObservedPositionMs = posMs

                var durMs: Double? = nil
                if let itemDur = self.player?.currentItem?.duration {
                    let dSec = CMTimeGetSeconds(itemDur)
                    if dSec.isFinite && dSec > 0.5 {
                        let dMs = dSec * 1000.0
                        self.resolvedDurationMs = dMs
                        durMs = dMs
                    }
                }
                self.onPositionUpdate?(posMs, durMs)
                self.syncNowPlayingPlaybackState()
            }
        }

        if needsInitialSeek {
            let target = CMTime(seconds: startPositionMs / 1000.0, preferredTimescale: 1000)
            avPlayer.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] finished in
                Task { @MainActor in
                    guard let self,
                          self.loadGeneration == generation,
                          self.isActive,
                          self.pendingSeekGeneration == initialSeekGen else {
                        return
                    }
                    self.isSeekInFlight = false
                    self.isInitialSeeking = false
                    if finished {
                        self.lastObservedPositionMs = startPositionMs
                    }
                    self.player?.volume = self.currentMuted ? 0 : Float(self.currentVolume)
                    self.player?.isMuted = self.currentMuted
                    if self.isPlaying {
                        self.player?.play()
                    }
                    if self.player?.timeControlStatus == .playing,
                       (self.isBuffering || !self.hasReportedPlaybackStartForCurrentItem) {
                        self.isBuffering = false
                        self.hasReportedPlaybackStartForCurrentItem = true
                        self.onPlaybackStarted?(startPositionMs)
                    }
                    self.updateNowPlayingMetadata(
                        track: track,
                        positionMs: startPositionMs,
                        durationMs: self.resolvedDurationMs,
                        playing: self.isPlaying,
                        generation: generation
                    )
                }
            }
        } else {
            isInitialSeeking = false
            isSeekInFlight = false
            avPlayer.volume = currentMuted ? 0 : Float(currentVolume)
            avPlayer.isMuted = currentMuted
            if autoPlay {
                avPlayer.play()
            }
            updateNowPlayingMetadata(
                track: track,
                positionMs: 0,
                durationMs: resolvedDurationMs,
                playing: autoPlay,
                generation: generation
            )
        }
    }

    private func reportCurrentItemFailed(trackId: Int, generation: UInt64) {
        guard loadGeneration == generation, isActive, !hasReportedFailureForCurrentItem else { return }
        hasReportedFailureForCurrentItem = true
        isBuffering = false
        onPlaybackFailed?(trackId)
    }

    private func teardownPlayerObservers() {
        itemStatusObservation?.invalidate()
        itemStatusObservation = nil
        timeControlObservation?.invalidate()
        timeControlObservation = nil
        if let token = timeObserverToken, let player {
            player.removeTimeObserver(token)
        }
        timeObserverToken = nil
        if let obs = endObserver {
            NotificationCenter.default.removeObserver(obs)
            endObserver = nil
        }
        if let obs = failObserver {
            NotificationCenter.default.removeObserver(obs)
            failObserver = nil
        }
    }

    // MARK: - 公开音频流地址解析（优先直取 CDN Range URL，兼容 localhost 跨机流转，失败回退 302 代理地址）

    private struct AudioURLResponseDTO: Decodable {
        struct Payload: Decodable {
            let url: String?
        }
        let data: Payload?
    }

    private nonisolated static func resolveStreamURL(origin: String, trackId: Int) async -> URL? {
        let base = origin.trimmingCharacters(in: CharacterSet(charactersIn: "/ "))
        guard !base.isEmpty else { return nil }

        if let metaURL = URL(string: "\(base)/api/v1/music/song/\(trackId)/audio/url") {
            var req = URLRequest(url: metaURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 4.5)
            req.setValue("application/json", forHTTPHeaderField: "Accept")
            if let (data, resp) = try? await URLSession.shared.data(for: req),
               let http = resp as? HTTPURLResponse,
               (200..<300).contains(http.statusCode),
               let decoded = try? JSONDecoder().decode(AudioURLResponseDTO.self, from: data),
               let directStr = decoded.data?.url,
               !directStr.isEmpty {
                if directStr.hasPrefix("http://") || directStr.hasPrefix("https://"),
                   let directURL = URL(string: directStr) {
                    return directURL
                }
                if directStr.hasPrefix("/"), let relURL = URL(string: "\(base)\(directStr)") {
                    return relURL
                }
            }
        }

        return URL(string: "\(base)/api/v1/music/song/\(trackId)/audio")
    }

    // MARK: - 系统媒体中心（NowPlaying & 媒体键）

    private func registerRemoteCommandsIfNeeded() {
        guard commandTargets.isEmpty else { return }
        let center = MPRemoteCommandCenter.shared()

        let playTarget = Self.addRemoteActionTarget(to: center.playCommand) { [weak self] in
            self?.onRemotePlay?()
        }
        center.playCommand.isEnabled = true

        let pauseTarget = Self.addRemoteActionTarget(to: center.pauseCommand) { [weak self] in
            self?.onRemotePause?()
        }
        center.pauseCommand.isEnabled = true

        let toggleTarget = Self.addRemoteActionTarget(to: center.togglePlayPauseCommand) { [weak self] in
            self?.onRemoteToggle?()
        }
        center.togglePlayPauseCommand.isEnabled = true

        let nextTarget = Self.addRemoteActionTarget(to: center.nextTrackCommand) { [weak self] in
            self?.onRemoteNext?()
        }
        center.nextTrackCommand.isEnabled = true

        let prevTarget = Self.addRemoteActionTarget(to: center.previousTrackCommand) { [weak self] in
            self?.onRemotePrev?()
        }
        center.previousTrackCommand.isEnabled = true

        let seekTarget = Self.addRemoteSeekTarget(to: center.changePlaybackPositionCommand) { [weak self] targetMs in
            self?.onRemoteSeek?(targetMs)
        }
        center.changePlaybackPositionCommand.isEnabled = true

        commandTargets = [
            (center.playCommand, playTarget),
            (center.pauseCommand, pauseTarget),
            (center.togglePlayPauseCommand, toggleTarget),
            (center.nextTrackCommand, nextTarget),
            (center.previousTrackCommand, prevTarget),
            (center.changePlaybackPositionCommand, seekTarget)
        ]
    }

    private func unregisterRemoteCommands() {
        for (cmd, target) in commandTargets {
            cmd.removeTarget(target)
            cmd.isEnabled = false
        }
        commandTargets.removeAll()
    }

    private func updateNowPlayingMetadata(
        track: IslandTrack,
        positionMs: Double,
        durationMs: Double,
        playing: Bool,
        generation: UInt64
    ) {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: track.name,
            MPMediaItemPropertyArtist: (track.displayArtists ?? track.artists).joined(separator: " / "),
            MPMediaItemPropertyAlbumTitle: track.album,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: positionMs / 1000.0,
            MPNowPlayingInfoPropertyPlaybackRate: (playing && !isBuffering) ? 1.0 : 0.0
        ]
        if durationMs > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = durationMs / 1000.0
        }
        if let nsImage = IslandArtworkCache.shared.image(for: track.albumPic),
           let artwork = Self.prepareMediaArtwork(from: nsImage) {
            info[MPMediaItemPropertyArtwork] = artwork
        } else if let picURL = track.albumPic, !picURL.isEmpty {
            artworkLoadTask?.cancel()
            artworkLoadTask = Task { @MainActor [weak self] in
                guard let loaded = await IslandArtworkCache.shared.load(urlString: picURL) else { return }
                guard !Task.isCancelled,
                      let self,
                      self.loadGeneration == generation,
                      self.isActive,
                      self.activeTrackId == track.id,
                      var currentInfo = MPNowPlayingInfoCenter.default().nowPlayingInfo,
                      let artwork = Self.prepareMediaArtwork(from: loaded) else {
                    return
                }
                currentInfo[MPMediaItemPropertyArtwork] = artwork
                MPNowPlayingInfoCenter.default().nowPlayingInfo = currentInfo
            }
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        MPNowPlayingInfoCenter.default().playbackState = playing ? .playing : .paused
    }

    private func syncNowPlayingPlaybackState() {
        guard var info = MPNowPlayingInfoCenter.default().nowPlayingInfo else { return }
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = lastObservedPositionMs / 1000.0
        info[MPNowPlayingInfoPropertyPlaybackRate] = (isPlaying && !isBuffering) ? 1.0 : 0.0
        if resolvedDurationMs > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = resolvedDurationMs / 1000.0
        }
        if info[MPMediaItemPropertyArtwork] == nil,
           let nsImage = IslandArtworkCache.shared.image(for: activeAlbumPic),
           let artwork = Self.prepareMediaArtwork(from: nsImage) {
            info[MPMediaItemPropertyArtwork] = artwork
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        MPNowPlayingInfoCenter.default().playbackState = isPlaying ? .playing : .paused
    }

    private static func prepareMediaArtwork(from nsImage: NSImage) -> MPMediaItemArtwork? {
        guard let tiffData = nsImage.tiffRepresentation else { return nil }
        return makeMediaArtwork(boundsSize: nsImage.size, tiffData: tiffData)
    }

    /// 必须在 nonisolated 上下文中构造 ObjC 回调闭包：
    /// MediaPlayer 框架的 `MPMediaItemArtwork` 与 `MPRemoteCommand` 闭包签名未标注 `@Sendable`，
    /// 若在 `@MainActor` 方法内直接创建闭包，Swift 6 会在闭包入口注入 `_swift_task_checkIsolatedSwift` 断言，
    /// 当 macOS MediaRemote 在后台 XPC 队列拉取封面或派发媒体键时会立即触发 `EXC_BREAKPOINT` 崩溃。
    nonisolated static func makeMediaArtwork(boundsSize: CGSize, tiffData: Data) -> MPMediaItemArtwork {
        let validSize = (boundsSize.width > 0 && boundsSize.height > 0)
            ? boundsSize
            : CGSize(width: 240, height: 240)
        return MPMediaItemArtwork(boundsSize: validSize) { requestedSize in
            if let image = NSImage(data: tiffData) {
                return image
            }
            let fallbackSize = (requestedSize.width > 0 && requestedSize.height > 0) ? requestedSize : validSize
            return NSImage(size: fallbackSize)
        }
    }

    nonisolated static func addRemoteActionTarget(
        to command: MPRemoteCommand,
        action: @escaping @Sendable @MainActor () -> Void
    ) -> Any {
        command.addTarget { _ in
            Task { @MainActor in
                action()
            }
            return .success
        }
    }

    nonisolated static func addRemoteSeekTarget(
        to command: MPChangePlaybackPositionCommand,
        action: @escaping @Sendable @MainActor (Double) -> Void
    ) -> Any {
        command.addTarget { event in
            guard let posEvent = event as? MPChangePlaybackPositionCommandEvent else {
                return .commandFailed
            }
            let targetMs = posEvent.positionTime * 1000.0
            Task { @MainActor in
                action(targetMs)
            }
            return .success
        }
    }
}
