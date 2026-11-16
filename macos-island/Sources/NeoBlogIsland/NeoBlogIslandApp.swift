import AppKit
import SwiftUI

/// neo-blog macOS 原生系统灵动岛入口
///
/// 【双端同步维护约定】
/// 本原生应用与博客前端音乐灵动岛保持行为、排版、动效与交互 1:1 对齐。
/// 一旦新增或修改任何音乐灵动岛 feature（紧凑胶囊、展开迷你播放器、歌词排版/特效、控播指令、偏好开关等），必须双端同步实现：
/// - Web 端：`web/src/components/layout/topbar-island/music-island.tsx`、`music-island-compact.tsx`、`web/src/components/common/mini-player.tsx`
/// - 桥接层：`web/src/components/common/desktop-island-bridge.tsx` ↔ `Models/IslandModels.swift`
/// - Swift 端：`Services/IslandStore.swift` 及 `Views/` 下对应视图
@main
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var store: IslandStore!
    private var panelController: IslandPanelController!
    private var statusItem: NSStatusItem!
    private let popover = NSPopover()

    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        // 无头 Agent 模式（等价于 Info.plist 的 LSUIElement = YES）：不在 Dock 显示图标、不抢应用菜单栏
        app.setActivationPolicy(.accessory)
        app.run()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        store = IslandStore()
        panelController = IslandPanelController(store: store)
        panelController.show()

        setupMenuBarControlItem()
    }

    func applicationWillTerminate(_ notification: Notification) {
        store?.bridgeServer.stop()
        panelController?.close()
    }

    private func setupMenuBarControlItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem.button {
            button.image = NSImage(
                systemSymbolName: "waveform.circle",
                accessibilityDescription: "neo-blog 灵动岛设置"
            )
            button.action = #selector(toggleSettingsPopover(_:))
            button.target = self
        }

        let hasNotch = ScreenNotchMetrics.current().hasPhysicalNotch
        popover.behavior = .transient
        popover.contentSize = NSSize(width: 340, height: 360)
        popover.contentViewController = NSHostingController(
            rootView: SettingsPopoverView(store: store, hasPhysicalNotch: hasNotch)
        )
    }

    @objc private func toggleSettingsPopover(_ sender: AnyObject?) {
        guard let button = statusItem.button else { return }
        if popover.isShown {
            popover.performClose(sender)
        } else {
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            popover.contentViewController?.view.window?.makeKey()
        }
    }
}
