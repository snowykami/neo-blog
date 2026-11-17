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
                    .foregroundStyle(store.connectedOrigins.isEmpty ? .secondary : store.accentColor)

                VStack(alignment: .leading, spacing: 2) {
                    Text("neo-blog 桌面灵动岛")
                        .font(.system(size: 13.5, weight: .bold))
                    Text("纯显示与遥控端 · 监听 127.0.0.1:\(store.boundPort)")
                        .font(.system(size: 11).monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }

            Divider()

            VStack(alignment: .leading, spacing: 6) {
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
                    Text("请在任一台 Mac 的博客「后台 › 个人设置 › 个性化」中开启「桌面灵动岛（macOS）」开关并播放音乐。")
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

                Text("提示：按住胶囊拖到屏幕最左/最右边缘松手，即可将灵动岛跨屏甩到另一台 Mac（状态栏高度松手会自动吸附进对方状态栏）。")
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
