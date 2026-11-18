import AppKit
import CryptoKit
import Foundation
import Observation
import os

enum UpdateChannel: String, CaseIterable, Codable, Sendable {
    case stable
    case nightly

    var label: String {
        switch self {
        case .stable: return "正式版"
        case .nightly: return "Nightly"
        }
    }
}

struct SemanticVersion: Comparable, Equatable, Sendable {
    let major: Int
    let minor: Int
    let patch: Int

    init?(_ raw: String) {
        let trimmed = raw
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "^(island-)?v", with: "", options: .regularExpression)
        let core = trimmed.split(separator: "-", maxSplits: 1).first.map(String.init) ?? trimmed
        let parts = core.split(separator: ".")
        guard !parts.isEmpty, let maj = Int(parts[0]) else { return nil }
        let minVal = parts.count > 1 ? (Int(parts[1]) ?? 0) : 0
        let patVal = parts.count > 2 ? (Int(parts[2]) ?? 0) : 0
        self.major = maj
        self.minor = minVal
        self.patch = patVal
    }

    static func < (lhs: SemanticVersion, rhs: SemanticVersion) -> Bool {
        if lhs.major != rhs.major { return lhs.major < rhs.major }
        if lhs.minor != rhs.minor { return lhs.minor < rhs.minor }
        return lhs.patch < rhs.patch
    }
}

struct InstalledAppVersion: Equatable, Sendable {
    let version: String
    let buildNumber: String
    let commitSHA: String?
    let channel: UpdateChannel
    let repoSlug: String
    let bundleURL: URL

    var displayBadge: String {
        switch channel {
        case .nightly:
            if let sha = commitSHA, !sha.isEmpty {
                return "Nightly · \(sha.prefix(7))"
            }
            return version
        case .stable:
            return "v\(version)"
        }
    }

    static func current(
        info: [String: Any]? = Bundle.main.infoDictionary,
        bundleURL: URL = Bundle.main.bundleURL
    ) -> InstalledAppVersion {
        let rawVersion = (info?["CFBundleShortVersionString"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let version = (rawVersion?.isEmpty == false) ? rawVersion! : "0.2.0"
        let buildNumber = (info?["CFBundleVersion"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? "1"
        let repoSlug = (info?["NeoBlogGitHubRepo"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? "snowykami/neo-blog"

        let rawChannel = (info?["NeoBlogReleaseChannel"] as? String)?.lowercased()
        let channel: UpdateChannel = (rawChannel == "nightly" || version.lowercased().contains("nightly"))
            ? .nightly
            : .stable

        let rawCommit = (info?["NeoBlogGitCommit"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        let commitSHA: String? = {
            if let c = rawCommit, AppUpdateService.isHexCommit(c) {
                return c
            }
            if let range = version.lowercased().range(of: "-nightly.") {
                let tail = String(version[range.upperBound...])
                    .split(separator: ".")
                    .first
                    .map(String.init)?
                    .lowercased()
                if let t = tail, AppUpdateService.isHexCommit(t) {
                    return t
                }
            }
            return nil
        }()

        return InstalledAppVersion(
            version: version,
            buildNumber: buildNumber,
            commitSHA: commitSHA,
            channel: channel,
            repoSlug: repoSlug,
            bundleURL: bundleURL
        )
    }
}

struct RemoteReleaseInfo: Equatable, Sendable {
    let channel: UpdateChannel
    let tagName: String
    let displayVersion: String
    let commitSHA: String?
    let publishedAt: Date?
    let htmlURL: URL?
    let zipDownloadURL: URL
    let zipSizeBytes: Int64
    let checksumDownloadURL: URL?
}

struct GitHubAssetDTO: Decodable, Sendable {
    let name: String
    let size: Int64
    let updatedAt: String?
    let browserDownloadUrl: String

    enum CodingKeys: String, CodingKey {
        case name, size
        case updatedAt = "updated_at"
        case browserDownloadUrl = "browser_download_url"
    }
}

struct GitHubReleaseDTO: Decodable, Sendable {
    let tagName: String
    let name: String?
    let body: String?
    let draft: Bool
    let prerelease: Bool
    let targetCommitish: String?
    let publishedAt: String?
    let htmlUrl: String?
    let assets: [GitHubAssetDTO]

    enum CodingKeys: String, CodingKey {
        case name, body, draft, prerelease, assets
        case tagName = "tag_name"
        case targetCommitish = "target_commitish"
        case publishedAt = "published_at"
        case htmlUrl = "html_url"
    }
}

/// 灵动岛自更新服务：
/// - 自动识别当前运行版本所属通道（正式版 `island-v*` / 每日构建 `island-nightly`），亦支持手动切换通道
/// - 从 GitHub Actions 发布的 Releases 拉取 Universal `.app.zip` 与 `SHA256SUMS.txt` 校验摘要
/// - 后台流式下载、SHA-256 完整性校验、`ditto` 解压与隔离属性清除后，拉起独立守护脚本等待主进程退出、原子替换 `.app` 并自动重启
@Observable
@MainActor
final class AppUpdateService {
    enum State: Equatable, Sendable {
        case idle
        case checking
        case upToDate(versionLabel: String)
        case available(release: RemoteReleaseInfo, isChannelSwitch: Bool)
        case downloading(release: RemoteReleaseInfo, progress: Double, downloadedBytes: Int64, totalBytes: Int64)
        case verifying(release: RemoteReleaseInfo)
        case restarting(release: RemoteReleaseInfo)
        case failed(message: String, fallbackURL: URL?)
    }

    @ObservationIgnored private let logger = Logger(subsystem: "org.liteyuki.NeoBlogIsland", category: "AppUpdate")
    @ObservationIgnored private var activeTask: Task<Void, Never>?
    @ObservationIgnored private var activeTaskID = UUID()

    let installed: InstalledAppVersion
    var selectedChannel: UpdateChannel
    private(set) var state: State = .idle
    private(set) var isForceUpdating: Bool = false

    var hasAvailableUpdate: Bool {
        if case .available = state { return true }
        return false
    }

    var channelSelection: UpdateChannel {
        get { selectedChannel }
        set { selectChannel(newValue) }
    }

    init(
        installed: InstalledAppVersion = .current(),
        startBackgroundCheck: Bool = false
    ) {
        self.installed = installed
        self.selectedChannel = installed.channel

        if startBackgroundCheck && installed.bundleURL.pathExtension == "app" {
            Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(6))
                self?.checkForUpdates(silent: true)
            }
        }
    }

    func selectChannel(_ channel: UpdateChannel) {
        guard selectedChannel != channel else { return }
        if isForceUpdating { return }
        switch state {
        case .downloading, .verifying, .restarting:
            return
        default:
            break
        }
        activeTask?.cancel()
        activeTask = nil
        activeTaskID = UUID()
        selectedChannel = channel
        checkForUpdates(silent: false)
    }

    func cancelActiveDownload() {
        activeTask?.cancel()
        activeTask = nil
        activeTaskID = UUID()
        isForceUpdating = false
        state = .idle
    }

    func checkForUpdates(silent: Bool = false) {
        if isForceUpdating { return }
        if silent {
            guard state == .idle, activeTask == nil else { return }
        }
        switch state {
        case .downloading, .verifying, .restarting:
            return
        default:
            break
        }

        activeTask?.cancel()
        let taskID = UUID()
        activeTaskID = taskID
        if !silent {
            state = .checking
        }
        let channel = selectedChannel
        let currentInstalled = installed

        activeTask = Task { @MainActor [weak self] in
            guard let self else { return }
            defer {
                if self.activeTaskID == taskID {
                    self.activeTask = nil
                }
            }
            do {
                let remote = try await Self.fetchLatestRelease(
                    repoSlug: currentInstalled.repoSlug,
                    channel: channel,
                    userAgentVersion: currentInstalled.version
                )
                guard !Task.isCancelled, self.activeTaskID == taskID else { return }

                let decision = Self.evaluateUpdate(
                    installed: currentInstalled,
                    remote: remote,
                    targetChannel: channel
                )
                if decision.available {
                    self.state = .available(release: remote, isChannelSwitch: decision.isChannelSwitch)
                } else if !silent {
                    self.state = .upToDate(versionLabel: remote.displayVersion)
                }
            } catch is CancellationError {
                return
            } catch {
                guard !Task.isCancelled, self.activeTaskID == taskID else { return }
                self.logger.error("检查更新失败: \(error.localizedDescription, privacy: .public)")
                if !silent {
                    let releasesPage = URL(string: "https://github.com/\(currentInstalled.repoSlug)/releases")
                    self.state = .failed(
                        message: error.localizedDescription,
                        fallbackURL: releasesPage
                    )
                }
            }
        }
    }

    /// 绕过 `api.github.com` 限流与本地版本号对比，直接拉取当前选中通道的最新安装包并校验重装
    func forceUpdate() {
        switch state {
        case .downloading, .verifying, .restarting:
            return
        default:
            break
        }

        let currentInstalled = installed
        let channel = selectedChannel
        let releasesPage = URL(string: "https://github.com/\(currentInstalled.repoSlug)/releases")

        guard currentInstalled.bundleURL.pathExtension == "app" else {
            state = .failed(
                message: "当前以命令行调试方式运行（非 .app 应用包），请构建应用包后再执行自动替换更新。",
                fallbackURL: releasesPage
            )
            return
        }

        if case .available(let existing, _) = state, existing.channel == channel {
            downloadAndInstall(existing)
            return
        }

        activeTask?.cancel()
        let taskID = UUID()
        activeTaskID = taskID
        isForceUpdating = true
        state = .checking

        activeTask = Task { @MainActor [weak self] in
            guard let self else { return }
            defer {
                if self.activeTaskID == taskID {
                    self.activeTask = nil
                }
            }
            let resolvedRelease: RemoteReleaseInfo
            do {
                resolvedRelease = try await Self.resolveReleaseForForceUpdate(
                    installed: currentInstalled,
                    channel: channel
                )
                try Task.checkCancellation()
            } catch is CancellationError {
                if self.activeTaskID == taskID {
                    self.isForceUpdating = false
                }
                return
            } catch {
                guard self.activeTaskID == taskID else { return }
                self.isForceUpdating = false
                guard !Task.isCancelled else { return }
                self.logger.error("准备强制更新失败: \(error.localizedDescription, privacy: .public)")
                self.state = .failed(
                    message: error.localizedDescription,
                    fallbackURL: releasesPage
                )
                return
            }

            guard self.activeTaskID == taskID else { return }
            self.isForceUpdating = false
            await self.performDownloadAndInstall(
                resolvedRelease,
                currentInstalled: currentInstalled,
                taskID: taskID
            )
        }
    }

    func downloadAndInstall(_ release: RemoteReleaseInfo) {
        guard installed.bundleURL.pathExtension == "app" else {
            state = .failed(
                message: "当前以命令行调试方式运行（非 .app 应用包），请构建应用包后再执行自动替换更新。",
                fallbackURL: release.htmlURL
            )
            return
        }

        activeTask?.cancel()
        let taskID = UUID()
        activeTaskID = taskID
        isForceUpdating = false
        let currentInstalled = installed
        activeTask = Task { @MainActor [weak self] in
            guard let self else { return }
            defer {
                if self.activeTaskID == taskID {
                    self.activeTask = nil
                }
            }
            await self.performDownloadAndInstall(
                release,
                currentInstalled: currentInstalled,
                taskID: taskID
            )
        }
    }

    private func performDownloadAndInstall(
        _ release: RemoteReleaseInfo,
        currentInstalled: InstalledAppVersion,
        taskID: UUID
    ) async {
        guard activeTaskID == taskID else { return }
        state = .downloading(
            release: release,
            progress: 0,
            downloadedBytes: 0,
            totalBytes: release.zipSizeBytes
        )

        let stagingDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("NeoBlogIslandUpdate-\(UUID().uuidString)", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: stagingDir, withIntermediateDirectories: true)

            var expectedSHA256: String? = nil
            if let sumURL = release.checksumDownloadURL {
                expectedSHA256 = try await Self.fetchExpectedZipSHA256(
                    from: sumURL,
                    zipAssetName: release.zipDownloadURL.lastPathComponent,
                    userAgentVersion: currentInstalled.version
                )
                try Task.checkCancellation()
                guard self.activeTaskID == taskID else {
                    try? FileManager.default.removeItem(at: stagingDir)
                    return
                }
            }

            let zipFileURL = stagingDir.appendingPathComponent("NeoBlogIsland-update.app.zip")
            try await self.downloadFileWithProgress(
                from: release.zipDownloadURL,
                to: zipFileURL,
                release: release,
                userAgentVersion: currentInstalled.version,
                taskID: taskID
            )
            try Task.checkCancellation()
            guard self.activeTaskID == taskID else {
                try? FileManager.default.removeItem(at: stagingDir)
                return
            }

            self.state = .verifying(release: release)
            let stagedAppURL = try await Task.detached(priority: .userInitiated) {
                try Self.verifyAndUnpackArchive(
                    zipFileURL: zipFileURL,
                    stagingDir: stagingDir,
                    expectedSHA256: expectedSHA256
                )
            }.value
            try Task.checkCancellation()
            guard self.activeTaskID == taskID else {
                try? FileManager.default.removeItem(at: stagingDir)
                return
            }

            self.state = .restarting(release: release)
            let targetAppURL = Self.resolveInstallTargetURL(currentBundleURL: currentInstalled.bundleURL)
            let scriptURL = try Self.writeDetachedUpdaterScript(in: stagingDir)
            try Self.launchDetachedUpdater(
                scriptURL: scriptURL,
                stagingDir: stagingDir,
                stagedAppURL: stagedAppURL,
                targetAppURL: targetAppURL,
                oldPID: ProcessInfo.processInfo.processIdentifier
            )

            // 给守护脚本预留进程附着窗口后立即平滑退出本进程，由守护脚本接管原子替换与重开
            try? await Task.sleep(for: .milliseconds(120))
            NSApplication.shared.terminate(nil)
        } catch is CancellationError {
            try? FileManager.default.removeItem(at: stagingDir)
        } catch {
            try? FileManager.default.removeItem(at: stagingDir)
            guard !Task.isCancelled, self.activeTaskID == taskID else { return }
            self.logger.error("下载或安装更新失败: \(error.localizedDescription, privacy: .public)")
            self.state = .failed(
                message: error.localizedDescription,
                fallbackURL: release.htmlURL ?? URL(string: "https://github.com/\(currentInstalled.repoSlug)/releases")
            )
        }
    }

    // MARK: - 网络请求与下载进度流

    private func downloadFileWithProgress(
        from url: URL,
        to destination: URL,
        release: RemoteReleaseInfo,
        userAgentVersion: String,
        taskID: UUID
    ) async throws {
        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 120)
        req.setValue("NeoBlogIsland/\(userAgentVersion)", forHTTPHeaderField: "User-Agent")

        let (bytes, response) = try await URLSession.shared.bytes(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let code = (response as? HTTPURLResponse)?.statusCode ?? -1
            throw NSError(
                domain: "AppUpdateService",
                code: code,
                userInfo: [NSLocalizedDescriptionKey: "下载更新包失败（HTTP \(code)）"]
            )
        }

        let totalBytes = http.expectedContentLength > 0 ? http.expectedContentLength : release.zipSizeBytes
        if totalBytes > 0 && release.zipSizeBytes <= 0 && self.activeTaskID == taskID {
            self.state = .downloading(
                release: release,
                progress: 0,
                downloadedBytes: 0,
                totalBytes: totalBytes
            )
        }
        FileManager.default.createFile(atPath: destination.path, contents: nil)
        let handle = try FileHandle(forWritingTo: destination)
        defer { try? handle.close() }

        var buffer = Data()
        buffer.reserveCapacity(65_536)
        var downloaded: Int64 = 0
        var lastReported: Int64 = 0

        for try await byte in bytes {
            buffer.append(byte)
            if buffer.count >= 65_536 {
                try Task.checkCancellation()
                guard self.activeTaskID == taskID else { throw CancellationError() }
                try handle.write(contentsOf: buffer)
                downloaded += Int64(buffer.count)
                buffer.removeAll(keepingCapacity: true)

                if downloaded - lastReported >= 65_536 || (totalBytes > 0 && downloaded >= totalBytes) {
                    lastReported = downloaded
                    let prog = totalBytes > 0 ? min(0.99, Double(downloaded) / Double(totalBytes)) : 0
                    self.state = .downloading(
                        release: release,
                        progress: prog,
                        downloadedBytes: downloaded,
                        totalBytes: totalBytes
                    )
                }
            }
        }

        if !buffer.isEmpty {
            try Task.checkCancellation()
            guard self.activeTaskID == taskID else { throw CancellationError() }
            try handle.write(contentsOf: buffer)
            downloaded += Int64(buffer.count)
        }

        guard self.activeTaskID == taskID else { throw CancellationError() }
        self.state = .downloading(
            release: release,
            progress: 1.0,
            downloadedBytes: downloaded,
            totalBytes: max(totalBytes, downloaded)
        )
    }

    // MARK: - 纯函数协议解析、版本比对与校验（支持无网络单元测试）

    nonisolated static func isHexCommit(_ raw: String?) -> Bool {
        guard let s = raw, (7...40).contains(s.count) else { return false }
        return s.unicodeScalars.allSatisfy {
            ("0"..."9").contains($0) || ("a"..."f").contains($0) || ("A"..."F").contains($0)
        }
    }

    nonisolated static func commitsMatch(_ a: String?, _ b: String?) -> Bool {
        guard let sa = a?.lowercased(), let sb = b?.lowercased(),
              isHexCommit(sa), isHexCommit(sb) else {
            return false
        }
        return sa.hasPrefix(sb) || sb.hasPrefix(sa)
    }

    nonisolated static func evaluateUpdate(
        installed: InstalledAppVersion,
        remote: RemoteReleaseInfo,
        targetChannel: UpdateChannel
    ) -> (available: Bool, isChannelSwitch: Bool) {
        switch targetChannel {
        case .stable:
            if installed.channel == .nightly {
                return (true, true)
            }
            guard let remoteVer = SemanticVersion(remote.displayVersion),
                  let localVer = SemanticVersion(installed.version) else {
                let rawDiff = remote.displayVersion != installed.version && remote.displayVersion != "v\(installed.version)"
                return (rawDiff, false)
            }
            return (remoteVer > localVer, false)

        case .nightly:
            if installed.channel == .stable {
                if commitsMatch(installed.commitSHA, remote.commitSHA) {
                    return (false, false)
                }
                return (true, true)
            }
            if let localSHA = installed.commitSHA, let remoteSHA = remote.commitSHA {
                return (!commitsMatch(localSHA, remoteSHA), false)
            }
            return (remote.displayVersion != installed.version, false)
        }
    }

    nonisolated static func parseNightlyRelease(_ dto: GitHubReleaseDTO) -> RemoteReleaseInfo? {
        guard !dto.draft,
              let zipAsset = dto.assets.first(where: { $0.name == "NeoBlogIsland-universal.app.zip" })
                ?? dto.assets.first(where: { $0.name.hasSuffix(".app.zip") }),
              let zipURL = URL(string: zipAsset.browserDownloadUrl) else {
            return nil
        }

        let checksumURL = dto.assets
            .first(where: { $0.name == "SHA256SUMS.txt" })
            .flatMap { URL(string: $0.browserDownloadUrl) }

        let body = dto.body ?? ""
        let extractedVersion = firstRegexCapture(pattern: #"版本标识\*\*：`([^`]+)`"#, in: body)
        let extractedCommitFromBody = firstRegexCapture(pattern: #"对应提交\*\*：`([0-9a-fA-F]{7,40})`"#, in: body)

        let commitSHA: String? = {
            if let tc = dto.targetCommitish?.trimmingCharacters(in: .whitespacesAndNewlines), isHexCommit(tc) {
                return tc.lowercased()
            }
            if let bc = extractedCommitFromBody, isHexCommit(bc) {
                return bc.lowercased()
            }
            if let ver = extractedVersion, let range = ver.lowercased().range(of: "-nightly.") {
                let tail = String(ver[range.upperBound...]).lowercased()
                if isHexCommit(tail) { return tail }
            }
            return nil
        }()

        let displayVersion: String = {
            if let ver = extractedVersion, !ver.isEmpty {
                return ver
            }
            if let sha = commitSHA {
                return "Nightly · \(sha.prefix(7))"
            }
            return dto.name ?? dto.tagName
        }()

        let dateStr = zipAsset.updatedAt ?? dto.publishedAt
        let publishedDate = parseISO8601Date(dateStr)

        return RemoteReleaseInfo(
            channel: .nightly,
            tagName: dto.tagName,
            displayVersion: displayVersion,
            commitSHA: commitSHA,
            publishedAt: publishedDate,
            htmlURL: dto.htmlUrl.flatMap(URL.init(string:)),
            zipDownloadURL: zipURL,
            zipSizeBytes: zipAsset.size,
            checksumDownloadURL: checksumURL
        )
    }

    nonisolated static func selectLatestStableRelease(from releases: [GitHubReleaseDTO]) -> RemoteReleaseInfo? {
        var candidates: [(semver: SemanticVersion, info: RemoteReleaseInfo)] = []

        for dto in releases where !dto.draft && !dto.prerelease && dto.tagName.hasPrefix("island-v") {
            guard let zipAsset = dto.assets.first(where: { $0.name == "NeoBlogIsland-universal.app.zip" })
                    ?? dto.assets.first(where: { $0.name.hasSuffix(".app.zip") }),
                  let zipURL = URL(string: zipAsset.browserDownloadUrl) else {
                continue
            }
            let cleanVer = String(dto.tagName.dropFirst("island-v".count))
            guard !cleanVer.contains("-"), let semver = SemanticVersion(cleanVer) else { continue }

            let checksumURL = dto.assets
                .first(where: { $0.name == "SHA256SUMS.txt" })
                .flatMap { URL(string: $0.browserDownloadUrl) }
            let pubDate = parseISO8601Date(zipAsset.updatedAt ?? dto.publishedAt)
            let commit = dto.targetCommitish.flatMap { isHexCommit($0) ? $0.lowercased() : nil }

            candidates.append((
                semver: semver,
                info: RemoteReleaseInfo(
                    channel: .stable,
                    tagName: dto.tagName,
                    displayVersion: "v\(cleanVer)",
                    commitSHA: commit,
                    publishedAt: pubDate,
                    htmlURL: dto.htmlUrl.flatMap(URL.init(string:)),
                    zipDownloadURL: zipURL,
                    zipSizeBytes: zipAsset.size,
                    checksumDownloadURL: checksumURL
                )
            ))
        }

        return candidates.max(by: { $0.semver < $1.semver })?.info
    }

    nonisolated static func parseSHA256Sums(_ text: String, assetName: String) -> String? {
        for rawLine in text.components(separatedBy: .newlines) {
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !line.isEmpty else { continue }
            let parts = line.split(whereSeparator: { $0 == " " || $0 == "\t" })
            guard parts.count >= 2 else { continue }
            let hash = String(parts[0]).lowercased()
            let file = String(parts[1]).trimmingCharacters(in: CharacterSet(charactersIn: "*./"))
            if file == assetName && hash.count == 64 && isHexHash64(hash) {
                return hash
            }
        }
        return nil
    }

    private nonisolated static func isHexHash64(_ s: String) -> Bool {
        s.count == 64 && s.unicodeScalars.allSatisfy {
            ("0"..."9").contains($0) || ("a"..."f").contains($0)
        }
    }

    private nonisolated static func firstRegexCapture(pattern: String, in text: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let nsRange = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let match = regex.firstMatch(in: text, range: nsRange),
              match.numberOfRanges >= 2,
              let range = Range(match.range(at: 1), in: text) else {
            return nil
        }
        return String(text[range])
    }

    private nonisolated static func parseISO8601Date(_ raw: String?) -> Date? {
        guard let s = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else {
            return nil
        }
        let frac = ISO8601DateFormatter()
        frac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = frac.date(from: s) { return d }
        let basic = ISO8601DateFormatter()
        basic.formatOptions = [.withInternetDateTime]
        return basic.date(from: s)
    }

    nonisolated static func isValidRepoSlug(_ slug: String) -> Bool {
        let trimmed = slug.trimmingCharacters(in: .whitespacesAndNewlines)
        let parts = trimmed.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 2 else { return false }
        let owner = String(parts[0])
        let repo = String(parts[1])
        guard !owner.isEmpty, !repo.isEmpty,
              owner != ".", owner != "..",
              repo != ".", repo != "..",
              !repo.contains("..") else {
            return false
        }
        guard let regex = try? NSRegularExpression(pattern: #"^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$"#) else {
            return false
        }
        let range = NSRange(trimmed.startIndex..<trimmed.endIndex, in: trimmed)
        return regex.firstMatch(in: trimmed, range: range) != nil
    }

    /// 构造不依赖 `api.github.com` 元数据的 Nightly 直连发布信息（固定 `island-nightly` 标签）
    nonisolated static func directNightlyReleaseInfo(
        repoSlug: String,
        displayVersion: String = "Nightly 最新构建",
        commitSHA: String? = nil,
        publishedAt: Date? = nil
    ) -> RemoteReleaseInfo? {
        let slug = repoSlug.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isValidRepoSlug(slug),
              let zipURL = URL(string: "https://github.com/\(slug)/releases/download/island-nightly/NeoBlogIsland-universal.app.zip"),
              let sumURL = URL(string: "https://github.com/\(slug)/releases/download/island-nightly/SHA256SUMS.txt") else {
            return nil
        }
        let htmlURL = URL(string: "https://github.com/\(slug)/releases/tag/island-nightly")
        return RemoteReleaseInfo(
            channel: .nightly,
            tagName: "island-nightly",
            displayVersion: displayVersion,
            commitSHA: commitSHA,
            publishedAt: publishedAt,
            htmlURL: htmlURL,
            zipDownloadURL: zipURL,
            zipSizeBytes: 0,
            checksumDownloadURL: sumURL
        )
    }

    /// 构造不依赖 `api.github.com` 元数据的正式版直连发布信息（`island-vX.Y.Z` 标签）
    nonisolated static func directStableReleaseInfo(
        repoSlug: String,
        tagName: String,
        publishedAt: Date? = nil
    ) -> RemoteReleaseInfo? {
        let slug = repoSlug.trimmingCharacters(in: .whitespacesAndNewlines)
        let tag = tagName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isValidRepoSlug(slug), tag.hasPrefix("island-v") else { return nil }
        let cleanVer = String(tag.dropFirst("island-v".count))
        guard !cleanVer.contains("-"), SemanticVersion(cleanVer) != nil,
              let encodedTag = tag.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
              let zipURL = URL(string: "https://github.com/\(slug)/releases/download/\(encodedTag)/NeoBlogIsland-universal.app.zip"),
              let sumURL = URL(string: "https://github.com/\(slug)/releases/download/\(encodedTag)/SHA256SUMS.txt") else {
            return nil
        }
        let htmlURL = URL(string: "https://github.com/\(slug)/releases/tag/\(encodedTag)")
        return RemoteReleaseInfo(
            channel: .stable,
            tagName: tag,
            displayVersion: "v\(cleanVer)",
            commitSHA: nil,
            publishedAt: publishedAt,
            htmlURL: htmlURL,
            zipDownloadURL: zipURL,
            zipSizeBytes: 0,
            checksumDownloadURL: sumURL
        )
    }

    private final class AtomFeedSAXHandler: NSObject, XMLParserDelegate {
        struct Entry {
            var id: String = ""
            var title: String = ""
            var updated: String = ""
            var content: String = ""
            var alternateHref: String = ""
        }

        private var inEntry = false
        private var currentElement = ""
        private var currentEntry = Entry()
        private(set) var entries: [Entry] = []

        func parser(
            _ parser: XMLParser,
            didStartElement elementName: String,
            namespaceURI: String?,
            qualifiedName qName: String?,
            attributes attributeDict: [String: String] = [:]
        ) {
            let local = elementName.components(separatedBy: ":").last ?? elementName
            if local == "entry" {
                inEntry = true
                currentEntry = Entry()
                currentElement = ""
                return
            }
            guard inEntry else { return }
            currentElement = local
            if local == "link" {
                let rel = attributeDict["rel"] ?? "alternate"
                if rel == "alternate", let href = attributeDict["href"], !href.isEmpty {
                    currentEntry.alternateHref = href
                }
            }
        }

        func parser(_ parser: XMLParser, foundCharacters string: String) {
            guard inEntry else { return }
            switch currentElement {
            case "id":
                currentEntry.id += string
            case "title":
                currentEntry.title += string
            case "updated":
                currentEntry.updated += string
            case "content":
                currentEntry.content += string
            default:
                break
            }
        }

        func parser(
            _ parser: XMLParser,
            didEndElement elementName: String,
            namespaceURI: String?,
            qualifiedName qName: String?
        ) {
            let local = elementName.components(separatedBy: ":").last ?? elementName
            if local == "entry" && inEntry {
                entries.append(currentEntry)
                inEntry = false
            }
            currentElement = ""
        }
    }

    private nonisolated static func extractNightlyMetadata(
        body: String,
        title: String
    ) -> (displayVersion: String, commitSHA: String?) {
        let extractedVer = firstRegexCapture(
            pattern: #"版本标识(?:</strong>|\*\*)?[：:]\s*(?:<code>|`)([^<`]+)(?:</code>|`)"#,
            in: body
        )
        // 优先匹配真实 GitHub Atom/Web HTML 自动渲染的 <a class="commit-link" href=".../commit/<40位SHA>">
        let commitLinkSHA = firstRegexCapture(
            pattern: #"对应提交[\s\S]{0,260}?/commit/([0-9a-fA-F]{7,40})"#,
            in: body
        )
        let fullSHAInParens = firstRegexCapture(
            pattern: #"对应提交(?:</strong>|\*\*)?[：:]\s*(?:<code>[^<]*</code>|`[^`]*`)?\s*\(([0-9a-fA-F]{7,40})\)"#,
            in: body
        )
        let shortSHAInCode = firstRegexCapture(
            pattern: #"对应提交(?:</strong>|\*\*)?[：:]\s*(?:<code>|`)([0-9a-fA-F]{7,40})(?:</code>|`)"#,
            in: body
        )
        let titleSHA = firstRegexCapture(
            pattern: #"·\s*([0-9a-fA-F]{7,40})\)"#,
            in: title
        )
        let verTailSHA: String? = {
            guard let ver = extractedVer, let r = ver.lowercased().range(of: "-nightly.") else {
                return nil
            }
            let tail = String(ver[r.upperBound...]).lowercased()
            return isHexCommit(tail) ? tail : nil
        }()

        let validSHAs = [commitLinkSHA, fullSHAInParens, shortSHAInCode, verTailSHA, titleSHA]
            .compactMap { $0?.lowercased() }
            .filter { isHexCommit($0) }
        let resolvedSHA = validSHAs.first(where: { $0.count == 40 }) ?? validSHAs.first

        let displayVer: String = {
            if let v = extractedVer, !v.isEmpty { return v }
            if let sha = resolvedSHA { return "Nightly · \(sha.prefix(7))" }
            if !title.isEmpty { return title }
            return "Nightly 最新构建"
        }()

        return (displayVer, resolvedSHA)
    }

    /// 解析固定标签页 `https://github.com/<repo>/releases/tag/island-nightly` HTML（应对 `gh release edit` 后跌出 `releases.atom` 首页的场景）
    nonisolated static func parseNightlyReleaseTagHTML(
        _ html: String,
        repoSlug: String
    ) -> RemoteReleaseInfo? {
        let slug = repoSlug.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isValidRepoSlug(slug), !html.isEmpty else { return nil }
        guard html.contains("island-nightly") else { return nil }

        let pageTitle = firstRegexCapture(pattern: #"<title>([^<]+)</title>"#, in: html)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let meta = extractNightlyMetadata(body: html, title: pageTitle)
        let dateStr = firstRegexCapture(
            pattern: #"<relative-time[^>]*datetime="([^"]+)""#,
            in: html
        ) ?? firstRegexCapture(
            pattern: #"<time[^>]*datetime="([^"]+)""#,
            in: html
        )
        return directNightlyReleaseInfo(
            repoSlug: slug,
            displayVersion: meta.displayVersion,
            commitSHA: meta.commitSHA,
            publishedAt: parseISO8601Date(dateStr)
        )
    }

    /// 解析 `https://github.com/<owner>/<repo>/releases.atom`（不走 `api.github.com` 限流配额），提取最新 Nightly 与正式版
    nonisolated static func parseAtomFeedReleases(
        _ xmlData: Data,
        repoSlug: String
    ) -> (nightly: RemoteReleaseInfo?, latestStable: RemoteReleaseInfo?) {
        let slug = repoSlug.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isValidRepoSlug(slug), !xmlData.isEmpty else { return (nil, nil) }

        let handler = AtomFeedSAXHandler()
        let parser = XMLParser(data: xmlData)
        parser.shouldProcessNamespaces = false
        parser.shouldResolveExternalEntities = false
        parser.delegate = handler
        guard parser.parse() else { return (nil, nil) }

        var nightlyResult: RemoteReleaseInfo? = nil
        var stableCandidates: [(semver: SemanticVersion, info: RemoteReleaseInfo)] = []

        for entry in handler.entries {
            let tag: String? = {
                let href = entry.alternateHref.trimmingCharacters(in: .whitespacesAndNewlines)
                if let marker = href.range(of: "/releases/tag/") {
                    let rawTag = String(href[marker.upperBound...])
                        .split(whereSeparator: { $0 == "?" || $0 == "#" || $0 == "/" })
                        .first
                        .map(String.init)
                    if let decoded = rawTag?.removingPercentEncoding, !decoded.isEmpty {
                        return decoded
                    }
                }
                let entryId = entry.id.trimmingCharacters(in: .whitespacesAndNewlines)
                if let slash = entryId.lastIndex(of: "/") {
                    let tail = String(entryId[entryId.index(after: slash)...])
                    if !tail.isEmpty, tail != "releases" {
                        return tail.removingPercentEncoding ?? tail
                    }
                }
                return nil
            }()

            guard let tagName = tag else { continue }
            let pubDate = parseISO8601Date(entry.updated)
            let body = entry.content
            let title = entry.title.trimmingCharacters(in: .whitespacesAndNewlines)

            if tagName == "island-nightly" && nightlyResult == nil {
                let meta = extractNightlyMetadata(body: body, title: title)
                nightlyResult = directNightlyReleaseInfo(
                    repoSlug: slug,
                    displayVersion: meta.displayVersion,
                    commitSHA: meta.commitSHA,
                    publishedAt: pubDate
                )
            } else if tagName.hasPrefix("island-v") {
                let cleanVer = String(tagName.dropFirst("island-v".count))
                guard !cleanVer.contains("-"),
                      let semver = SemanticVersion(cleanVer),
                      let info = directStableReleaseInfo(repoSlug: slug, tagName: tagName, publishedAt: pubDate) else {
                    continue
                }
                stableCandidates.append((semver: semver, info: info))
            }
        }

        let bestStable = stableCandidates.max(by: { $0.semver < $1.semver })?.info
        return (nightlyResult, bestStable)
    }

    /// 当 `releases.atom` 首页被大量后端版本挤出时，从 `https://github.com/<repo>/releases?q=NeoBlogIsland` 网页提取最高正式版标签
    nonisolated static func extractLatestStableFromReleasesHTML(
        _ html: String,
        repoSlug: String
    ) -> RemoteReleaseInfo? {
        let slug = repoSlug.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isValidRepoSlug(slug), !html.isEmpty else { return nil }
        let escapedSlug = NSRegularExpression.escapedPattern(for: slug)
        let pattern = "/\(escapedSlug)/releases/tag/(island-v[0-9]+\\.[0-9]+(?:\\.[0-9]+)?)(?=[\"'?#\\s</>]|$)"
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }

        let nsRange = NSRange(html.startIndex..<html.endIndex, in: html)
        let matches = regex.matches(in: html, range: nsRange)
        var candidates: [(semver: SemanticVersion, tag: String)] = []
        var seen: Set<String> = []

        for m in matches where m.numberOfRanges >= 2 {
            guard let r = Range(m.range(at: 1), in: html) else { continue }
            let tag = String(html[r])
            guard seen.insert(tag).inserted else { continue }
            let cleanVer = String(tag.dropFirst("island-v".count))
            if !cleanVer.contains("-"), let semver = SemanticVersion(cleanVer) {
                candidates.append((semver: semver, tag: tag))
            }
        }

        guard let best = candidates.max(by: { $0.semver < $1.semver }) else { return nil }
        return directStableReleaseInfo(repoSlug: slug, tagName: best.tag)
    }

    private nonisolated static func fetchLatestRelease(
        repoSlug: String,
        channel: UpdateChannel,
        userAgentVersion: String
    ) async throws -> RemoteReleaseInfo {
        do {
            return try await fetchLatestReleaseViaGitHubAPI(
                repoSlug: repoSlug,
                channel: channel,
                userAgentVersion: userAgentVersion
            )
        } catch {
            if error is CancellationError || Task.isCancelled {
                throw CancellationError()
            }
            // 当 GitHub REST API 触发未认证限流（403/429）或临时异常时，自动回退至 github.com Atom/Web 解析通道
            if let fallback = try? await fetchLatestReleaseWithoutAPI(
                repoSlug: repoSlug,
                channel: channel,
                userAgentVersion: userAgentVersion
            ) {
                return fallback
            }
            throw error
        }
    }

    private nonisolated static func fetchLatestReleaseViaGitHubAPI(
        repoSlug: String,
        channel: UpdateChannel,
        userAgentVersion: String
    ) async throws -> RemoteReleaseInfo {
        let slug = repoSlug.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isValidRepoSlug(slug) else {
            throw NSError(domain: "AppUpdateService", code: -1, userInfo: [NSLocalizedDescriptionKey: "无效的仓库地址"])
        }
        switch channel {
        case .nightly:
            guard let url = URL(string: "https://api.github.com/repos/\(slug)/releases/tags/island-nightly") else {
                throw NSError(domain: "AppUpdateService", code: -1, userInfo: [NSLocalizedDescriptionKey: "无效的仓库地址"])
            }
            let data = try await fetchGitHubAPI(url: url, userAgentVersion: userAgentVersion)
            let dto = try JSONDecoder().decode(GitHubReleaseDTO.self, from: data)
            guard let info = parseNightlyRelease(dto) else {
                throw NSError(domain: "AppUpdateService", code: -2, userInfo: [NSLocalizedDescriptionKey: "未找到可用的 Nightly 安装包资产"])
            }
            return info

        case .stable:
            guard let url = URL(string: "https://api.github.com/repos/\(slug)/releases?per_page=30") else {
                throw NSError(domain: "AppUpdateService", code: -1, userInfo: [NSLocalizedDescriptionKey: "无效的仓库地址"])
            }
            let data = try await fetchGitHubAPI(url: url, userAgentVersion: userAgentVersion)
            let list = try JSONDecoder().decode([GitHubReleaseDTO].self, from: data)
            guard let info = selectLatestStableRelease(from: list) else {
                throw NSError(domain: "AppUpdateService", code: -3, userInfo: [NSLocalizedDescriptionKey: "尚未发布正式版安装包"])
            }
            return info
        }
    }

    private nonisolated static func fetchWebDocument(
        url: URL,
        accept: String,
        userAgentVersion: String,
        timeout: TimeInterval = 10
    ) async throws -> Data {
        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        req.setValue(accept, forHTTPHeaderField: "Accept")
        req.setValue("NeoBlogIsland/\(userAgentVersion)", forHTTPHeaderField: "User-Agent")
        req.setValue("no-cache", forHTTPHeaderField: "Cache-Control")

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let code = (response as? HTTPURLResponse)?.statusCode ?? -1
            throw NSError(
                domain: "AppUpdateService",
                code: code,
                userInfo: [NSLocalizedDescriptionKey: "获取 GitHub 发布列表失败（HTTP \(code)）"]
            )
        }
        return data
    }

    private nonisolated static func fetchLatestReleaseWithoutAPI(
        repoSlug: String,
        channel: UpdateChannel,
        userAgentVersion: String,
        timeout: TimeInterval = 10
    ) async throws -> RemoteReleaseInfo {
        let slug = repoSlug.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isValidRepoSlug(slug),
              let atomURL = URL(string: "https://github.com/\(slug)/releases.atom") else {
            throw NSError(domain: "AppUpdateService", code: -1, userInfo: [NSLocalizedDescriptionKey: "无效的仓库地址"])
        }

        if let atomData = try? await fetchWebDocument(
            url: atomURL,
            accept: "application/atom+xml, application/xml;q=0.9, */*;q=0.8",
            userAgentVersion: userAgentVersion,
            timeout: timeout
        ) {
            let parsed = parseAtomFeedReleases(atomData, repoSlug: slug)
            switch channel {
            case .nightly:
                if let nightly = parsed.nightly {
                    return nightly
                }
            case .stable:
                if let stable = parsed.latestStable {
                    return stable
                }
            }
        }
        try Task.checkCancellation()

        switch channel {
        case .nightly:
            // `gh release edit` 更新同一个 island-nightly 时不会刷新其在 releases.atom 中的初始发布时间排序；若已跌出首页，直接抓取固定标签页
            guard let tagURL = URL(string: "https://github.com/\(slug)/releases/tag/island-nightly") else {
                throw NSError(domain: "AppUpdateService", code: -1, userInfo: [NSLocalizedDescriptionKey: "无效的仓库地址"])
            }
            let htmlData = try await fetchWebDocument(
                url: tagURL,
                accept: "text/html,application/xhtml+xml",
                userAgentVersion: userAgentVersion,
                timeout: timeout
            )
            let html = String(data: htmlData, encoding: .utf8) ?? ""
            guard let info = parseNightlyReleaseTagHTML(html, repoSlug: slug) else {
                throw NSError(domain: "AppUpdateService", code: -2, userInfo: [NSLocalizedDescriptionKey: "未找到可用的 Nightly 发布版本"])
            }
            return info

        case .stable:
            // GitHub Releases 全文搜索按标题/正文词元索引（正式版标题固定含 NeoBlogIsland），可穿透任意数量后端 v* Release 命中 island-v*
            guard let searchURL = URL(string: "https://github.com/\(slug)/releases?q=NeoBlogIsland") else {
                throw NSError(domain: "AppUpdateService", code: -1, userInfo: [NSLocalizedDescriptionKey: "无效的仓库地址"])
            }
            let htmlData = try await fetchWebDocument(
                url: searchURL,
                accept: "text/html,application/xhtml+xml",
                userAgentVersion: userAgentVersion,
                timeout: timeout
            )
            let html = String(data: htmlData, encoding: .utf8) ?? ""
            guard let info = extractLatestStableFromReleasesHTML(html, repoSlug: slug) else {
                throw NSError(domain: "AppUpdateService", code: -3, userInfo: [NSLocalizedDescriptionKey: "尚未发布正式版安装包"])
            }
            return info
        }
    }

    /// 强制更新专用解析：全程不访问 `api.github.com`；Nightly 在元数据不可达时直接直连固定下载链接
    nonisolated static func resolveReleaseForForceUpdate(
        installed: InstalledAppVersion,
        channel: UpdateChannel
    ) async throws -> RemoteReleaseInfo {
        let slug = installed.repoSlug.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isValidRepoSlug(slug) else {
            throw NSError(domain: "AppUpdateService", code: -1, userInfo: [NSLocalizedDescriptionKey: "无效的仓库地址"])
        }

        switch channel {
        case .nightly:
            if let viaWeb = try? await fetchLatestReleaseWithoutAPI(
                repoSlug: slug,
                channel: .nightly,
                userAgentVersion: installed.version,
                timeout: 6
            ) {
                return viaWeb
            }
            try Task.checkCancellation()
            guard let direct = directNightlyReleaseInfo(repoSlug: slug) else {
                throw NSError(domain: "AppUpdateService", code: -1, userInfo: [NSLocalizedDescriptionKey: "无效的仓库地址"])
            }
            return direct

        case .stable:
            do {
                return try await fetchLatestReleaseWithoutAPI(
                    repoSlug: slug,
                    channel: .stable,
                    userAgentVersion: installed.version,
                    timeout: 10
                )
            } catch is CancellationError {
                throw CancellationError()
            } catch let nsErr as NSError {
                if Task.isCancelled {
                    throw CancellationError()
                }
                // 仅当 GitHub Web 列表页本身发生网络/HTTP 异常（非正常返回后确认无正式版的 -3）且当前为已发版正式版时，才兜底重装同版本标签
                if nsErr.code != -3,
                   nsErr.code != -1,
                   installed.channel == .stable,
                   let fallbackSame = directStableReleaseInfo(repoSlug: slug, tagName: "island-v\(installed.version)") {
                    return fallbackSame
                }
                throw nsErr
            }
        }
    }

    private nonisolated static func fetchGitHubAPI(url: URL, userAgentVersion: String) async throws -> Data {
        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        req.setValue("NeoBlogIsland/\(userAgentVersion)", forHTTPHeaderField: "User-Agent")
        req.setValue("no-cache", forHTTPHeaderField: "Cache-Control")

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw NSError(domain: "AppUpdateService", code: -1, userInfo: [NSLocalizedDescriptionKey: "网络连接异常"])
        }
        if http.statusCode == 403 || http.statusCode == 429 {
            throw NSError(domain: "AppUpdateService", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: "GitHub API 请求过于频繁，可直接点击「强制更新」绕过限流安装"])
        }
        guard (200..<300).contains(http.statusCode) else {
            throw NSError(domain: "AppUpdateService", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: "查询 GitHub 发布信息失败（HTTP \(http.statusCode)）"])
        }
        return data
    }

    private nonisolated static func fetchExpectedZipSHA256(
        from url: URL,
        zipAssetName: String,
        userAgentVersion: String
    ) async throws -> String? {
        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        req.setValue("NeoBlogIsland/\(userAgentVersion)", forHTTPHeaderField: "User-Agent")
        req.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw NSError(domain: "AppUpdateService", code: -1, userInfo: [NSLocalizedDescriptionKey: "获取更新校验摘要时网络连接异常"])
        }
        if http.statusCode == 404 {
            return nil
        }
        guard (200..<300).contains(http.statusCode) else {
            throw NSError(domain: "AppUpdateService", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: "获取更新校验文件失败（HTTP \(http.statusCode)）"])
        }
        guard let text = String(data: data, encoding: .utf8),
              let hash = parseSHA256Sums(text, assetName: zipAssetName) else {
            throw NSError(domain: "AppUpdateService", code: -14, userInfo: [NSLocalizedDescriptionKey: "更新校验文件 SHA256SUMS.txt 格式无效或缺少目标摘要"])
        }
        return hash
    }

    // MARK: - 归档校验、解压与独立进程退出后原子替换脚本

    private nonisolated static func verifyAndUnpackArchive(
        zipFileURL: URL,
        stagingDir: URL,
        expectedSHA256: String?
    ) throws -> URL {
        let zipData = try Data(contentsOf: zipFileURL, options: .mappedIfSafe)
        guard zipData.count > 32_768 else {
            throw NSError(domain: "AppUpdateService", code: -10, userInfo: [NSLocalizedDescriptionKey: "下载的更新压缩包不完整"])
        }

        if let expected = expectedSHA256 {
            let digest = SHA256.hash(data: zipData)
            let actual = digest.map { String(format: "%02x", $0) }.joined()
            guard actual.lowercased() == expected.lowercased() else {
                throw NSError(domain: "AppUpdateService", code: -11, userInfo: [NSLocalizedDescriptionKey: "更新包 SHA-256 校验不一致，已中止安装"])
            }
        }

        let unpackDir = stagingDir.appendingPathComponent("unpacked", isDirectory: true)
        try FileManager.default.createDirectory(at: unpackDir, withIntermediateDirectories: true)

        try runTool("/usr/bin/ditto", arguments: ["-x", "-k", zipFileURL.path, unpackDir.path])

        let appURL = unpackDir.appendingPathComponent("NeoBlogIsland.app", isDirectory: true)
        let resolvedUnpackPrefix = unpackDir.resolvingSymlinksInPath().path + "/"
        let resolvedAppPath = appURL.resolvingSymlinksInPath().path
        guard resolvedAppPath.hasPrefix(resolvedUnpackPrefix) else {
            throw NSError(domain: "AppUpdateService", code: -13, userInfo: [NSLocalizedDescriptionKey: "解压后的应用包路径异常，已中止安装"])
        }

        let infoPlistURL = appURL.appendingPathComponent("Contents/Info.plist")
        if let plistData = try? Data(contentsOf: infoPlistURL),
           let plist = try? PropertyListSerialization.propertyList(from: plistData, format: nil) as? [String: Any],
           let bundleId = plist["CFBundleIdentifier"] as? String {
            guard bundleId == "me.sfkm.neoblog.island" else {
                throw NSError(domain: "AppUpdateService", code: -15, userInfo: [NSLocalizedDescriptionKey: "更新包 Bundle ID 不匹配（\(bundleId)），已中止安装"])
            }
        } else {
            throw NSError(domain: "AppUpdateService", code: -15, userInfo: [NSLocalizedDescriptionKey: "更新包缺少有效的 Info.plist，已中止安装"])
        }

        let execURL = appURL.appendingPathComponent("Contents/MacOS/NeoBlogIsland")
        guard FileManager.default.isExecutableFile(atPath: execURL.path) else {
            throw NSError(domain: "AppUpdateService", code: -12, userInfo: [NSLocalizedDescriptionKey: "解压后的应用包缺少可执行文件"])
        }

        // 预先清除隔离属性并校验签名完整性，确保替换重启后不会触发 Gatekeeper 拦截弹窗
        _ = try? runTool("/usr/bin/xattr", arguments: ["-cr", appURL.path])
        try runTool("/usr/bin/codesign", arguments: ["--verify", "--deep", "--strict", appURL.path])

        return appURL
    }

    private nonisolated static func runTool(_ launchPath: String, arguments: [String]) throws {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: launchPath)
        proc.arguments = arguments
        let errPipe = Pipe()
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = errPipe
        try proc.run()
        proc.waitUntilExit()
        if proc.terminationStatus != 0 {
            let errData = errPipe.fileHandleForReading.readDataToEndOfFile()
            let errStr = String(data: errData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            throw NSError(
                domain: "AppUpdateService",
                code: Int(proc.terminationStatus),
                userInfo: [NSLocalizedDescriptionKey: errStr.isEmpty ? "执行 \(launchPath) 失败（\(proc.terminationStatus)）" : errStr]
            )
        }
    }

    nonisolated static func resolveInstallTargetURL(currentBundleURL: URL) -> URL {
        let path = currentBundleURL.path
        if currentBundleURL.pathExtension == "app",
           !path.hasPrefix("/Volumes/"),
           !path.contains("/AppTranslocation/") {
            return currentBundleURL
        }
        let systemApps = URL(fileURLWithPath: "/Applications", isDirectory: true)
        if FileManager.default.isWritableFile(atPath: systemApps.path) {
            return systemApps.appendingPathComponent("NeoBlogIsland.app", isDirectory: true)
        }
        let userApps = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications", isDirectory: true)
        try? FileManager.default.createDirectory(at: userApps, withIntermediateDirectories: true)
        return userApps.appendingPathComponent("NeoBlogIsland.app", isDirectory: true)
    }

    nonisolated static func buildUpdaterScriptSource() -> String {
        """
        #!/bin/sh
        set -eu
        trap 'rm -rf "$STAGING_DIR" 2>/dev/null || true' EXIT

        # 1. 等待当前灵动岛进程完全退出，释放二进制句柄与 LaunchServices 登记
        i=0
        while kill -0 "$OLD_PID" 2>/dev/null; do
          i=$((i + 1))
          if [ "$i" -ge 150 ]; then
            kill -9 "$OLD_PID" 2>/dev/null || true
            break
          fi
          sleep 0.1
        done
        sleep 0.25

        PARENT_DIR="$(dirname "$TARGET_APP")"
        BACKUP_APP="${TARGET_APP}.bak.$$"

        # 2. 原子备份并替换应用包（严格确保旧包已备份移走后才移入新包，防止目录嵌套污染；若普通权限遭遇 TCC 拦截则回退提权，取消授权时保留旧版重启）
        REPLACED=0
        if [ -w "$PARENT_DIR" ] && { [ ! -e "$TARGET_APP" ] || [ -w "$TARGET_APP" ]; }; then
          rm -rf "$BACKUP_APP" 2>/dev/null || true
          if [ ! -e "$TARGET_APP" ] || mv "$TARGET_APP" "$BACKUP_APP" 2>/dev/null; then
            if [ ! -e "$TARGET_APP" ] && mv "$STAGED_APP" "$TARGET_APP" 2>/dev/null; then
              REPLACED=1
              rm -rf "$BACKUP_APP" 2>/dev/null || true
              /usr/bin/xattr -cr "$TARGET_APP" 2>/dev/null || true
            elif [ -d "$BACKUP_APP" ] && [ ! -e "$TARGET_APP" ]; then
              mv "$BACKUP_APP" "$TARGET_APP" 2>/dev/null || true
            fi
          fi
        fi

        if [ "$REPLACED" -eq 0 ] && [ -d "$STAGED_APP" ]; then
          if ! /usr/bin/osascript - "$STAGED_APP" "$TARGET_APP" "$BACKUP_APP" <<'APPLESCRIPT'
          on run argv
            set stagedPath to quoted form of (item 1 of argv)
            set targetPath to quoted form of (item 2 of argv)
            set backupPath to quoted form of (item 3 of argv)
            set cmd to "rm -rf " & backupPath & " && ([ ! -e " & targetPath & " ] || mv " & targetPath & " " & backupPath & ") && if [ ! -e " & targetPath & " ] && mv " & stagedPath & " " & targetPath & "; then rm -rf " & backupPath & " && /usr/bin/xattr -cr " & targetPath & "; else if [ -d " & backupPath & " ] && [ ! -e " & targetPath & " ]; then mv " & backupPath & " " & targetPath & "; fi; exit 1; fi"
            do shell script cmd with administrator privileges
          end run
        APPLESCRIPT
          then
            if [ -d "$BACKUP_APP" ] && [ ! -e "$TARGET_APP" ]; then
              mv "$BACKUP_APP" "$TARGET_APP" 2>/dev/null || true
            fi
          fi
        fi

        # 3. 刷新 LaunchServices 包缓存并启动灵动岛（即使取消提权也恢复启动旧版，避免灵动岛消失）
        if [ -d "$TARGET_APP" ]; then
          LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
          if [ -x "$LSREGISTER" ]; then
            "$LSREGISTER" -f "$TARGET_APP" >/dev/null 2>&1 || true
          fi
          if ! /usr/bin/open -a "$TARGET_APP" 2>/dev/null; then
            sleep 0.5
            /usr/bin/open -a "$TARGET_APP" 2>/dev/null || true
          fi
        fi
        """
    }

    nonisolated static func writeDetachedUpdaterScript(in stagingDir: URL) throws -> URL {
        let scriptURL = stagingDir.appendingPathComponent("apply-update.sh")
        try buildUpdaterScriptSource().write(to: scriptURL, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: scriptURL.path)
        return scriptURL
    }

    private nonisolated static func launchDetachedUpdater(
        scriptURL: URL,
        stagingDir: URL,
        stagedAppURL: URL,
        targetAppURL: URL,
        oldPID: Int32
    ) throws {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/bin/nohup")
        proc.arguments = ["/bin/sh", scriptURL.path]
        var env = ProcessInfo.processInfo.environment
        env["OLD_PID"] = String(oldPID)
        env["STAGED_APP"] = stagedAppURL.path
        env["TARGET_APP"] = targetAppURL.path
        env["STAGING_DIR"] = stagingDir.path
        proc.environment = env
        proc.currentDirectoryURL = URL(fileURLWithPath: "/tmp", isDirectory: true)
        proc.standardInput = FileHandle.nullDevice
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice
        try proc.run()
    }
}
