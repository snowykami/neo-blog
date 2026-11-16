import AppKit
import SwiftUI

/// 灵动岛主容器：严格对齐博客顶栏岛的显隐、弹簧曲线、副歌描边与两档外发光（normal / strong）及滑走隐藏手势
///
/// 【双端同步维护约定】与 `web/src/components/layout/topbar-island/topbar-island.tsx` 及 `music-island.tsx` 同步维护；新增 feature 时双端均需实现。
struct IslandRootView: View {
    let store: IslandStore
    let metrics: ScreenNotchMetrics
    let canvasSize: CGSize
    let onInteractiveFrameChanged: (CGRect) -> Void

    @Namespace private var coverNamespace

    var body: some View {
        let useNotch = metrics.effectiveUseNotch(mode: store.config.formMode)
        let topEarRadius: CGFloat = useNotch ? 11 : 0
        let bottomCornerRadius: CGFloat = store.isExpanded ? 24 : (useNotch ? 16 : 18)
        let topGap: CGFloat = useNotch ? 0 : (metrics.hasPhysicalNotch ? metrics.notchHeight + 6 : 5)
        let islandShape = NotchIslandShape(topEarRadius: topEarRadius, bottomCornerRadius: bottomCornerRadius)

        ZStack(alignment: .top) {
            Color.clear

            if store.shouldDisplayIsland {
                IslandSurfaceView(
                    store: store,
                    metrics: metrics,
                    useNotch: useNotch,
                    shape: islandShape,
                    coverNamespace: coverNamespace,
                    onInteractiveFrameChanged: onInteractiveFrameChanged
                )
                .padding(.top, topGap)
                .transition(
                    .asymmetric(
                        insertion: .scale(scale: 0.78, anchor: .top).combined(with: .opacity),
                        removal: .scale(scale: 0.82, anchor: .top).combined(with: .opacity)
                    )
                )
            } else {
                Color.clear
                    .frame(width: 0, height: 0)
                    .onAppear {
                        onInteractiveFrameChanged(.zero)
                    }
            }
        }
        .frame(width: canvasSize.width, height: canvasSize.height, alignment: .top)
        .coordinateSpace(name: "panelCanvas")
        .animation(.spring(duration: 0.38, bounce: 0.25), value: store.shouldDisplayIsland)
    }
}

/// 遵循 swiftui-expert-skill：将带交互与悬停状态的主表面拆为独立 View 结构体而非内联 @ViewBuilder 方法，并设置 0.5pt 几何门限防抖
private struct IslandSurfaceView: View {
    let store: IslandStore
    let metrics: ScreenNotchMetrics
    let useNotch: Bool
    let shape: NotchIslandShape
    let coverNamespace: Namespace.ID
    let onInteractiveFrameChanged: (CGRect) -> Void

    @State private var lastReportedRect: CGRect = .zero

    var body: some View {
        let activeGlow = (store.config.chorusGlow && store.showPlaying) ? store.glow : nil
        let glowColor = Color(cssColor: activeGlow?.color ?? store.accentHex)
        let isStrongGlow = activeGlow?.strong == true

        ZStack(alignment: .top) {
            if store.isExpanded {
                ExpandedPlayerView(
                    store: store,
                    topReservedHeight: useNotch ? metrics.notchHeight : 0,
                    coverNamespace: coverNamespace
                )
                .transition(.opacity.combined(with: .scale(scale: 0.96, anchor: .top)))
            } else {
                CompactIslandContent(
                    store: store,
                    metrics: metrics,
                    useNotch: useNotch,
                    coverNamespace: coverNamespace
                )
                .padding(.horizontal, useNotch ? 11 : 0)
                .contentShape(shape)
                .onTapGesture {
                    guard store.track != nil else { return }
                    if !store.showPlaying {
                        store.play()
                    } else if store.config.expandable {
                        withAnimation(.spring(duration: 0.38, bounce: 0.25)) {
                            store.isExpanded = true
                        }
                    } else {
                        store.togglePlay()
                    }
                }
                .onLongPressGesture(minimumDuration: 0.26) {
                    guard store.track != nil, store.config.expandable else { return }
                    withAnimation(.spring(duration: 0.38, bounce: 0.25)) {
                        store.isExpanded = true
                    }
                }
                .gesture(
                    DragGesture(minimumDistance: 28)
                        .onEnded { value in
                            if abs(value.translation.width) > 36 && abs(value.translation.height) < 28 {
                                store.hideCurrentTrack()
                            }
                        }
                )
            }
        }
        .background {
            CoverBackdropView(
                store: store,
                expanded: store.isExpanded
            )
            .compositingGroup()
            .clipShape(shape)
        }
        .clipShape(shape)
        .overlay {
            shape
                .stroke(
                    activeGlow != nil ? glowColor.opacity(0.92) : Color.white.opacity(0.11),
                    lineWidth: activeGlow != nil ? 1.5 : 0.9
                )
                .allowsHitTesting(false)
        }
        .fixedSize()
        .shadow(
            color: activeGlow != nil
                ? glowColor.opacity(isStrongGlow ? 0.72 : 0.54)
                : Color.black.opacity(store.isExpanded ? 0.50 : 0.28),
            radius: activeGlow != nil
                ? (isStrongGlow ? 26 : 15)
                : (store.isExpanded ? 24 : 10),
            x: 0,
            y: activeGlow != nil ? 2 : (store.isExpanded ? 12 : 4)
        )
        .scaleEffect(!store.isExpanded && store.isHovering ? 1.016 : 1.0, anchor: .top)
        .animation(.spring(duration: 0.38, bounce: 0.25), value: store.isExpanded)
        .animation(.spring(duration: 0.36, bounce: 0.22), value: store.showPlaying)
        .animation(.easeOut(duration: 0.2), value: store.isHovering)
        .animation(.easeInOut(duration: 0.4), value: activeGlow)
        .onHover { hovering in
            if store.isHovering != hovering {
                store.isHovering = hovering
            }
        }
        .contextMenu {
            if store.config.expandable {
                Button(store.isExpanded ? "收起面板" : "展开迷你播放器") {
                    withAnimation(.spring(duration: 0.38, bounce: 0.25)) {
                        store.isExpanded.toggle()
                    }
                }
            }
            Button(store.isPlaying ? "暂停" : "播放") {
                store.togglePlay()
            }
            Button("上一首") {
                store.prevTrack()
            }
            Button("下一首") {
                store.nextTrack()
            }
            Divider()
            Button("在博客打开完整播放器页 (/music)") {
                store.openBlogPlayerPage()
            }
            Button("在顶栏隐藏本首曲目") {
                store.hideCurrentTrack()
            }
            Divider()
            Button("退出 macOS 灵动岛") {
                NSApplication.shared.terminate(nil)
            }
        }
        .onGeometryChange(for: CGRect.self) { proxy in
            proxy.frame(in: .named("panelCanvas"))
        } action: { newRect in
            if abs(newRect.minX - lastReportedRect.minX) > 0.5
                || abs(newRect.minY - lastReportedRect.minY) > 0.5
                || abs(newRect.width - lastReportedRect.width) > 0.5
                || abs(newRect.height - lastReportedRect.height) > 0.5 {
                lastReportedRect = newRect
                onInteractiveFrameChanged(newRect)
            }
        }
    }
}
