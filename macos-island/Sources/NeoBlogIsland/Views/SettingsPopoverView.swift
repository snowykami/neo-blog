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
                        .fill(store.connectedOrigins.isEmpty ? Color.orange : Color.green)
                        .frame(width: 7, height: 7)
                    Text(store.connectedOrigins.isEmpty ? "等待博客页面连接…" : "已连接博客页面")
                        .font(.system(size: 12, weight: .semibold))
                }

                if store.connectedOrigins.isEmpty {
                    Text("请在博客「后台 › 个人设置 › 个性化」中开启「桌面灵动岛（macOS）」开关并播放音乐。")
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
        .frame(width: 310)
    }
}
