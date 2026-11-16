import AppKit
import SwiftUI

/// 无边框、不抢夺当前前台软件焦点的顶部悬浮面板
final class IslandOverlayPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

/// 管理屏幕顶部的 NSPanel 定位、多屏幕/分辨率切换重排，以及出血透明区 100% 鼠标穿透
@MainActor
final class IslandPanelController {
    private let store: IslandStore
    private var panel: IslandOverlayPanel?
    private var hostingView: NSHostingView<IslandRootView>?
    private var metrics: ScreenNotchMetrics = .current()

    /// 固定画布尺寸：宽度容纳展开态（360pt）+ 两侧副歌辉光出血区，高度 580pt 留足展开面板底部圆角、弹簧回弹与 26pt 辉光阴影空间，绝不裁切底部
    private let canvasSize = CGSize(width: 520, height: 580)
    /// 灵动岛当前实际可交互区域（SwiftUI 顶部向下坐标系，相对于 canvasSize）
    private var interactiveTopLeftRect: CGRect = .zero

    private var globalMouseMonitor: Any?
    private var localMouseMonitor: Any?
    private var globalClickOutsideMonitor: Any?
    private var screenObserver: NSObjectProtocol?

    init(store: IslandStore) {
        self.store = store
    }

    func show() {
        metrics = ScreenNotchMetrics.current()

        let overlay = IslandOverlayPanel(
            contentRect: computePanelScreenFrame(for: metrics),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        // 高于系统菜单栏（statusBar / mainMenu），使胶囊能融合覆盖在刘海与顶栏之上
        let menuLevel = Int(CGWindowLevelForKey(.mainMenuWindow))
        overlay.level = NSWindow.Level(rawValue: menuLevel + 2)
        overlay.collectionBehavior = [
            .canJoinAllSpaces,
            .fullScreenAuxiliary,
            .stationary,
            .ignoresCycle
        ]
        overlay.isOpaque = false
        overlay.backgroundColor = .clear
        overlay.hasShadow = false
        overlay.hidesOnDeactivate = false
        overlay.acceptsMouseMovedEvents = true
        overlay.ignoresMouseEvents = true

        let rootView = makeRootView(metrics: metrics)
        let host = NSHostingView(rootView: rootView)
        host.frame = NSRect(origin: .zero, size: canvasSize)
        // 允许 XDR 显示器渲染超出 SDR 1.0 的原生 EDR 高光
        host.layer?.wantsExtendedDynamicRangeContent = true

        overlay.contentView = host
        overlay.orderFrontRegardless()

        self.panel = overlay
        self.hostingView = host

        installMonitors()
        updateMousePassthrough()
    }

    func close() {
        if let m = globalMouseMonitor { NSEvent.removeMonitor(m) }
        if let m = localMouseMonitor { NSEvent.removeMonitor(m) }
        if let m = globalClickOutsideMonitor { NSEvent.removeMonitor(m) }
        if let obs = screenObserver { NotificationCenter.default.removeObserver(obs) }
        panel?.close()
        panel = nil
    }

    private func makeRootView(metrics: ScreenNotchMetrics) -> IslandRootView {
        IslandRootView(
            store: store,
            metrics: metrics,
            canvasSize: canvasSize
        ) { [weak self] newRect in
            guard let self else { return }
            self.interactiveTopLeftRect = newRect
            self.updateMousePassthrough()
        }
    }

    private func computePanelScreenFrame(for m: ScreenNotchMetrics) -> NSRect {
        let x = m.screenFrame.midX - canvasSize.width * 0.5
        let y = m.screenFrame.maxY - canvasSize.height
        return NSRect(x: x, y: y, width: canvasSize.width, height: canvasSize.height)
    }

    private func refreshScreenMetrics() {
        let latest = ScreenNotchMetrics.current()
        guard latest != metrics else { return }
        metrics = latest
        panel?.setFrame(computePanelScreenFrame(for: latest), display: true)
        hostingView?.rootView = makeRootView(metrics: latest)
        updateMousePassthrough()
    }

    /// 精确判断鼠标是否落在胶囊/展开面板实体内：在出血辉光区时开启 ignoresMouseEvents 100% 穿透给底层菜单栏和应用
    private func updateMousePassthrough() {
        guard let panel else { return }
        if !store.shouldDisplayIsland || interactiveTopLeftRect.width <= 1 {
            if !panel.ignoresMouseEvents { panel.ignoresMouseEvents = true }
            if store.isHovering { store.isHovering = false }
            return
        }

        let mouseScreen = NSEvent.mouseLocation
        let pFrame = panel.frame
        // 将 SwiftUI 顶对齐坐标 (0,0 在左上) 换算为 AppKit 屏幕坐标 (0,0 在左下)
        let screenHitRect = NSRect(
            x: pFrame.minX + interactiveTopLeftRect.minX,
            y: pFrame.maxY - interactiveTopLeftRect.maxY,
            width: interactiveTopLeftRect.width,
            height: interactiveTopLeftRect.height
        ).insetBy(dx: -2, dy: -2)

        let inside = screenHitRect.contains(mouseScreen)
        let shouldIgnore = !inside
        if panel.ignoresMouseEvents != shouldIgnore {
            panel.ignoresMouseEvents = shouldIgnore
        }
        if !inside && store.isHovering {
            store.isHovering = false
        }
    }

    private func installMonitors() {
        globalMouseMonitor = NSEvent.addGlobalMonitorForEvents(
            matching: [.mouseMoved, .leftMouseDragged]
        ) { [weak self] _ in
            Task { @MainActor in
                self?.updateMousePassthrough()
            }
        }

        localMouseMonitor = NSEvent.addLocalMonitorForEvents(
            matching: [.mouseMoved, .leftMouseDragged]
        ) { [weak self] event in
            Task { @MainActor in
                self?.updateMousePassthrough()
            }
            return event
        }

        // 面板展开时，点击面板以外的任意桌面区域自动收起回胶囊
        globalClickOutsideMonitor = NSEvent.addGlobalMonitorForEvents(
            matching: [.leftMouseDown, .rightMouseDown]
        ) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.store.isExpanded, let panel = self.panel else { return }
                if panel.ignoresMouseEvents {
                    withAnimation(.spring(duration: 0.34, bounce: 0.2)) {
                        self.store.showPlaylistOverlay = false
                        self.store.isExpanded = false
                    }
                }
            }
        }

        screenObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.refreshScreenMetrics()
            }
        }
    }
}
