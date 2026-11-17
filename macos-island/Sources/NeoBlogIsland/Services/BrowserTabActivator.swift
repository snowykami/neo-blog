import AppKit
import Foundation
import os

/// 负责在点击灵动岛「打开完整播放器页」时：
/// 1. 通过 Apple Events 在已运行的浏览器多窗口/多标签页中精准定位正在播放音乐的 Tab（优先匹配一次性 focusToken，兜底匹配博客 Origin），将其切换为当前活跃 Tab 并还原最小化窗口；
/// 2. 将对应浏览器应用（NSRunningApplication）拉回主界面最前台；
/// 3. 若用户使用 Firefox/Zen 等不支持 Tab 级 AppleScript 的浏览器或未授予自动化权限，自动优雅降级为直接激活对应浏览器窗口。
enum BrowserTabActivator {
    private static let logger = Logger(subsystem: "org.liteyuki.NeoBlogIsland", category: "BrowserActivator")

    enum ScriptingDialect: Sendable {
        case chromium
        case arc
        case safari
        case appActivateOnly
    }

    struct BrowserDescriptor: Sendable {
        let bundleId: String
        let dialect: ScriptingDialect
        let uaKeywords: [String]
    }

    static let knownBrowsers: [BrowserDescriptor] = [
        // Arc（UA 与标准 Chrome 相同，放在通用 Chrome 之前以便双开时均能按 focusToken 精确命中）
        BrowserDescriptor(bundleId: "company.thebrowser.Browser", dialect: .arc, uaKeywords: ["arc"]),
        // Edge / Brave / Vivaldi / Opera（各自携带明确 UA 标识）
        BrowserDescriptor(bundleId: "com.microsoft.edgemac", dialect: .chromium, uaKeywords: ["edg/"]),
        BrowserDescriptor(bundleId: "com.microsoft.edgemac.Beta", dialect: .chromium, uaKeywords: ["edg/"]),
        BrowserDescriptor(bundleId: "com.microsoft.edgemac.Dev", dialect: .chromium, uaKeywords: ["edg/"]),
        BrowserDescriptor(bundleId: "com.brave.Browser", dialect: .chromium, uaKeywords: ["brave"]),
        BrowserDescriptor(bundleId: "com.brave.Browser.beta", dialect: .chromium, uaKeywords: ["brave"]),
        BrowserDescriptor(bundleId: "com.vivaldi.Vivaldi", dialect: .chromium, uaKeywords: ["vivaldi"]),
        BrowserDescriptor(bundleId: "com.operasoftware.Opera", dialect: .chromium, uaKeywords: ["opr/", "opera"]),
        // Google Chrome / Chromium
        BrowserDescriptor(bundleId: "com.google.Chrome", dialect: .chromium, uaKeywords: ["chrome/", "crios/"]),
        BrowserDescriptor(bundleId: "com.google.Chrome.canary", dialect: .chromium, uaKeywords: ["chrome/"]),
        BrowserDescriptor(bundleId: "com.google.Chrome.beta", dialect: .chromium, uaKeywords: ["chrome/"]),
        BrowserDescriptor(bundleId: "com.google.Chrome.dev", dialect: .chromium, uaKeywords: ["chrome/"]),
        BrowserDescriptor(bundleId: "org.chromium.Chromium", dialect: .chromium, uaKeywords: ["chromium"]),
        // Safari
        BrowserDescriptor(bundleId: "com.apple.Safari", dialect: .safari, uaKeywords: ["version/", "safari/"]),
        BrowserDescriptor(bundleId: "com.apple.SafariTechnologyPreview", dialect: .safari, uaKeywords: ["safari/"]),
        // Firefox / Zen / 其他非 AppleScript 标签页字典浏览器（支持进程级唤醒置顶）
        BrowserDescriptor(bundleId: "app.zen-browser.zen", dialect: .appActivateOnly, uaKeywords: ["zen/", "firefox/"]),
        BrowserDescriptor(bundleId: "org.mozilla.firefox", dialect: .appActivateOnly, uaKeywords: ["firefox/"]),
        BrowserDescriptor(bundleId: "org.mozilla.firefoxdeveloperedition", dialect: .appActivateOnly, uaKeywords: ["firefox/"]),
        BrowserDescriptor(bundleId: "org.mozilla.nightly", dialect: .appActivateOnly, uaKeywords: ["firefox/"]),
        BrowserDescriptor(bundleId: "company.thebrowser.dia", dialect: .appActivateOnly, uaKeywords: ["dia", "chrome/"]),
        BrowserDescriptor(bundleId: "com.kagi.kagimacOS", dialect: .appActivateOnly, uaKeywords: ["orion", "safari/"]),
    ]

    /// 根据客户端 User-Agent 对当前正在运行的浏览器按匹配优先级排序（绝不启动未运行的浏览器）
    @MainActor
    static func orderedRunningCandidates(userAgent: String) -> [(app: NSRunningApplication, descriptor: BrowserDescriptor)] {
        let runningByBundle: [String: NSRunningApplication] = Dictionary(
            NSWorkspace.shared.runningApplications.compactMap { app in
                guard !app.isTerminated, let bid = app.bundleIdentifier else { return nil }
                return (bid, app)
            },
            uniquingKeysWith: { first, _ in first }
        )

        let ua = userAgent.lowercased()
        let isSafariOnly = ua.contains("safari/") && !ua.contains("chrome/") && !ua.contains("chromium/") && !ua.contains("firefox/")
        let isFirefoxFamily = ua.contains("firefox/")

        var preferred: [(NSRunningApplication, BrowserDescriptor)] = []
        var secondary: [(NSRunningApplication, BrowserDescriptor)] = []

        for desc in knownBrowsers {
            guard let app = runningByBundle[desc.bundleId] else { continue }
            let matched: Bool = {
                if desc.dialect == .safari {
                    return isSafariOnly
                }
                if isFirefoxFamily {
                    return desc.uaKeywords.contains { ua.contains($0) }
                }
                if desc.bundleId == "company.thebrowser.Browser" && ua.contains("chrome/") {
                    // Arc 的 User-Agent 与标准 Chrome 完全一致：若本机正在运行 Arc，将其同列为第一梯队通过 focusToken 精准区分
                    return true
                }
                return desc.uaKeywords.contains { ua.contains($0) }
            }()
            if matched {
                preferred.append((app, desc))
            } else {
                secondary.append((app, desc))
            }
        }
        return preferred + secondary
    }

    @MainActor
    static func activatePlayingTab(origin: String, focusToken: String, userAgent: String) {
        let candidates = orderedRunningCandidates(userAgent: userAgent)
        guard !candidates.isEmpty else {
            if let fallbackURL = URL(string: "\(origin)/music") {
                NSWorkspace.shared.open(fallbackURL)
            }
            return
        }

        let scriptPlan: [(bundleId: String, dialect: ScriptingDialect)] = candidates.compactMap { item in
            guard item.descriptor.dialect != .appActivateOnly else { return nil }
            return (item.descriptor.bundleId, item.descriptor.dialect)
        }
        let primaryFallbackBundleId = candidates.first?.app.bundleIdentifier

        Task.detached(priority: .userInitiated) {
            // 第一轮：在所有运行中的可脚本化浏览器里精确查找带有一次性 focusToken 的那个播放 Tab（多浏览器/多同站 Tab 100% 唯一命中）
            if !focusToken.isEmpty {
                for target in scriptPlan {
                    let src = buildAppleScript(
                        bundleId: target.bundleId,
                        dialect: target.dialect,
                        focusToken: focusToken,
                        origin: nil
                    )
                    if executeAppleScript(src) == "FOUND" {
                        await activateRunningAppOnMain(bundleId: target.bundleId)
                        return
                    }
                }
            }

            // 第二轮兜底：按博客 Origin 匹配（优先 /music 路径，再回退同源任意路径），应对后台标签页被系统深度冻结未来得及写入 title 的极端情况
            let cleanOrigin = origin.trimmingCharacters(in: .whitespacesAndNewlines)
            if cleanOrigin.hasPrefix("http://") || cleanOrigin.hasPrefix("https://") {
                for target in scriptPlan {
                    let src = buildAppleScript(
                        bundleId: target.bundleId,
                        dialect: target.dialect,
                        focusToken: nil,
                        origin: cleanOrigin
                    )
                    if executeAppleScript(src) == "FOUND" {
                        await activateRunningAppOnMain(bundleId: target.bundleId)
                        return
                    }
                }
            }

            // 第三轮优雅降级（如 Firefox / Zen 或用户拒绝了 Apple Events 权限）：免权限直接把对应浏览器应用置顶到主界面
            if let bid = primaryFallbackBundleId {
                await activateRunningAppOnMain(bundleId: bid)
            }
        }
    }

    @MainActor
    private static func activateRunningAppOnMain(bundleId: String) {
        guard let app = NSWorkspace.shared.runningApplications.first(where: { $0.bundleIdentifier == bundleId && !$0.isTerminated }) else {
            return
        }
        if app.isHidden {
            app.unhide()
        }
        NSApplication.shared.deactivate()
        app.activate(options: [.activateAllWindows])
    }

    static func escapeAppleScriptLiteral(_ raw: String) -> String {
        raw
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
    }

    static func buildAppleScript(
        bundleId: String,
        dialect: ScriptingDialect,
        focusToken: String?,
        origin: String?
    ) -> String {
        let bid = escapeAppleScriptLiteral(bundleId)
        let tok = focusToken.map(escapeAppleScriptLiteral)
        let orig = origin.map(escapeAppleScriptLiteral)

        switch dialect {
        case .chromium:
            if let tok, !tok.isEmpty {
                return """
                tell application id "\(bid)"
                    set winCount to count of windows
                    repeat with wIdx from 1 to winCount
                        set w to window wIdx
                        set tabCount to count of tabs of w
                        repeat with tIdx from 1 to tabCount
                            set t to tab tIdx of w
                            if (title of t contains "\(tok)") then
                                if minimized of w is true then set minimized of w to false
                                set active tab index of w to tIdx
                                set index of w to 1
                                activate
                                return "FOUND"
                            end if
                        end repeat
                    end repeat
                end tell
                return "MISS"
                """
            } else if let orig {
                return """
                tell application id "\(bid)"
                    set fallbackWin to 0
                    set fallbackTab to 0
                    set winCount to count of windows
                    repeat with wIdx from 1 to winCount
                        set w to window wIdx
                        set tabCount to count of tabs of w
                        repeat with tIdx from 1 to tabCount
                            set t to tab tIdx of w
                            set u to URL of t
                            if (u starts with "\(orig)") and (u contains "/music") then
                                if minimized of w is true then set minimized of w to false
                                set active tab index of w to tIdx
                                set index of w to 1
                                activate
                                return "FOUND"
                            else if (fallbackWin is 0) and (u starts with "\(orig)") then
                                set fallbackWin to wIdx
                                set fallbackTab to tIdx
                            end if
                        end repeat
                    end repeat
                    if fallbackWin > 0 then
                        set fw to window fallbackWin
                        if minimized of fw is true then set minimized of fw to false
                        set active tab index of fw to fallbackTab
                        set index of fw to 1
                        activate
                        return "FOUND"
                    end if
                end tell
                return "MISS"
                """
            }

        case .arc:
            if let tok, !tok.isEmpty {
                return """
                tell application id "\(bid)"
                    repeat with w in windows
                        repeat with t in tabs of w
                            if (title of t contains "\(tok)") then
                                tell t to select
                                activate
                                return "FOUND"
                            end if
                        end repeat
                    end repeat
                end tell
                return "MISS"
                """
            } else if let orig {
                return """
                tell application id "\(bid)"
                    repeat with w in windows
                        repeat with t in tabs of w
                            if (URL of t starts with "\(orig)") then
                                tell t to select
                                activate
                                return "FOUND"
                            end if
                        end repeat
                    end repeat
                end tell
                return "MISS"
                """
            }

        case .safari:
            if let tok, !tok.isEmpty {
                return """
                tell application id "\(bid)"
                    set winCount to count of windows
                    repeat with wIdx from 1 to winCount
                        set w to window wIdx
                        repeat with t in tabs of w
                            if (name of t contains "\(tok)") then
                                if miniaturized of w is true then set miniaturized of w to false
                                set current tab of w to t
                                set index of w to 1
                                activate
                                return "FOUND"
                            end if
                        end repeat
                    end repeat
                end tell
                return "MISS"
                """
            } else if let orig {
                return """
                tell application id "\(bid)"
                    set winCount to count of windows
                    repeat with wIdx from 1 to winCount
                        set w to window wIdx
                        repeat with t in tabs of w
                            set u to URL of t
                            if (u starts with "\(orig)") and (u contains "/music") then
                                if miniaturized of w is true then set miniaturized of w to false
                                set current tab of w to t
                                set index of w to 1
                                activate
                                return "FOUND"
                            end if
                        end repeat
                    end repeat
                    repeat with wIdx from 1 to winCount
                        set w to window wIdx
                        repeat with t in tabs of w
                            if (URL of t starts with "\(orig)") then
                                if miniaturized of w is true then set miniaturized of w to false
                                set current tab of w to t
                                set index of w to 1
                                activate
                                return "FOUND"
                            end if
                        end repeat
                    end repeat
                end tell
                return "MISS"
                """
            }

        case .appActivateOnly:
            break
        }
        return "return \"MISS\""
    }

    private static func executeAppleScript(_ source: String) -> String? {
        guard let script = NSAppleScript(source: source) else { return nil }
        var errorDict: NSDictionary?
        let descriptor = script.executeAndReturnError(&errorDict)
        if let errorDict {
            logger.debug("AppleScript 执行返回非致命提示: \(String(describing: errorDict), privacy: .public)")
            return nil
        }
        return descriptor.stringValue
    }
}
