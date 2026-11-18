import Foundation
import Observation
import os

/// 独立播放器曲库与最近连接状态持久化中心：
/// 1. 自动记住最近连接过的博客站点地址（也支持在菜单栏手动绑定/切换站点），结合 `/api/v1/music/playlist/version` 增量同步歌单；
/// 2. 完整持久化博客 REST 接口无法直接提供的用户侧运行态（`playMode`、`volume`、`isMuted`、`formMode`/`hdr` 外观开关、多语翻译与罗马音偏好）；
/// 3. 本地磁盘缓存整份歌单与最近一首曲目的完整歌词/节拍/进度快照，当博客暂时不可达或冷启动尚未完成网络请求时直接沿用上一次连接的信息。
@Observable
@MainActor
final class StandaloneLibraryStore {
    struct PersistedPlayerSettings: Codable, Equatable, Sendable {
        var playMode: PlayMode
        var volume: Double
        var isMuted: Bool
        var preferences: IslandLyricPreferences
        var config: IslandDisplayConfig

        static let `default` = PersistedPlayerSettings(
            playMode: .repeatAll,
            volume: 0.85,
            isMuted: false,
            preferences: .default,
            config: .default
        )
    }

    struct CachedTrackSnapshot: Codable, Equatable, Sendable {
        var track: IslandTrack
        var accentHex: String?
        var chorus: [TimeIntervalRange]
        var lyrics: LyricsBundlePayload
        var rhythm: RhythmDataPayload?
        var songLangLabel: String? = nil
        var positionMs: Double
    }

    private struct DiskCacheEnvelope: Codable, Sendable {
        var origin: String
        var playlistVersion: String?
        var playlist: [PlaylistTrackItem]
        var lastTrackSnapshot: CachedTrackSnapshot?
        var updatedAtEpochSec: Double
    }

    private actor DiskCacheWriter {
        private var latestWrittenGeneration: UInt64 = 0

        func write(_ envelope: DiskCacheEnvelope, generation: UInt64, to targetURL: URL) {
            guard generation >= latestWrittenGeneration else { return }
            latestWrittenGeneration = generation
            guard let data = try? JSONEncoder().encode(envelope) else { return }
            let dir = targetURL.deletingLastPathComponent()
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try? data.write(to: targetURL, options: .atomic)
        }
    }

    private static let boundOriginKey = "NeoBlogIsland.standalone.boundOrigin"
    private static let settingsKey = "NeoBlogIsland.standalone.settings"
    private static let lastTrackIdKey = "NeoBlogIsland.standalone.lastTrackId"
    private static let lastPositionMsKey = "NeoBlogIsland.standalone.lastPositionMs"

    @ObservationIgnored private let logger = Logger(subsystem: "org.liteyuki.NeoBlogIsland", category: "StandaloneLibrary")
    @ObservationIgnored private let diskWriter = DiskCacheWriter()
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let cacheFileURL: URL?
    @ObservationIgnored private let networkEnabled: Bool
    @ObservationIgnored private var activeSyncID: UUID? = nil
    @ObservationIgnored private var syncTask: Task<Void, Never>? = nil
    @ObservationIgnored private var diskFlushTask: Task<Void, Never>? = nil
    @ObservationIgnored private var diskWriteGeneration: UInt64 = 0
    @ObservationIgnored private var lastCheckpointSavedAt: Date = .distantPast

    private(set) var boundOrigin: String
    private(set) var savedSettings: PersistedPlayerSettings
    private(set) var playlist: [PlaylistTrackItem] = []
    private(set) var playlistVersion: String? = nil
    private(set) var lastTrackSnapshot: CachedTrackSnapshot? = nil
    private(set) var lastPlayedTrackId: Int? = nil
    private(set) var lastPlayedPositionMs: Double = 0
    private(set) var isSyncingPlaylist: Bool = false
    private(set) var syncWarning: String? = nil

    var hasBoundOrigin: Bool {
        !boundOrigin.isEmpty
    }

    func hasCachedSnapshot(forTrackId trackId: Int) -> Bool {
        guard let snap = lastTrackSnapshot else { return false }
        return snap.track.id == trackId
    }

    /// 冷启动「继续播放」优先命中的曲目（优先恢复上次听到的曲目，否则取歌单首曲或上次缓存单曲）
    var resumablePlaylistItem: PlaylistTrackItem? {
        if let lastId = lastPlayedTrackId ?? lastTrackSnapshot?.track.id,
           let matched = playlist.first(where: { $0.id == lastId }) {
            return matched
        }
        return playlist.first
    }

    var resumableTrackTitle: String? {
        if let item = resumablePlaylistItem {
            return item.name
        }
        return lastTrackSnapshot?.track.name
    }

    init(
        defaults: UserDefaults = .standard,
        cacheFileURL: URL? = StandaloneLibraryStore.defaultCacheFileURL(),
        networkEnabled: Bool = true
    ) {
        self.defaults = defaults
        self.cacheFileURL = cacheFileURL
        self.networkEnabled = networkEnabled

        let storedOrigin = defaults.string(forKey: Self.boundOriginKey)
            .flatMap(StandaloneSongResolver.normalizeBlogOrigin) ?? ""
        self.boundOrigin = storedOrigin

        if let rawSettings = defaults.data(forKey: Self.settingsKey),
           let decoded = try? JSONDecoder().decode(PersistedPlayerSettings.self, from: rawSettings) {
            self.savedSettings = Self.sanitized(decoded)
        } else {
            self.savedSettings = .default
        }

        let storedTrackId = defaults.integer(forKey: Self.lastTrackIdKey)
        if storedTrackId > 0 {
            self.lastPlayedTrackId = storedTrackId
        }
        let storedPos = defaults.double(forKey: Self.lastPositionMsKey)
        if storedPos.isFinite && storedPos >= 0 {
            self.lastPlayedPositionMs = storedPos
        }

        loadDiskCacheIfMatchingOrigin()
    }

    /// 供离线单元测试构造完全隔离的内存曲库，不读写系统 UserDefaults 或用户目录磁盘
    static func inMemoryForTesting(suiteSuffix: String = UUID().uuidString) -> StandaloneLibraryStore {
        let suite = "NeoBlogIslandTest.StandaloneLib.\(suiteSuffix)"
        let isolated = UserDefaults(suiteName: suite) ?? .standard
        isolated.removePersistentDomain(forName: suite)
        return StandaloneLibraryStore(defaults: isolated, cacheFileURL: nil, networkEnabled: false)
    }

    static func defaultCacheFileURL() -> URL? {
        guard let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            return nil
        }
        return appSupport
            .appendingPathComponent("NeoBlogIsland", isDirectory: true)
            .appendingPathComponent("library-cache.json", isDirectory: false)
    }

    // MARK: - 站点绑定与歌单增量同步

    func refreshOnLaunchIfConfigured() {
        guard networkEnabled, hasBoundOrigin else { return }
        syncPlaylist(force: false)
    }

    /// 手动在菜单栏绑定或切换博客站点地址
    @discardableResult
    func bindOriginManually(_ rawInput: String) -> Bool {
        guard let normalized = StandaloneSongResolver.normalizeBlogOrigin(rawInput) else {
            syncWarning = "请输入有效的博客地址（例如 https://blog.example.com）"
            return false
        }
        syncWarning = nil
        let changed = !IslandStore.isSameOrigin(boundOrigin, normalized)
        boundOrigin = normalized
        defaults.set(normalized, forKey: Self.boundOriginKey)

        if changed {
            playlist = []
            playlistVersion = nil
            lastTrackSnapshot = nil
            lastPlayedTrackId = nil
            lastPlayedPositionMs = 0
            defaults.removeObject(forKey: Self.lastTrackIdKey)
            defaults.removeObject(forKey: Self.lastPositionMsKey)
            loadDiskCacheIfMatchingOrigin()
        }
        if networkEnabled {
            syncPlaylist(force: true)
        } else {
            scheduleDiskFlush(immediate: true)
        }
        return true
    }

    /// 浏览器或跨 Mac 会话连入时自动学习站点地址（已有公网博客绑定时，不被临时 localhost 开发页覆盖）
    func learnOriginFromSession(_ rawOrigin: String) {
        guard let normalized = StandaloneSongResolver.normalizeBlogOrigin(rawOrigin) else { return }
        if !boundOrigin.isEmpty {
            let existingIsPublic = !IslandStore.isLoopbackOrigin(boundOrigin)
            let incomingIsLoopback = IslandStore.isLoopbackOrigin(normalized)
            if existingIsPublic && incomingIsLoopback {
                return
            }
        }
        guard !IslandStore.isSameOrigin(boundOrigin, normalized) else { return }
        boundOrigin = normalized
        defaults.set(normalized, forKey: Self.boundOriginKey)
        syncWarning = nil
        loadDiskCacheIfMatchingOrigin()
        if networkEnabled && playlist.isEmpty {
            syncPlaylist(force: false)
        }
    }

    func syncPlaylist(force: Bool = false) {
        guard networkEnabled else { return }
        let targetOrigin = boundOrigin
        guard !targetOrigin.isEmpty else { return }

        let taskID = UUID()
        activeSyncID = taskID
        isSyncingPlaylist = true
        if force {
            syncWarning = nil
        }

        let cachedVer = playlistVersion
        syncTask?.cancel()
        syncTask = Task { @MainActor [weak self] in
            let outcome = await StandaloneSongResolver.syncPlaylist(
                origin: targetOrigin,
                cachedVersion: cachedVer,
                force: force
            )
            guard !Task.isCancelled,
                  let self,
                  self.activeSyncID == taskID,
                  IslandStore.isSameOrigin(self.boundOrigin, targetOrigin) else {
                return
            }
            self.isSyncingPlaylist = false

            switch outcome {
            case .notModified:
                self.syncWarning = nil

            case .updated(let tracks, let version):
                self.playlist = tracks
                if let version, !version.isEmpty {
                    self.playlistVersion = version
                }
                self.syncWarning = nil
                self.scheduleDiskFlush(immediate: true)

            case .failed(let reason):
                // 博客暂时不可达时完整保留上次连接缓存的歌单与设置，仅在本地无任何缓存时提示原因
                if self.playlist.isEmpty && self.lastTrackSnapshot == nil {
                    self.syncWarning = reason
                } else {
                    self.syncWarning = "博客暂不可达，已沿用上次连接的缓存歌单与播放设置"
                }
                self.logger.warning("同步博客歌单失败，回退本地缓存: \(reason, privacy: .public)")
            }
        }
    }

    func waitForActiveSync() async {
        await syncTask?.value
    }

    // MARK: - 从最近一次浏览器连接 / 独立播放同步状态与快照

    func savePlayerSettings(
        playMode: PlayMode,
        volume: Double,
        isMuted: Bool,
        preferences: IslandLyricPreferences,
        config: IslandDisplayConfig
    ) {
        let next = Self.sanitized(
            PersistedPlayerSettings(
                playMode: playMode,
                volume: max(0, min(1, volume)),
                isMuted: isMuted,
                preferences: preferences,
                config: config
            )
        )
        guard savedSettings != next else { return }
        savedSettings = next
        if let encoded = try? JSONEncoder().encode(next) {
            defaults.set(encoded, forKey: Self.settingsKey)
        }
    }

    func updatePlaylistFromSession(origin: String, tracks: [PlaylistTrackItem], complete: Bool) {
        learnOriginFromSession(origin)
        guard IslandStore.isSameOrigin(boundOrigin, origin), !tracks.isEmpty else { return }
        if complete || playlist.isEmpty || tracks.count >= playlist.count {
            if playlist != tracks {
                playlist = tracks
                syncWarning = nil
                scheduleDiskFlush(immediate: false)
            }
        }
    }

    func updateTrackSnapshot(
        origin: String,
        track: IslandTrack,
        accentHex: String?,
        chorus: [TimeIntervalRange],
        lyrics: LyricsBundlePayload,
        rhythm: RhythmDataPayload?,
        songLangLabel: String? = nil,
        positionMs: Double?,
        immediateFlush: Bool = false
    ) {
        learnOriginFromSession(origin)
        guard boundOrigin.isEmpty || IslandStore.isSameOrigin(boundOrigin, origin) else { return }

        let existingSameTrack = (lastTrackSnapshot?.track.id == track.id)
        let resolvedPos: Double = {
            if let positionMs, positionMs.isFinite {
                return max(0, positionMs)
            }
            if existingSameTrack, let existingPos = lastTrackSnapshot?.positionMs {
                return max(lastPlayedPositionMs, existingPos)
            }
            if lastPlayedTrackId == track.id {
                return lastPlayedPositionMs
            }
            return 0
        }()
        let prevTrackId = lastPlayedTrackId
        lastPlayedTrackId = track.id
        lastPlayedPositionMs = resolvedPos

        var mergedLyrics = lyrics
        var mergedRhythm = rhythm
        var mergedAccent = accentHex
        var mergedChorus = chorus
        var mergedSongLangLabel = songLangLabel?.trimmingCharacters(in: .whitespacesAndNewlines)
        if mergedSongLangLabel?.isEmpty == true {
            mergedSongLangLabel = nil
        }
        if let existing = lastTrackSnapshot, existing.track.id == track.id {
            if mergedLyrics.lines.isEmpty && !mergedLyrics.instrumental {
                mergedLyrics = existing.lyrics
            }
            if mergedRhythm == nil {
                mergedRhythm = existing.rhythm
            }
            if mergedAccent == nil {
                mergedAccent = existing.accentHex
            }
            if mergedChorus.isEmpty {
                mergedChorus = existing.chorus
            }
            if mergedSongLangLabel == nil {
                mergedSongLangLabel = existing.songLangLabel
            }
        }

        lastTrackSnapshot = CachedTrackSnapshot(
            track: track,
            accentHex: mergedAccent,
            chorus: mergedChorus,
            lyrics: mergedLyrics,
            rhythm: mergedRhythm,
            songLangLabel: mergedSongLangLabel,
            positionMs: resolvedPos
        )

        let now = Date()
        if immediateFlush || prevTrackId != track.id || now.timeIntervalSince(lastCheckpointSavedAt) >= 3.0 {
            lastCheckpointSavedAt = now
            defaults.set(track.id, forKey: Self.lastTrackIdKey)
            defaults.set(resolvedPos, forKey: Self.lastPositionMsKey)
            scheduleDiskFlush(immediate: immediateFlush || prevTrackId != track.id)
        }
    }

    func updateTrackSongLangLabel(trackId: Int, songLangLabel: String?) {
        guard var snap = lastTrackSnapshot, snap.track.id == trackId else { return }
        let cleaned = songLangLabel?.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalized = (cleaned?.isEmpty == false) ? cleaned : nil
        guard let normalized, snap.songLangLabel != normalized else { return }
        snap.songLangLabel = normalized
        lastTrackSnapshot = snap
        scheduleDiskFlush(immediate: false)
    }

    func recordProgressOnly(trackId: Int, positionMs: Double, immediate: Bool = false) {
        let clamped = max(0, positionMs.isFinite ? positionMs : 0)
        lastPlayedTrackId = trackId
        lastPlayedPositionMs = clamped
        if lastTrackSnapshot?.track.id == trackId {
            lastTrackSnapshot?.positionMs = clamped
        }
        let now = Date()
        if immediate || now.timeIntervalSince(lastCheckpointSavedAt) >= 3.0 {
            lastCheckpointSavedAt = now
            defaults.set(trackId, forKey: Self.lastTrackIdKey)
            defaults.set(clamped, forKey: Self.lastPositionMsKey)
            if immediate {
                scheduleDiskFlush(immediate: false)
            }
        }
    }

    // MARK: - 本地磁盘读写（Application Support JSON 缓存）

    private static func sanitized(_ raw: PersistedPlayerSettings) -> PersistedPlayerSettings {
        var copy = raw
        copy.volume = max(0, min(1, copy.volume.isFinite ? copy.volume : 0.85))
        copy.preferences.translationsGenerating = false
        copy.preferences.pronunciationsGenerating = false
        return copy
    }

    private func loadDiskCacheIfMatchingOrigin() {
        guard let url = cacheFileURL,
              !boundOrigin.isEmpty,
              let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode(DiskCacheEnvelope.self, from: data),
              IslandStore.isSameOrigin(decoded.origin, boundOrigin) else {
            return
        }
        self.playlistVersion = decoded.playlistVersion
        self.playlist = decoded.playlist
        self.lastTrackSnapshot = decoded.lastTrackSnapshot
        if lastPlayedTrackId == nil, let snapId = decoded.lastTrackSnapshot?.track.id {
            self.lastPlayedTrackId = snapId
            self.lastPlayedPositionMs = decoded.lastTrackSnapshot?.positionMs ?? 0
        }
    }

    private func scheduleDiskFlush(immediate: Bool) {
        guard let targetURL = cacheFileURL, !boundOrigin.isEmpty else { return }
        diskFlushTask?.cancel()
        if immediate {
            flushDiskCacheNow(to: targetURL)
        } else {
            diskFlushTask = Task { @MainActor [weak self] in
                try? await Task.sleep(for: .milliseconds(1200))
                guard !Task.isCancelled, let self else { return }
                self.flushDiskCacheNow(to: targetURL)
            }
        }
    }

    func flushNowForTesting() async {
        diskFlushTask?.cancel()
        diskFlushTask = nil
        guard let targetURL = cacheFileURL, !boundOrigin.isEmpty else { return }
        diskWriteGeneration &+= 1
        let gen = diskWriteGeneration
        let envelope = DiskCacheEnvelope(
            origin: boundOrigin,
            playlistVersion: playlistVersion,
            playlist: playlist,
            lastTrackSnapshot: lastTrackSnapshot,
            updatedAtEpochSec: Date().timeIntervalSince1970
        )
        await diskWriter.write(envelope, generation: gen, to: targetURL)
    }

    private func flushDiskCacheNow(to targetURL: URL) {
        guard !boundOrigin.isEmpty else { return }
        diskWriteGeneration &+= 1
        let gen = diskWriteGeneration
        let envelope = DiskCacheEnvelope(
            origin: boundOrigin,
            playlistVersion: playlistVersion,
            playlist: playlist,
            lastTrackSnapshot: lastTrackSnapshot,
            updatedAtEpochSec: Date().timeIntervalSince1970
        )
        let writer = diskWriter
        Task(priority: .utility) {
            await writer.write(envelope, generation: gen, to: targetURL)
        }
    }
}
