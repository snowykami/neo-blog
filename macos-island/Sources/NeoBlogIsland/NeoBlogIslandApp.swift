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
        installStandardEditMenu()
        store = IslandStore()
        panelController = IslandPanelController(store: store)
        panelController.show()

        setupMenuBarControlItem()
    }

    /// 为 .accessory 无头应用挂载标准 Edit 响应链菜单（不显示顶栏菜单，但使搜索框原生支持 ⌘A / ⌘C / ⌘V / ⌘X / ⌘Z）
    private func installStandardEditMenu() {
        let mainMenu = NSMenu()

        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "退出 neo-blog 灵动岛", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)

        let editMenuItem = NSMenuItem()
        let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = editMenu.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "Z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenuItem.submenu = editMenu
        mainMenu.addItem(editMenuItem)

        NSApplication.shared.mainMenu = mainMenu
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
        let hostingController = NSHostingController(
            rootView: SettingsPopoverView(store: store, hasPhysicalNotch: hasNotch)
        )
        hostingController.sizingOptions = [.preferredContentSize]
        popover.contentViewController = hostingController
    }

    @objc private func toggleSettingsPopover(_ sender: AnyObject?) {
        guard let button = statusItem.button else { return }
        if popover.isShown {
            popover.performClose(sender)
        } else {
            NSApplication.shared.activate()
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            popover.contentViewController?.view.window?.makeKeyAndOrderFront(nil)
        }
    }
}
