import AppKit
import SwiftUI

/// 菜单栏轻量状态小窗：灵动岛的所有外观与行为开关均统一在博客「个人设置 › 个性化」中配置
struct SettingsPopoverView: View {
    let store: IslandStore
    let hasPhysicalNotch: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: "waveform.circle.fill")
                    .font(.system(size: 22))
                    .foregroundStyle(
                        (!store.connectedOrigins.isEmpty || store.isAutonomousMode)
                            ? store.accentColor
                            : .secondary
                    )

                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text("neo-blog 桌面灵动岛")
                            .font(.system(size: 13.5, weight: .bold))

                        Text(store.updater.installed.displayBadge)
                            .font(.system(size: 10, weight: .medium).monospacedDigit())
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 5.5)
                            .padding(.vertical, 1.5)
                            .background(Color.primary.opacity(0.07), in: Capsule())
                    }
                    Text(
                        store.isAutonomousMode
                            ? "内置音频续播中 · 监听 127.0.0.1:\(store.boundPort)"
                            : "显示遥控与断联续播 · 监听 127.0.0.1:\(store.boundPort)"
                    )
                    .font(.system(size: 11).monospacedDigit())
                    .foregroundStyle(.secondary)
                }
                Spacer()
            }

            Divider()

            VStack(alignment: .leading, spacing: 6) {
                if store.isAutonomousMode {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(Color.mint)
                            .frame(width: 7, height: 7)
                        Text("灵动岛内置独立续播中（发声：\(store.autonomousAudioOwnerLabel)）")
                            .font(.system(size: 12, weight: .semibold))
                            .lineLimit(1)
                    }

                    Text(store.autonomousOrigin)
                        .font(.system(size: 11.5).monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)

                    HStack(spacing: 8) {
                        Button("交回浏览器播放") {
                            store.openBlogPlayerPage()
                        }
                        .controlSize(.small)

                        Button("停止续播") {
                            store.stopAutonomousPlayback()
                        }
                        .controlSize(.small)
                    }
                } else {
                    HStack {
                        Circle()
                            .fill(
                                !store.connectedOrigins.isEmpty ? Color.green
                                : (store.isDisplayingRemotePeerSession ? Color.cyan : Color.orange)
                            )
                            .frame(width: 7, height: 7)
                        Text(
                            !store.connectedOrigins.isEmpty ? "已连接本机博客页面"
                            : (store.isDisplayingRemotePeerSession ? "正在镜像跨屏 Mac 音乐流" : "等待博客页面连接…")
                        )
                        .font(.system(size: 12, weight: .semibold))
                    }

                    if store.connectedOrigins.isEmpty && !store.isDisplayingRemotePeerSession {
                        Text("在任一台 Mac 打开博客页面并播放音乐即可自动连接；浏览器关闭后会自动无缝切换至灵动岛内置续播。")
                            .font(.system(size: 11.5))
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        ForEach(store.connectedOrigins, id: \.self) { origin in
                            HStack(spacing: 6) {
                                Text(origin)
                                    .font(.system(size: 11.5).monospaced())
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                                Spacer()
                                Button("打开个性化设置") {
                                    if let url = URL(string: "\(origin)/console/user-preference") {
                                        NSWorkspace.shared.open(url)
                                    }
                                }
                                .controlSize(.mini)
                            }
                        }
                    }
                }
            }

            Divider()

            PeerContinuityPopoverSection(store: store)

            if store.hiddenTrackId != nil {
                Button("恢复显示当前隐藏的曲目") {
                    store.hiddenTrackId = nil
                }
                .controlSize(.small)
            }

            if store.hasCustomCapsulePosition {
                HStack(spacing: 8) {
                    Button("重置胶囊默认位置") {
                        store.resetCapsulePosition()
                    }
                    .controlSize(.small)

                    Button(store.isPositionLocked ? "解锁位置" : "锁定位置") {
                        store.togglePositionLock()
                    }
                    .controlSize(.small)
                }
            }

            Divider()

            AppUpdatePopoverSection(updater: store.updater)

            Divider()

            HStack {
                Text(hasPhysicalNotch ? "屏幕：内建刘海屏" : "屏幕：无刘海显示器")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                Spacer()
                Button("退出") {
                    NSApplication.shared.terminate(nil)
                }
                .controlSize(.small)
            }
        }
        .padding(14)
        .frame(width: 326)
        .fixedSize(horizontal: false, vertical: true)
    }
}

private struct AppUpdatePopoverSection: View {
    @Bindable var updater: AppUpdateService

    private var isBusyInstalling: Bool {
        if updater.isForceUpdating { return true }
        switch updater.state {
        case .downloading, .verifying, .restarting:
            return true
        default:
            return false
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 6) {
                Image(systemName: "arrow.triangle.2.circlepath")
                    .font(.system(size: 11.5, weight: .semibold))
                    .foregroundStyle(updater.hasAvailableUpdate ? Color.accentColor : .secondary)
                Text("版本更新")
                    .font(.system(size: 12, weight: .semibold))
                Spacer()
                Picker("更新通道", selection: $updater.channelSelection) {
                    ForEach(UpdateChannel.allCases, id: \.self) { ch in
                        Text(ch.label).tag(ch)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .controlSize(.mini)
                .frame(width: 118)
                .disabled(isBusyInstalling)
            }

            switch updater.state {
            case .idle:
                HStack(spacing: 6) {
                    Text("当前：\(updater.installed.displayBadge)")
                        .font(.system(size: 11).monospacedDigit())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Spacer(minLength: 4)
                    Button("检查更新") {
                        updater.checkForUpdates(silent: false)
                    }
                    .controlSize(.small)
                    .fixedSize()

                    Button("强制更新") {
                        updater.forceUpdate()
                    }
                    .controlSize(.small)
                    .fixedSize()
                    .help("绕过 GitHub API 限流与本地版本号对比，直连下载并覆盖安装当前通道最新构建")
                }

            case .checking:
                HStack(spacing: 6) {
                    ProgressView()
                        .controlSize(.mini)
                    Text(
                        updater.isForceUpdating
                            ? "正在直连 GitHub 获取 \(updater.selectedChannel.label)安装包…"
                            : "正在检查 GitHub \(updater.selectedChannel.label)最新构建…"
                    )
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    Spacer(minLength: 4)
                    if updater.isForceUpdating {
                        Button("取消") {
                            updater.cancelActiveDownload()
                        }
                        .controlSize(.mini)
                        .fixedSize()
                    }
                }

            case .upToDate(let versionLabel):
                HStack(spacing: 6) {
                    Circle()
                        .fill(Color.green)
                        .frame(width: 6, height: 6)
                    Text("已是最新（\(versionLabel)）")
                        .font(.system(size: 11).monospacedDigit())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Spacer(minLength: 4)
                    Button("重新检查") {
                        updater.checkForUpdates(silent: false)
                    }
                    .controlSize(.mini)
                    .fixedSize()

                    Button("强制更新") {
                        updater.forceUpdate()
                    }
                    .controlSize(.mini)
                    .fixedSize()
                    .help("忽略版本号相同限制，直连下载并重新安装当前通道最新构建")
                }

            case .available(let release, let isChannelSwitch):
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(Color.accentColor)
                            .frame(width: 6, height: 6)
                        Text(isChannelSwitch ? "可切换至 \(release.displayVersion)" : "发现新版本：\(release.displayVersion)")
                            .font(.system(size: 11.5, weight: .medium).monospacedDigit())
                            .lineLimit(1)
                        Spacer()
                        if release.zipSizeBytes > 0 {
                            Text(Self.formatByteCount(release.zipSizeBytes))
                                .font(.system(size: 10.5).monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                    }

                    HStack(spacing: 8) {
                        Button("下载并重启安装") {
                            updater.downloadAndInstall(release)
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)

                        if let htmlURL = release.htmlURL {
                            Button("发布说明") {
                                NSWorkspace.shared.open(htmlURL)
                            }
                            .controlSize(.small)
                        }
                    }
                }

            case .downloading(_, let progress, let downloaded, let total):
                VStack(alignment: .leading, spacing: 5) {
                    if total > 0 {
                        ProgressView(value: max(0, min(1, progress)))
                            .controlSize(.small)
                    } else {
                        ProgressView()
                            .progressViewStyle(.linear)
                            .controlSize(.small)
                    }
                    HStack(spacing: 6) {
                        let statusText: String = {
                            if total > 0 {
                                let pct = Int(round(max(0, min(1, progress)) * 100))
                                return "正在下载更新包 \(pct)%（\(Self.formatByteCount(downloaded)) / \(Self.formatByteCount(total))）…"
                            }
                            if downloaded > 0 {
                                return "正在下载更新包（已下载 \(Self.formatByteCount(downloaded))）…"
                            }
                            return "正在准备下载更新包…"
                        }()
                        Text(statusText)
                            .font(.system(size: 10.5).monospacedDigit())
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                        Spacer()
                        Button("取消") {
                            updater.cancelActiveDownload()
                        }
                        .controlSize(.mini)
                    }
                }

            case .verifying:
                HStack(spacing: 6) {
                    ProgressView()
                        .controlSize(.mini)
                    Text("正在校验 SHA-256 摘要并解压应用包…")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                    Spacer()
                }

            case .restarting:
                HStack(spacing: 6) {
                    ProgressView()
                        .controlSize(.mini)
                    Text("校验通过，正在退出并自动替换重启…")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Color.accentColor)
                    Spacer()
                }

            case .failed(let message, let fallbackURL):
                VStack(alignment: .leading, spacing: 6) {
                    Text(message)
                        .font(.system(size: 11))
                        .foregroundStyle(.orange)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 8) {
                        Button("强制更新") {
                            updater.forceUpdate()
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.mini)
                        .help("绕过 GitHub API 限流，直接从 GitHub Releases 下载并安装最新构建")

                        Button("重试") {
                            updater.checkForUpdates(silent: false)
                        }
                        .controlSize(.mini)

                        if let url = fallbackURL {
                            Button("打开 GitHub 发布页") {
                                NSWorkspace.shared.open(url)
                            }
                            .controlSize(.mini)
                        }
                    }
                }
            }
        }
    }

    private static func formatByteCount(_ bytes: Int64) -> String {
        if bytes <= 0 {
            return "0 KB"
        }
        let mb = Double(bytes) / (1024.0 * 1024.0)
        if mb >= 1.0 {
            return String(format: "%.1f MB", mb)
        }
        let kb = max(1, Int(round(Double(bytes) / 1024.0)))
        return "\(kb) KB"
    }
}

private struct PeerContinuityPopoverSection: View {
    let store: IslandStore

    var body: some View {
        let peer = store.peerService
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 6) {
                Image(systemName: "dot.radiowaves.left.and.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(peer.isConnected ? .cyan : .secondary)
                Text("跨 Mac 无线直连（AWDL）")
                    .font(.system(size: 12, weight: .semibold))
                Spacer()
                Text("本机：\(peer.localDeviceName)")
                    .font(.system(size: 10.5))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            if let req = peer.pendingPairRequest {
                HStack(spacing: 6) {
                    Text("\(req.deviceName) 请求配对")
                        .font(.system(size: 11.5, weight: .medium))
                        .lineLimit(1)
                    Spacer()
                    Button("允许") {
                        peer.respondToPairRequest(accept: true)
                    }
                    .controlSize(.mini)
                    Button("拒绝") {
                        peer.respondToPairRequest(accept: false)
                    }
                    .controlSize(.mini)
                }
            } else if peer.isConnected, let peerName = peer.connectedPeerName {
                HStack(spacing: 6) {
                    Circle()
                        .fill(Color.cyan)
                        .frame(width: 6, height: 6)
                    Text("已互联：\(peerName)")
                        .font(.system(size: 11.5, weight: .medium))
                        .lineLimit(1)
                    Spacer()
                    Button("断开") {
                        peer.disconnectCurrentPeer()
                    }
                    .controlSize(.mini)
                }

                if store.track != nil {
                    HStack(spacing: 6) {
                        if store.isIslandHandedOffToPeer {
                            Button("召回本机显示") {
                                store.recallIslandToThisMac()
                            }
                            .controlSize(.small)
                        } else {
                            Button("投送到 \(peerName)") {
                                store.handoffToConnectedPeer()
                            }
                            .controlSize(.small)
                        }

                        Button(store.displayOwnership == .mirrorBothMacs ? "退出双机同显" : "双机同时显示") {
                            store.toggleMirrorBothMacs()
                        }
                        .controlSize(.small)
                    }
                }

                Text("提示：按住胶囊或展开小窗拖到屏幕最左/最右边缘松手，即可跨屏甩到另一台 Mac（收起态在状态栏高度松手会自动吸附进对方状态栏）。")
                    .font(.system(size: 10.5))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                if peer.isAwaitingRemoteApproval {
                    Text("正在等待对方 Mac 点击「允许」确认配对…")
                        .font(.system(size: 11))
                        .foregroundStyle(.orange)
                } else if peer.discoveredPeers.isEmpty {
                    Text("正在通过蓝牙 + AWDL 搜索附近运行灵动岛的 Mac…（无需处于同一路由器局域网，保持 Wi-Fi 与蓝牙开启即可）")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    ForEach(peer.discoveredPeers) { item in
                        HStack(spacing: 6) {
                            Text(item.displayName)
                                .font(.system(size: 11.5))
                                .lineLimit(1)
                            if item.isTrusted {
                                Text("已信任")
                                    .font(.system(size: 10))
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button(item.isTrusted ? "重连" : "配对连接") {
                                peer.connectToDiscoveredPeer(item)
                            }
                            .controlSize(.mini)
                        }
                    }
                }

                if !peer.trustedTokens.isEmpty {
                    Button("清除已信任的配对设备") {
                        peer.unpairAllPeers()
                    }
                    .controlSize(.mini)
                }
            }
        }
    }
}
