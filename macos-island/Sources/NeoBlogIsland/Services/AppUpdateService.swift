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

    let installed: InstalledAppVersion
    var selectedChannel: UpdateChannel
    private(set) var state: State = .idle

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
        activeTask?.cancel()
        selectedChannel = channel
        checkForUpdates(silent: false)
    }

    func cancelActiveDownload() {
        activeTask?.cancel()
        activeTask = nil
        state = .idle
    }

    func checkForUpdates(silent: Bool = false) {
        switch state {
        case .downloading, .verifying, .restarting:
            return
        default:
            break
        }

        activeTask?.cancel()
        if !silent {
            state = .checking
        }
        let channel = selectedChannel
        let currentInstalled = installed

        activeTask = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let remote = try await Self.fetchLatestRelease(
                    repoSlug: currentInstalled.repoSlug,
                    channel: channel,
                    userAgentVersion: currentInstalled.version
                )
                guard !Task.isCancelled else { return }

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
                guard !Task.isCancelled else { return }
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

    func downloadAndInstall(_ release: RemoteReleaseInfo) {
        guard installed.bundleURL.pathExtension == "app" else {
            state = .failed(
                message: "当前以命令行调试方式运行（非 .app 应用包），请构建应用包后再执行自动替换更新。",
                fallbackURL: release.htmlURL
            )
            return
        }

        activeTask?.cancel()
        state = .downloading(
            release: release,
            progress: 0,
            downloadedBytes: 0,
            totalBytes: release.zipSizeBytes
        )

        let currentInstalled = installed
        activeTask = Task { @MainActor [weak self] in
            guard let self else { return }
            let stagingDir = FileManager.default.temporaryDirectory
                .appendingPathComponent("NeoBlogIslandUpdate-\(UUID().uuidString)", isDirectory: true)
            do {
                try FileManager.default.createDirectory(at: stagingDir, withIntermediateDirectories: true)

                var expectedSHA256: String? = nil
                if let sumURL = release.checksumDownloadURL {
                    expectedSHA256 = try? await Self.fetchExpectedZipSHA256(
                        from: sumURL,
                        zipAssetName: release.zipDownloadURL.lastPathComponent,
                        userAgentVersion: currentInstalled.version
                    )
                }

                let zipFileURL = stagingDir.appendingPathComponent("NeoBlogIsland-update.app.zip")
                try await self.downloadFileWithProgress(
                    from: release.zipDownloadURL,
                    to: zipFileURL,
                    release: release,
                    userAgentVersion: currentInstalled.version
                )
                try Task.checkCancellation()

                self.state = .verifying(release: release)
                let stagedAppURL = try await Task.detached(priority: .userInitiated) {
                    try Self.verifyAndUnpackArchive(
                        zipFileURL: zipFileURL,
                        stagingDir: stagingDir,
                        expectedSHA256: expectedSHA256
                    )
                }.value
                try Task.checkCancellation()

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
                guard !Task.isCancelled else { return }
                self.logger.error("下载或安装更新失败: \(error.localizedDescription, privacy: .public)")
                self.state = .failed(
                    message: error.localizedDescription,
                    fallbackURL: release.htmlURL ?? URL(string: "https://github.com/\(currentInstalled.repoSlug)/releases")
                )
            }
        }
    }

    // MARK: - 网络请求与下载进度流

    private func downloadFileWithProgress(
        from url: URL,
        to destination: URL,
        release: RemoteReleaseInfo,
        userAgentVersion: String
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
            try handle.write(contentsOf: buffer)
            downloaded += Int64(buffer.count)
        }

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
        let publishedDate = dateStr.flatMap { ISO8601DateFormatter().date(from: $0) }

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
        let iso = ISO8601DateFormatter()

        for dto in releases where !dto.draft && !dto.prerelease && dto.tagName.hasPrefix("island-v") {
            guard let zipAsset = dto.assets.first(where: { $0.name == "NeoBlogIsland-universal.app.zip" })
                    ?? dto.assets.first(where: { $0.name.hasSuffix(".app.zip") }),
                  let zipURL = URL(string: zipAsset.browserDownloadUrl) else {
                continue
            }
            let cleanVer = String(dto.tagName.dropFirst("island-v".count))
            guard let semver = SemanticVersion(cleanVer) else { continue }

            let checksumURL = dto.assets
                .first(where: { $0.name == "SHA256SUMS.txt" })
                .flatMap { URL(string: $0.browserDownloadUrl) }
            let pubDate = (zipAsset.updatedAt ?? dto.publishedAt).flatMap { iso.date(from: $0) }
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

    private nonisolated static func fetchLatestRelease(
        repoSlug: String,
        channel: UpdateChannel,
        userAgentVersion: String
    ) async throws -> RemoteReleaseInfo {
        switch channel {
        case .nightly:
            guard let url = URL(string: "https://api.github.com/repos/\(repoSlug)/releases/tags/island-nightly") else {
                throw NSError(domain: "AppUpdateService", code: -1, userInfo: [NSLocalizedDescriptionKey: "无效的仓库地址"])
            }
            let data = try await fetchGitHubAPI(url: url, userAgentVersion: userAgentVersion)
            let dto = try JSONDecoder().decode(GitHubReleaseDTO.self, from: data)
            guard let info = parseNightlyRelease(dto) else {
                throw NSError(domain: "AppUpdateService", code: -2, userInfo: [NSLocalizedDescriptionKey: "未找到可用的 Nightly 安装包资产"])
            }
            return info

        case .stable:
            guard let url = URL(string: "https://api.github.com/repos/\(repoSlug)/releases?per_page=20") else {
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
            throw NSError(domain: "AppUpdateService", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: "GitHub API 请求过于频繁，请稍后再试"])
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
        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 12)
        req.setValue("NeoBlogIsland/\(userAgentVersion)", forHTTPHeaderField: "User-Agent")
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let text = String(data: data, encoding: .utf8) else {
            return nil
        }
        return parseSHA256Sums(text, assetName: zipAssetName)
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

        # 2. 原子备份并替换应用包（普通可写目录直接 mv；受保护目录自动唤起系统管理员授权框）
        if [ -w "$PARENT_DIR" ] && { [ ! -e "$TARGET_APP" ] || [ -w "$TARGET_APP" ]; }; then
          rm -rf "$BACKUP_APP" 2>/dev/null || true
          if [ -d "$TARGET_APP" ]; then
            mv "$TARGET_APP" "$BACKUP_APP"
          fi
          if mv "$STAGED_APP" "$TARGET_APP"; then
            rm -rf "$BACKUP_APP" 2>/dev/null || true
          else
            if [ -d "$BACKUP_APP" ]; then
              mv "$BACKUP_APP" "$TARGET_APP" 2>/dev/null || true
            fi
            exit 1
          fi
          /usr/bin/xattr -cr "$TARGET_APP" 2>/dev/null || true
        else
          /usr/bin/osascript - "$STAGED_APP" "$TARGET_APP" "$BACKUP_APP" <<'APPLESCRIPT'
          on run argv
            set stagedPath to quoted form of (item 1 of argv)
            set targetPath to quoted form of (item 2 of argv)
            set backupPath to quoted form of (item 3 of argv)
            set cmd to "rm -rf " & backupPath & " && (if [ -d " & targetPath & " ]; then mv " & targetPath & " " & backupPath & "; fi) && if mv " & stagedPath & " " & targetPath & "; then rm -rf " & backupPath & " && /usr/bin/xattr -cr " & targetPath & "; else if [ -d " & backupPath & " ]; then mv " & backupPath & " " & targetPath & "; fi; exit 1; fi"
            do shell script cmd with administrator privileges
          end run
        APPLESCRIPT
        fi

        # 3. 刷新 LaunchServices 包缓存并启动新版灵动岛（若旧实例刚释放句柄则延迟重试一次）
        LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
        if [ -x "$LSREGISTER" ]; then
          "$LSREGISTER" -f "$TARGET_APP" >/dev/null 2>&1 || true
        fi
        if ! /usr/bin/open -a "$TARGET_APP" 2>/dev/null; then
          sleep 0.5
          /usr/bin/open -a "$TARGET_APP" 2>/dev/null || true
        fi

        # 4. 清理临时更新目录
        rm -rf "$STAGING_DIR" 2>/dev/null || true
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
