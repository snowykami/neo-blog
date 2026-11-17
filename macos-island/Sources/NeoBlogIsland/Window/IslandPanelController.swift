import AppKit
import QuartzCore
import SwiftUI

/// 无边框、平时不抢夺当前前台软件焦点，仅在歌单搜索框激活时按需接收键盘与中文/日文输入法事件的顶部悬浮面板
final class IslandOverlayPanel: NSPanel {
    var allowsKeyInput: Bool = false
    override var canBecomeKey: Bool { allowsKeyInput }
    override var canBecomeMain: Bool { false }

    /// 允许胶囊自由进入系统顶部菜单栏/状态栏与透明出血区域，禁止 AppKit 默认将窗口往下推离菜单栏
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
        frameRect
    }
}

private struct PersistedCapsulePlacement: Codable, Equatable {
    var displayID: UInt32
    var normalizedX: Double
    var offsetFromTopPt: Double
    var dockedInMenuBar: Bool
}

/// 管理屏幕顶部的 NSPanel 定位、多屏幕/状态栏磁吸自由拖拽、分辨率切换重排，以及出血透明区 100% 鼠标穿透
@MainActor
final class IslandPanelController {
    static let topCanvasBleed: CGFloat = 28
    static let bottomCanvasBleed: CGFloat = 32
    private static let placementStorageKey = "NeoBlogIsland.capsulePlacement.v1"
    private static let dragThresholdPt: CGFloat = 4.0

    private let store: IslandStore
    private var panel: IslandOverlayPanel?
    private var hostingView: NSHostingView<IslandRootView>?
    private var metrics: ScreenNotchMetrics = .current()
    private weak var previousExternalApp: NSRunningApplication?

    private var customPlacement: PersistedCapsulePlacement?
    private var dragMouseStartScreen: NSPoint?
    private var dragCapsuleCenterStart: CGPoint?
    private var isDraggingActive: Bool = false
    private var pendingPortalThrow: PeerPortalPayload? = nil

    /// 固定画布尺寸：宽度容纳展开态（360pt）+ 两侧副歌辉光出血区，高度 580pt 留足展开面板与内嵌歌单队列、弹簧回弹及 26pt 辉光阴影空间
    private let canvasSize = CGSize(width: 520, height: 580)
    /// 灵动岛当前实际可交互区域（SwiftUI 顶部向下坐标系，相对于 canvasSize）
    private var interactiveTopLeftRect: CGRect = .zero
    /// 面板目标屏幕帧（动画进行中也以目标落点计算鼠标穿透，避免 0.22s 飞行途中与动画收尾后命中框停留在旧坐标）
    private var targetPanelFrame: NSRect = .zero
    private var lastPolledMouseScreen: NSPoint = .zero

    private var globalMouseMonitor: Any?
    private var localMouseMonitor: Any?
    private var globalClickOutsideMonitor: Any?
    private var cursorPollTimer: Timer?
    private var screenObserver: NSObjectProtocol?
    private var appResignObserver: NSObjectProtocol?

    init(store: IslandStore) {
        self.store = store
        self.customPlacement = Self.loadPersistedPlacement()
        store.hasCustomCapsulePosition = (self.customPlacement != nil)

        store.onRequestKeyFocus = { [weak self] in
            self?.activateKeyInput()
        }
        store.onReleaseKeyFocus = { [weak self] restorePrevious in
            self?.releaseKeyInput(restorePreviousApp: restorePrevious)
        }
        store.onResetCapsulePosition = { [weak self] in
            self?.resetToDefaultPosition()
        }
        store.onLayoutTriggerChanged = { [weak self] in
            self?.repositionPanel(animated: true)
        }
        store.onReceivePortalArrival = { [weak self] portal in
            self?.applyIncomingPortalArrival(portal)
        }
    }

    func show() {
        let initialScreen = customPlacement.flatMap { ScreenNotchMetrics.screen(forDisplayID: $0.displayID) }
            ?? NSScreen.main
            ?? NSScreen.screens.first
        metrics = ScreenNotchMetrics.current(for: initialScreen)
        syncStorePlacementFlags(animated: false)

        let initialFrame = computePanelScreenFrame(for: metrics)
        targetPanelFrame = initialFrame
        let overlay = IslandOverlayPanel(
            contentRect: initialFrame,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        // 灵动岛始终为深色界面：强制面板使用 DarkAqua 外观，避免系统浅色模式下 TextField 占位符/编辑态文字变黑或滚动条泛白
        overlay.appearance = NSAppearance(named: .darkAqua)
        overlay.becomesKeyOnlyIfNeeded = true
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
        cursorPollTimer?.invalidate()
        cursorPollTimer = nil
        if let m = globalMouseMonitor { NSEvent.removeMonitor(m) }
        if let m = localMouseMonitor { NSEvent.removeMonitor(m) }
        if let m = globalClickOutsideMonitor { NSEvent.removeMonitor(m) }
        if let obs = screenObserver { NotificationCenter.default.removeObserver(obs) }
        if let obs = appResignObserver { NotificationCenter.default.removeObserver(obs) }
        panel?.close()
        panel = nil
    }

    /// 激活面板键盘输入能力（用于播放列表搜索框，完整支持中英日输入法候选窗与快捷键）
    func activateKeyInput() {
        guard let panel else { return }
        if let front = NSWorkspace.shared.frontmostApplication,
           front.processIdentifier != ProcessInfo.processInfo.processIdentifier {
            previousExternalApp = front
        }
        panel.allowsKeyInput = true
        panel.ignoresMouseEvents = false
        NSApplication.shared.activate()
        panel.makeKeyAndOrderFront(nil)
    }

    /// 释放面板键盘焦点并按需将焦点归还给先前的宿主前台应用
    func releaseKeyInput(restorePreviousApp: Bool) {
        guard let panel else { return }
        let wasKey = panel.isKeyWindow || panel.allowsKeyInput
        panel.allowsKeyInput = false
        panel.makeFirstResponder(nil)
        if panel.isKeyWindow {
            panel.resignKey()
        }
        if restorePreviousApp, wasKey, NSApplication.shared.isActive {
            if let prev = previousExternalApp, !prev.isTerminated {
                prev.activate()
            } else {
                NSApplication.shared.deactivate()
            }
        }
        previousExternalApp = nil
    }

    private func makeRootView(metrics: ScreenNotchMetrics) -> IslandRootView {
        IslandRootView(
            store: store,
            metrics: metrics,
            canvasSize: canvasSize
        ) { [weak self] newRect in
            guard let self else { return }
            let old = self.interactiveTopLeftRect
            if abs(newRect.minX - old.minX) > 0.5
                || abs(newRect.minY - old.minY) > 0.5
                || abs(newRect.width - old.width) > 0.5
                || abs(newRect.height - old.height) > 0.5 {
                self.interactiveTopLeftRect = newRect
            }
            self.updateMousePassthrough()
        }
    }

    private var currentUseNotch: Bool {
        metrics.effectiveUseNotch(
            mode: store.config.formMode,
            detachedFromNotch: customPlacement != nil || isDraggingActive
        )
    }

    private func defaultCapsuleCenter(for m: ScreenNotchMetrics) -> CGPoint {
        let defaultGap: CGFloat = m.hasPhysicalNotch ? (m.notchHeight + 6) : 5
        return CGPoint(
            x: m.screenFrame.midX,
            y: m.screenFrame.maxY - defaultGap - 18
        )
    }

    private func resolveCustomCapsuleGeometry(
        for m: ScreenNotchMetrics,
        placement: PersistedCapsulePlacement
    ) -> (center: CGPoint, docked: Bool, expandsUpward: Bool) {
        let sFrame = m.screenFrame
        let docked = placement.dockedInMenuBar
        let capsuleH: CGFloat = docked ? m.dockedCapsuleHeight : 36
        let halfW: CGFloat = docked ? 132 : 164

        var cx = sFrame.minX + CGFloat(placement.normalizedX) * sFrame.width
        cx = max(sFrame.minX + halfW + 4, min(sFrame.maxX - halfW - 4, cx))

        if docked && m.hasPhysicalNotch {
            let deadHalf = m.notchWidth * 0.5 + halfW + 8
            if abs(cx - sFrame.midX) < deadHalf {
                if cx <= sFrame.midX {
                    cx = max(sFrame.minX + halfW + 4, sFrame.midX - deadHalf)
                } else {
                    cx = min(sFrame.maxX - halfW - 4, sFrame.midX + deadHalf)
                }
            }
        }

        let cy: CGFloat
        if docked {
            cy = sFrame.maxY - m.menuBarHeight * 0.5
        } else {
            let rawY = sFrame.maxY - CGFloat(placement.offsetFromTopPt)
            let minY = max(sFrame.minY, m.visibleFrame.minY) + capsuleH * 0.5 + 4
            let maxY = sFrame.maxY - capsuleH * 0.5 - 2
            cy = max(minY, min(maxY, rawY))
        }

        let expandsUp = !docked && ((cy - m.visibleFrame.minY) < 420)
        return (CGPoint(x: cx, y: cy), docked, expandsUp)
    }

    private func syncStorePlacementFlags(animated: Bool) {
        let apply = {
            if self.currentUseNotch || self.customPlacement == nil {
                if self.store.isDockedInMenuBar { self.store.isDockedInMenuBar = false }
                if self.store.expandsUpward { self.store.expandsUpward = false }
            } else if let p = self.customPlacement {
                let resolved = self.resolveCustomCapsuleGeometry(for: self.metrics, placement: p)
                if self.store.isDockedInMenuBar != resolved.docked {
                    self.store.isDockedInMenuBar = resolved.docked
                }
                if self.store.expandsUpward != resolved.expandsUpward {
                    self.store.expandsUpward = resolved.expandsUpward
                }
            }
            let hasCustom = (self.customPlacement != nil)
            if self.store.hasCustomCapsulePosition != hasCustom {
                self.store.hasCustomCapsulePosition = hasCustom
            }
        }
        if animated {
            withAnimation(.spring(duration: 0.28, bounce: 0.14), apply)
        } else {
            apply()
        }
    }

    func repositionPanel(animated: Bool) {
        syncStorePlacementFlags(animated: animated)
        guard let panel else { return }
        let target = computePanelScreenFrame(for: metrics)
        targetPanelFrame = target
        if store.shouldDisplayIsland {
            panel.orderFrontRegardless()
        }
        if animated {
            NSAnimationContext.runAnimationGroup { ctx in
                ctx.duration = 0.22
                ctx.timingFunction = CAMediaTimingFunction(name: .easeOut)
                panel.animator().setFrame(target, display: true)
            } completionHandler: { [weak self] in
                Task { @MainActor in
                    self?.updateMousePassthrough()
                }
            }
        } else {
            panel.setFrame(target, display: true)
        }
        updateMousePassthrough()
    }

    private func resetToDefaultPosition() {
        customPlacement = nil
        interactiveTopLeftRect = .zero
        UserDefaults.standard.removeObject(forKey: Self.placementStorageKey)
        let mainScreen = NSScreen.main ?? NSScreen.screens.first
        let nextMetrics = ScreenNotchMetrics.current(for: mainScreen)
        if nextMetrics != metrics {
            metrics = nextMetrics
            hostingView?.rootView = makeRootView(metrics: nextMetrics)
        }
        repositionPanel(animated: true)
    }

    private static func loadPersistedPlacement() -> PersistedCapsulePlacement? {
        guard let data = UserDefaults.standard.data(forKey: placementStorageKey) else { return nil }
        return try? JSONDecoder().decode(PersistedCapsulePlacement.self, from: data)
    }

    private static func savePersistedPlacement(_ placement: PersistedCapsulePlacement) {
        if let data = try? JSONEncoder().encode(placement) {
            UserDefaults.standard.set(data, forKey: placementStorageKey)
        }
    }

    private func computePanelScreenFrame(for m: ScreenNotchMetrics) -> NSRect {
        if currentUseNotch {
            let x = m.screenFrame.midX - canvasSize.width * 0.5
            let y = m.screenFrame.maxY - canvasSize.height
            return NSRect(x: x, y: y, width: canvasSize.width, height: canvasSize.height)
        }

        guard let placement = customPlacement else {
            let defaultGap: CGFloat = m.hasPhysicalNotch ? (m.notchHeight + 6) : 5
            let capsuleTopY = m.screenFrame.maxY - defaultGap
            let x = m.screenFrame.midX - canvasSize.width * 0.5
            let y = (capsuleTopY + Self.topCanvasBleed) - canvasSize.height
            return NSRect(x: x, y: y, width: canvasSize.width, height: canvasSize.height)
        }

        let resolved = resolveCustomCapsuleGeometry(for: m, placement: placement)
        let capsuleH: CGFloat = resolved.docked ? m.dockedCapsuleHeight : 36
        let centerX: CGFloat = store.isExpanded
            ? max(m.screenFrame.minX + 186, min(m.screenFrame.maxX - 186, resolved.center.x))
            : resolved.center.x
        let x = centerX - canvasSize.width * 0.5

        if resolved.expandsUpward {
            let capsuleBottomY = resolved.center.y - capsuleH * 0.5
            let y = capsuleBottomY - Self.bottomCanvasBleed
            return NSRect(x: x, y: y, width: canvasSize.width, height: canvasSize.height)
        } else {
            let capsuleTopY = (store.isExpanded && resolved.docked)
                ? (m.screenFrame.maxY - m.menuBarHeight - 4)
                : (resolved.center.y + capsuleH * 0.5)
            let y = (capsuleTopY + Self.topCanvasBleed) - canvasSize.height
            return NSRect(x: x, y: y, width: canvasSize.width, height: canvasSize.height)
        }
    }

    private func refreshScreenMetrics() {
        let targetScreen: NSScreen? = {
            if !currentUseNotch, let p = customPlacement, let matched = ScreenNotchMetrics.screen(forDisplayID: p.displayID) {
                return matched
            }
            return NSScreen.main ?? NSScreen.screens.first
        }()
        let latest = ScreenNotchMetrics.current(for: targetScreen)
        metrics = latest
        hostingView?.rootView = makeRootView(metrics: latest)
        repositionPanel(animated: false)
    }

    // MARK: - 胶囊自由拖拽与顶部状态栏磁吸状态机（基于 AppKit 全局屏幕坐标，120Hz 零抖动）

    private func canDragCompactCapsule(for event: NSEvent) -> Bool {
        guard store.shouldDisplayIsland,
              !store.isExpanded,
              store.config.formMode != .notchMerged,
              !store.isPositionLocked,
              store.peerService.pendingPairRequest == nil,
              event.modifierFlags.intersection([.control]) == [] else {
            return false
        }
        return true
    }

    private func beginPotentialDrag() {
        dragMouseStartScreen = NSEvent.mouseLocation
        pendingPortalThrow = nil
        if let p = customPlacement {
            dragCapsuleCenterStart = resolveCustomCapsuleGeometry(for: metrics, placement: p).center
        } else {
            dragCapsuleCenterStart = defaultCapsuleCenter(for: metrics)
        }
        isDraggingActive = false
    }

    private func applyIncomingPortalArrival(_ portal: PeerPortalPayload) {
        let arrivalEdge = portal.fromEdge.oppositeOnReceivingMac
        let targetScreen: NSScreen? = {
            let screens = NSScreen.screens
            guard !screens.isEmpty else { return NSScreen.main }
            return arrivalEdge == .left
                ? screens.min(by: { $0.frame.minX < $1.frame.minX })
                : screens.max(by: { $0.frame.maxX < $1.frame.maxX })
        }()
        let nextMetrics = ScreenNotchMetrics.current(for: targetScreen)
        if nextMetrics != metrics {
            metrics = nextMetrics
            hostingView?.rootView = makeRootView(metrics: nextMetrics)
        }
        let targetNormX = (arrivalEdge == .left) ? 0.12 : 0.88
        let arrivedPlacement = PersistedCapsulePlacement(
            displayID: nextMetrics.displayID,
            normalizedX: targetNormX,
            offsetFromTopPt: portal.offsetFromTopPt,
            dockedInMenuBar: portal.dockedInMenuBar
        )
        if customPlacement?.dockedInMenuBar != arrivedPlacement.dockedInMenuBar || customPlacement == nil {
            interactiveTopLeftRect = .zero
        }
        customPlacement = arrivedPlacement
        Self.savePersistedPlacement(arrivedPlacement)
        repositionPanel(animated: true)
    }

    private func updateCapsuleDrag() -> Bool {
        guard let startMouse = dragMouseStartScreen,
              let startCenter = dragCapsuleCenterStart else {
            return false
        }
        let mouse = NSEvent.mouseLocation
        let dx = mouse.x - startMouse.x
        let dy = mouse.y - startMouse.y

        if !isDraggingActive {
            guard hypot(dx, dy) >= Self.dragThresholdPt else {
                return false
            }
            isDraggingActive = true
            store.isDraggingCapsule = true
        }

        let targetCenter = CGPoint(x: startCenter.x + dx, y: startCenter.y + dy)
        let activeScreen = ScreenNotchMetrics.screen(containing: mouse)
            ?? ScreenNotchMetrics.screen(containing: targetCenter)
            ?? NSScreen.main
            ?? NSScreen.screens.first

        let nextMetrics = ScreenNotchMetrics.current(for: activeScreen)
        if nextMetrics != metrics {
            metrics = nextMetrics
            hostingView?.rootView = makeRootView(metrics: nextMetrics)
        }

        let sFrame = nextMetrics.screenFrame
        // 拖入屏幕顶部菜单栏热区（距顶边 <= menuBarHeight + 6pt）时自动磁吸居中对齐状态栏
        let inMenuBarBand = targetCenter.y >= (sFrame.maxY - nextMetrics.menuBarHeight - 6)
        let normX = max(0.0, min(1.0, Double((targetCenter.x - sFrame.minX) / max(1, sFrame.width))))
        let offsetTop = Double(max(0, sFrame.maxY - targetCenter.y))

        // 检测是否推到了本机最外侧物理屏幕左/右边界（带 12pt 进入 / 26pt 退出回差，防止屏幕边缘手抖反复闪烁预备态）
        if store.canPortalThrowToPeer {
            let beyondLeft = NSPoint(x: sFrame.minX - 14, y: mouse.y)
            let beyondRight = NSPoint(x: sFrame.maxX + 14, y: mouse.y)
            let leftThreshold: CGFloat = (pendingPortalThrow?.fromEdge == .left) ? 26 : 12
            let rightThreshold: CGFloat = (pendingPortalThrow?.fromEdge == .right) ? 26 : 12
            let atOuterLeft = (mouse.x <= sFrame.minX + leftThreshold) && (ScreenNotchMetrics.screen(containing: beyondLeft) == nil)
            let atOuterRight = (mouse.x >= sFrame.maxX - rightThreshold) && (ScreenNotchMetrics.screen(containing: beyondRight) == nil)

            if atOuterLeft {
                let p = PeerPortalPayload(fromEdge: .left, offsetFromTopPt: offsetTop, dockedInMenuBar: inMenuBarBand)
                pendingPortalThrow = p
                store.updatePortalDragPreview(p)
            } else if atOuterRight {
                let p = PeerPortalPayload(fromEdge: .right, offsetFromTopPt: offsetTop, dockedInMenuBar: inMenuBarBand)
                pendingPortalThrow = p
                store.updatePortalDragPreview(p)
            } else {
                pendingPortalThrow = nil
                store.updatePortalDragPreview(nil)
            }
        } else {
            pendingPortalThrow = nil
            store.updatePortalDragPreview(nil)
        }

        customPlacement = PersistedCapsulePlacement(
            displayID: nextMetrics.displayID,
            normalizedX: normX,
            offsetFromTopPt: offsetTop,
            dockedInMenuBar: inMenuBarBand
        )
        syncStorePlacementFlags(animated: true)
        if let panel {
            let nextFrame = computePanelScreenFrame(for: nextMetrics)
            targetPanelFrame = nextFrame
            panel.setFrame(nextFrame, display: true)
        }
        return true
    }

    private func finishPotentialDrag() -> Bool {
        let wasDragging = isDraggingActive
        let portalToCommit = pendingPortalThrow
        pendingPortalThrow = nil
        dragMouseStartScreen = nil
        dragCapsuleCenterStart = nil
        isDraggingActive = false
        if store.isDraggingCapsule {
            store.isDraggingCapsule = false
        }
        if wasDragging {
            store.markDragEnded()
            if let portalToCommit, store.canPortalThrowToPeer {
                store.commitPortalThrow(portalToCommit)
            } else {
                store.updatePortalDragPreview(nil)
                if let placement = customPlacement {
                    Self.savePersistedPlacement(placement)
                }
            }
            updateMousePassthrough()
        }
        return wasDragging
    }

    /// 当跨屏刚抵达首帧、SwiftUI 几何回调尚未跑完时，提供确定性的胶囊/面板命中兜底框，杜绝 interactiveTopLeftRect 为零导致点不动
    private func effectiveInteractiveTopLeftRect() -> CGRect {
        if interactiveTopLeftRect.width > 1 && interactiveTopLeftRect.height > 1 {
            return interactiveTopLeftRect
        }
        let w: CGFloat = store.isExpanded ? 364 : (store.isDockedInMenuBar ? 276 : 332)
        let h: CGFloat = store.isExpanded ? 420 : (store.isDockedInMenuBar ? metrics.dockedCapsuleHeight : 38)
        let x = (canvasSize.width - w) * 0.5
        let y: CGFloat
        if !currentUseNotch && store.expandsUpward {
            y = canvasSize.height - Self.bottomCanvasBleed - h
        } else {
            y = currentUseNotch ? 0 : Self.topCanvasBleed
        }
        return CGRect(x: x, y: y, width: w, height: h)
    }

    /// 精确判断鼠标是否落在胶囊/展开面板实体内：在出血辉光区时开启 ignoresMouseEvents 100% 穿透给底层菜单栏和应用
    private func updateMousePassthrough() {
        guard let panel else { return }
        if isDraggingActive {
            if panel.ignoresMouseEvents { panel.ignoresMouseEvents = false }
            return
        }
        if !store.shouldDisplayIsland {
            if !panel.ignoresMouseEvents { panel.ignoresMouseEvents = true }
            if store.isHovering { store.isHovering = false }
            return
        }

        let mouseScreen = NSEvent.mouseLocation
        let pFrame = targetPanelFrame.width > 1 ? targetPanelFrame : panel.frame
        let hitLocal = effectiveInteractiveTopLeftRect()
        // 将 SwiftUI 顶对齐坐标 (0,0 在左上) 换算为 AppKit 屏幕坐标 (0,0 在左下)
        let screenHitRect = NSRect(
            x: pFrame.minX + hitLocal.minX,
            y: pFrame.maxY - hitLocal.maxY,
            width: hitLocal.width,
            height: hitLocal.height
        ).insetBy(dx: -4, dy: -4)

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
            matching: [.mouseMoved, .leftMouseDragged, .leftMouseDown, .rightMouseDown]
        ) { [weak self] _ in
            Task { @MainActor in
                self?.updateMousePassthrough()
            }
        }

        // 兜底苹果「通用控制 (Universal Control)」跨机注入虚拟光标时偶发吞掉全局 mouseMoved 事件的问题：
        // 仅在岛可见且鼠标屏幕坐标实际发生变化时刷新穿透状态，静止时零布局开销
        let pollTimer = Timer(timeInterval: 0.08, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.store.shouldDisplayIsland, !self.isDraggingActive else { return }
                let cur = NSEvent.mouseLocation
                if abs(cur.x - self.lastPolledMouseScreen.x) > 0.5 || abs(cur.y - self.lastPolledMouseScreen.y) > 0.5 {
                    self.lastPolledMouseScreen = cur
                    self.updateMousePassthrough()
                } else if let panel = self.panel {
                    // 即使鼠标静止停在刚飞过来的灵动岛落点正上方，也确保穿透开关与真实命中状态一致
                    let pFrame = self.targetPanelFrame.width > 1 ? self.targetPanelFrame : panel.frame
                    let hitLocal = self.effectiveInteractiveTopLeftRect()
                    let screenHitRect = NSRect(
                        x: pFrame.minX + hitLocal.minX,
                        y: pFrame.maxY - hitLocal.maxY,
                        width: hitLocal.width,
                        height: hitLocal.height
                    ).insetBy(dx: -4, dy: -4)
                    let shouldIgnore = !screenHitRect.contains(cur)
                    if panel.ignoresMouseEvents != shouldIgnore {
                        panel.ignoresMouseEvents = shouldIgnore
                    }
                }
            }
        }
        RunLoop.main.add(pollTimer, forMode: .common)
        cursorPollTimer = pollTimer

        localMouseMonitor = NSEvent.addLocalMonitorForEvents(
            matching: [.mouseMoved, .leftMouseDown, .leftMouseDragged, .leftMouseUp]
        ) { [weak self] event in
            guard let self else { return event }
            switch event.type {
            case .leftMouseDown:
                if self.canDragCompactCapsule(for: event) {
                    self.beginPotentialDrag()
                }
                return event

            case .leftMouseDragged:
                if self.dragMouseStartScreen != nil, self.updateCapsuleDrag() {
                    return nil
                }
                self.updateMousePassthrough()
                return event

            case .leftMouseUp:
                if self.dragMouseStartScreen != nil {
                    _ = self.finishPotentialDrag()
                }
                self.updateMousePassthrough()
                return event

            default:
                self.updateMousePassthrough()
                return event
            }
        }

        // 面板展开时，点击面板以外的任意桌面区域自动收起回胶囊（排除中文/日文输入法组字候选条点击）
        globalClickOutsideMonitor = NSEvent.addGlobalMonitorForEvents(
            matching: [.leftMouseDown, .rightMouseDown]
        ) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.store.isExpanded, let panel = self.panel else { return }
                if let textView = panel.firstResponder as? NSTextView, textView.hasMarkedText() {
                    return
                }
                if panel.ignoresMouseEvents {
                    self.releaseKeyInput(restorePreviousApp: false)
                    withAnimation(.spring(duration: 0.34, bounce: 0.2)) {
                        self.store.showPlaylistOverlay = false
                        self.store.isExpanded = false
                    }
                }
            }
        }

        appResignObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didResignActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                guard let self, let panel = self.panel else { return }
                if panel.allowsKeyInput {
                    panel.allowsKeyInput = false
                    panel.makeFirstResponder(nil)
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
