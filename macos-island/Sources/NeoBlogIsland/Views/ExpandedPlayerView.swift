import AppKit
import ImageIO
import SwiftUI

/// 展开后的迷你播放器面板（遵循 swiftui-expert-skill：按职责拆分为顶栏、舞台/内嵌歌单、精简两排主控栏与右上角控制中心浮层独立子视图边界）
///
/// 【双端同步维护约定】对应网页端 `web/src/components/common/mini-player.tsx` 与 `music-page-controls.tsx` (compact + MiniPlayerMoreMenu)；
/// 新增展开态交互、控件或舞台特性时双端必须同步实现。
struct ExpandedPlayerView: View {
    let store: IslandStore
    let topReservedHeight: CGFloat
    let coverNamespace: Namespace.ID

    @State private var isControlCenterOpen: Bool = false
    @State private var copiedFeedback: Bool = false

    var body: some View {
        let topPad: CGFloat = topReservedHeight > 0 ? 4 : 16
        let isMutedNow = store.isMuted || store.volume <= 0.001

        ZStack(alignment: .topTrailing) {
            VStack(spacing: 12) {
                if topReservedHeight > 0 {
                    Spacer().frame(height: topReservedHeight)
                }

                ExpandedHeaderSection(
                    track: store.track,
                    accentColor: store.accentColor,
                    isPlaying: store.isPlaying,
                    isMuted: isMutedNow,
                    isControlCenterOpen: isControlCenterOpen,
                    coverNamespace: coverNamespace,
                    onToggleControlCenter: { toggleControlCenter() },
                    onOpenFullPlayer: { store.openBlogPlayerPage() }
                )

                if store.showPlaylistOverlay {
                    ExpandedPlaylistQueueSection(
                        store: store,
                        onDismiss: { closePlaylist() }
                    )
                    .frame(height: 268)
                    .transition(.opacity.combined(with: .scale(scale: 0.96, anchor: .bottom)))
                } else {
                    CompactStageLyricsView(
                        store: store,
                        allowWheelScroll: !isControlCenterOpen
                    )
                    .frame(height: 200)
                    .transition(.opacity.combined(with: .scale(scale: 0.98, anchor: .top)))
                }

                ExpandedControlsSection(
                    store: store,
                    isPlaylistOpen: store.showPlaylistOverlay,
                    onTogglePlaylist: { togglePlaylist() }
                )
            }
            .frame(width: 328)
            .padding(.horizontal, 16)
            .padding(.top, topPad)
            .padding(.bottom, 16)

            // 右上角统一「小窗控制中心」浮层（1:1 对齐网页端 MiniPlayerMoreMenu）
            if isControlCenterOpen {
                Color.black.opacity(0.001)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        withAnimation(.spring(duration: 0.24, bounce: 0.12)) {
                            isControlCenterOpen = false
                        }
                    }

                ExpandedControlCenterPopover(
                    store: store,
                    copied: copiedFeedback,
                    onCopyLyrics: {
                        if store.copyFormattedLyricsToPasteboard() {
                            copiedFeedback = true
                            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                                copiedFeedback = false
                            }
                        }
                    }
                )
                .padding(.top, topPad + topReservedHeight + 36)
                .padding(.trailing, 14)
                .transition(.opacity.combined(with: .scale(scale: 0.90, anchor: .topTrailing)))
            }
        }
        .frame(width: 360)
        .clipped()
        .animation(.spring(duration: 0.32, bounce: 0.16), value: store.showPlaylistOverlay)
    }

    private func togglePlaylist() {
        let willOpen = !store.showPlaylistOverlay
        withAnimation(.spring(duration: 0.32, bounce: 0.16)) {
            isControlCenterOpen = false
            store.showPlaylistOverlay = willOpen
        }
        if !willOpen {
            store.releaseKeyFocus(restorePreviousApp: true)
        }
    }

    private func closePlaylist() {
        guard store.showPlaylistOverlay else { return }
        withAnimation(.spring(duration: 0.28, bounce: 0.14)) {
            store.showPlaylistOverlay = false
        }
        store.releaseKeyFocus(restorePreviousApp: true)
    }

    private func toggleControlCenter() {
        withAnimation(.spring(duration: 0.26, bounce: 0.16)) {
            isControlCenterOpen.toggle()
        }
    }
}

// MARK: - 通用圆形悬停图标按钮（1:1 对齐 MUSIC_ICON_BUTTON_CLASSNAME 与 IconButton active/disabled/busy 态）

private struct PlayerIconButton<IconContent: View>: View {
    let helpText: String
    var active: Bool? = nil
    var highlightedBg: Bool = false
    var disabled: Bool = false
    var busy: Bool = false
    let action: () -> Void
    @ViewBuilder let icon: () -> IconContent

    @State private var isHovered: Bool = false

    var body: some View {
        let fgOpacity: Double = {
            if disabled { return 0.15 }
            if let active {
                return active ? 1.0 : (isHovered ? 0.65 : 0.35)
            }
            return (isHovered || highlightedBg) ? 1.0 : 0.70
        }()

        Button(action: action) {
            ZStack {
                if busy {
                    ProgressView()
                        .controlSize(.small)
                        .tint(.white)
                } else {
                    icon()
                        .foregroundStyle(.white.opacity(fgOpacity))
                }
            }
            .frame(width: 34, height: 34)
            .background(
                Color.white.opacity(highlightedBg ? 0.15 : (isHovered && !disabled ? 0.10 : 0)),
                in: Circle()
            )
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .help(helpText)
        .onHover { hovering in
            if isHovered != hovering {
                isHovered = hovering
            }
        }
    }
}

// MARK: - 1. 顶栏（对齐 mini-player.tsx：56pt 圆角封面 + 标题/别名 + 歌手·专辑 + 右上角「更多控制中心」与「打开完整播放器页」）

private struct ExpandedHeaderSection: View {
    let track: IslandTrack?
    let accentColor: Color
    let isPlaying: Bool
    let isMuted: Bool
    let isControlCenterOpen: Bool
    let coverNamespace: Namespace.ID
    let onToggleControlCenter: () -> Void
    let onOpenFullPlayer: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            AlbumCoverView(
                albumPicURL: track?.albumPic,
                accent: accentColor,
                isSpinning: false,
                size: 56,
                cornerRadius: 12
            )
            .matchedGeometryEffect(id: "albumCover", in: coverNamespace)
            .scaleEffect(isPlaying ? 1.0 : 0.92)
            .animation(.easeOut(duration: 0.45), value: isPlaying)
            .shadow(color: .black.opacity(0.36), radius: 8, y: 4)

            VStack(alignment: .leading, spacing: 3) {
                MarqueeTextView(resetId: "title-\(track?.id ?? 0)-\(track?.titleExtra ?? "")") {
                    HStack(spacing: 4) {
                        Text(track?.name ?? "")
                            .font(.system(size: 15.5, weight: .semibold))
                            .foregroundStyle(Color.white)

                        if let extra = track?.titleExtra, !extra.isEmpty {
                            Text("(\(extra))")
                                .font(.system(size: 13.5))
                                .foregroundStyle(Color.white.opacity(0.50))
                        }
                    }
                }

                MarqueeTextView(resetId: "artist-\(track?.id ?? 0)-\(track?.artistSubtitle ?? "")") {
                    Text(track?.artistSubtitle ?? "")
                        .font(.system(size: 13))
                        .foregroundStyle(Color.white.opacity(0.60))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            HStack(spacing: 0) {
                PlayerIconButton(
                    helpText: "更多控制",
                    highlightedBg: isControlCenterOpen,
                    action: onToggleControlCenter
                ) {
                    ZStack(alignment: .topTrailing) {
                        Image(systemName: "ellipsis")
                            .font(.system(size: 14.5, weight: .semibold))
                            .rotationEffect(.degrees(isControlCenterOpen ? 90 : 0))
                            .animation(.easeOut(duration: 0.2), value: isControlCenterOpen)
                            .frame(width: 20, height: 20)

                        if isMuted {
                            Circle()
                                .fill(Color.orange)
                                .frame(width: 5.5, height: 5.5)
                                .offset(x: 1, y: 1)
                        }
                    }
                }

                PlayerIconButton(helpText: "打开播放器页面", action: onOpenFullPlayer) {
                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                        .font(.system(size: 13, weight: .semibold))
                }
            }
            .offset(x: 4, y: -6)
        }
        .contentShape(Rectangle())
    }
}

// MARK: - 2. 弹性阶梯弹簧多行歌词舞台 + 底部「时刻」导语/热评浮层（1:1 复刻 lyric-player.ts DampedSpring 阶梯波浪弹性滚动）

private struct CompactStageLyricsView: View {
    let store: IslandStore
    let allowWheelScroll: Bool

    var body: some View {
        let indexedLines = store.indexedLines
        let entries = store.stageEntries
        let isMultiVocal = store.lyrics.isMultiVocal
        let springEngine = store.stageSpringEngine

        if store.lyrics.instrumental {
            StagePlaceholderView(icon: "music.quarternote.3", text: "纯音乐，请欣赏")
        } else if store.lyricStatus == "loading" && indexedLines.isEmpty {
            StageLoadingSkeletonView()
        } else if indexedLines.isEmpty {
            StageEmptyRefreshView(
                isPending: store.lyricSourcesPending,
                onRefresh: { store.refreshLyrics() }
            )
        } else {
            GeometryReader { stageGeo in
                let stageH = max(40.0, Double(stageGeo.size.height))
                let stageW = max(100.0, stageGeo.size.width)
                // 读取 wakeRevision 建立细粒度订阅：暂停时滚轮滚动或高度回传也能即时刷新一帧
                let _ = springEngine.wakeRevision
                let paused = !store.isPlaying
                    && !springEngine.isAnimating
                    && !springEngine.isManualScrolling
                    && !store.debrisEngine.hasActiveDebris

                TimelineView(.animation(paused: paused)) { timeline in
                    let nowMs = store.currentPositionMs(at: timeline.date)
                    let tState = store.timelineState(at: nowMs)
                    let spot = store.spotlightState(at: nowMs)
                    let moment = store.activeMoment(at: nowMs)
                    let placedItems = springEngine.stepLayout(
                        entries: entries,
                        lines: store.lyrics.lines,
                        stageHeight: stageH,
                        showRomaji: store.preferences.showRomaji,
                        showTranslation: store.preferences.showTranslation,
                        date: timeline.date,
                        nowMs: nowMs,
                        tState: tState,
                        spot: spot,
                        motion: store.lyrics.motion
                    )

                    ZStack(alignment: .bottom) {
                        ZStack(alignment: .topLeading) {
                            Color.clear

                            ForEach(placedItems) { placed in
                                StagePlacedEntryView(
                                    store: store,
                                    placed: placed,
                                    stageWidth: stageW - 8,
                                    stageHeight: stageGeo.size.height,
                                    isMultiVocal: isMultiVocal,
                                    isManualScrolling: springEngine.isManualScrolling,
                                    nowMs: nowMs
                                )
                            }
                        }
                        .padding(.horizontal, 4)
                        .frame(width: stageGeo.size.width, height: stageGeo.size.height, alignment: .topLeading)
                        .clipped()
                        // 关键防护：.clipped() 仅裁剪视觉绘制不裁剪命中测试；紧跟 .contentShape(Rectangle()) 将子视图 offset 溢出的点击严格限制在舞台矩形内
                        .contentShape(Rectangle())
                        .mask(
                            LinearGradient(
                                stops: [
                                    .init(color: .clear, location: 0.0),
                                    .init(color: .black, location: 0.12),
                                    .init(color: .black, location: 0.86),
                                    .init(color: .clear, location: 1.0)
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )

                        if allowWheelScroll {
                            StageScrollWheelCatcher { dy, isMomentum in
                                springEngine.handleWheel(deltaY: dy, isMomentum: isMomentum)
                            }
                        }

                        if let moment {
                            StageMomentBannerView(moment: moment)
                                .padding(.horizontal, 8)
                                .padding(.bottom, 4)
                                .transition(.opacity)
                        }

                        if store.debrisEngine.hasActiveDebris {
                            Canvas { ctx, _ in
                                store.debrisEngine.stepAndDraw(in: &ctx, date: timeline.date)
                            }
                            .allowsHitTesting(false)
                        }
                    }
                    .animation(.easeInOut(duration: 0.45), value: moment)
                }
            }
            .coordinateSpace(name: "debrisSpace")
            .onChange(of: store.preferences.showRomaji) { _, _ in
                springEngine.invalidateHeights()
            }
            .onChange(of: store.preferences.showTranslation) { _, _ in
                springEngine.invalidateHeights()
            }
        }
    }
}

private struct StagePlacedEntryView: View {
    let store: IslandStore
    let placed: PlacedStageEntry
    let stageWidth: CGFloat
    let stageHeight: CGFloat
    let isMultiVocal: Bool
    let isManualScrolling: Bool
    let nowMs: Double

    var body: some View {
        switch placed.entry {
        case .interlude(_, let range, let align):
            InterludeDotsView(
                range: range,
                rhythm: store.rhythm,
                nowMs: nowMs,
                align: align,
                dotSize: 7.0,
                hdrEnabled: store.config.hdr
            )
            .frame(width: stageWidth, height: 28)
            .opacity(placed.expand)
            .scaleEffect(placed.scale)
            .offset(y: placed.y)
            .allowsHitTesting(false)

        case .footer(_, let text):
            Text(text)
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(.white.opacity(placed.isFocus ? 0.82 : 0.24))
                .frame(width: stageWidth, alignment: .leading)
                .padding(.vertical, 8)
                .padding(.horizontal, 6)
                .onGeometryChange(for: CGFloat.self) { proxy in
                    proxy.size.height
                } action: { h in
                    store.stageSpringEngine.reportHeight(id: placed.id, height: h)
                }
                .offset(y: placed.y)
                .allowsHitTesting(false)

        case .line(let item):
            LyricStageRow(
                store: store,
                item: item,
                placed: placed,
                stageWidth: stageWidth,
                stageHeight: stageHeight,
                isMultiVocal: isMultiVocal,
                isUserScrolling: isManualScrolling,
                nowMs: nowMs,
                songFont: store.lyrics.font,
                wordSynced: store.lyrics.wordSynced,
                showRomaji: store.preferences.showRomaji,
                showTranslation: store.preferences.showTranslation
            ) {
                guard !store.isDraggingCapsule, !store.shouldSuppressTapAfterDrag else { return }
                store.stageSpringEngine.cancelManualScroll()
                store.seek(toMs: item.line.start)
                if !store.isPlaying { store.play() }
            }
        }
    }
}

// MARK: - 展开态加载骨架屏、空状态重试与「时刻」横幅（对齐 MusicLyricStage compact）

private struct StageLoadingSkeletonView: View {
    private static let ratios: [CGFloat] = [0.75, 0.50, 0.66, 0.42]
    @State private var pulse: Bool = false

    var body: some View {
        GeometryReader { geo in
            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array(Self.ratios.enumerated()), id: \.offset) { _, ratio in
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(Color.white.opacity(pulse ? 0.16 : 0.08))
                        .frame(width: max(40, (geo.size.width - 16) * ratio), height: 16)
                }
            }
            .padding(.horizontal, 8)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                pulse = true
            }
        }
    }
}

private struct StageEmptyRefreshView: View {
    let isPending: Bool
    let onRefresh: () -> Void

    @State private var isHovered: Bool = false

    var body: some View {
        VStack(spacing: 10) {
            Text("暂无歌词")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(.white.opacity(0.40))

            Button(action: onRefresh) {
                HStack(spacing: 5) {
                    if isPending {
                        ProgressView()
                            .controlSize(.mini)
                            .tint(.white)
                    } else {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 11, weight: .semibold))
                    }
                    Text("重新获取歌词")
                        .font(.system(size: 11.5, weight: .medium))
                }
                .foregroundStyle(.white.opacity(isHovered ? 0.95 : 0.72))
                .padding(.horizontal, 12)
                .padding(.vertical, 5)
                .background(Color.white.opacity(isHovered ? 0.16 : 0.10), in: Capsule())
            }
            .buttonStyle(.plain)
            .disabled(isPending)
            .onHover { hovering in
                if isHovered != hovering { isHovered = hovering }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct StageMomentBannerView: View {
    let moment: IslandStore.ResolvedMoment

    var body: some View {
        switch moment.kind {
        case .narration:
            Text(moment.text)
                .font(.system(size: 11.5, weight: .medium).italic())
                .foregroundStyle(.white.opacity(0.80))
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .allowsHitTesting(false)

        case .comment(let liked):
            VStack(spacing: 2) {
                Text("「\(moment.text)」")
                    .font(.system(size: 11.5))
                    .foregroundStyle(.white.opacity(0.80))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                if liked > 0 {
                    Text("热评 · \(liked.formatted(.number.notation(.compactName)))")
                        .font(.system(size: 10))
                        .foregroundStyle(.white.opacity(0.45))
                }
            }
            .allowsHitTesting(false)
        }
    }
}

private struct StagePlaceholderView: View {
    let icon: String
    let text: String

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 20))
                .foregroundStyle(.white.opacity(0.38))
            Text(text)
                .font(.system(size: 13))
                .foregroundStyle(.white.opacity(0.48))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct LyricStageRow: View {
    let store: IslandStore
    let item: IndexedLyricLine
    let placed: PlacedStageEntry
    let stageWidth: CGFloat
    let stageHeight: CGFloat
    let isMultiVocal: Bool
    let isUserScrolling: Bool
    let nowMs: Double
    let songFont: String?
    let wordSynced: Bool
    let showRomaji: Bool
    let showTranslation: Bool
    let onSelect: () -> Void

    @State private var isHovered: Bool = false
    @State private var measuredRowHeight: CGFloat = 26

    var body: some View {
        let line = item.line
        let isActive = placed.isActive
        let activeBlend = placed.activeBlend
        let dist = placed.visualDistance
        let hAlign: HorizontalAlignment = line.align == "right" ? .trailing : (line.align == "center" ? .center : .leading)
        let frameAlign: Alignment = line.align == "right" ? .trailing : (line.align == "center" ? .center : .leading)
        let textAlign: TextAlignment = line.align == "right" ? .trailing : (line.align == "center" ? .center : .leading)
        let scaleAnchor: UnitPoint = line.align == "right" ? .trailing : (line.align == "center" ? .center : .leading)
        let mainFontSize: CGFloat = line.isBackground ? 11.9 : 16.5

        let rowSpotLevel = placed.rowSpotLevel
        let globalSpot = placed.globalSpotLevel
        let isSpotted = rowSpotLevel > 0
        let spotDimmed = globalSpot > 0 && !isSpotted && !isActive && dist > 0

        // 句尾若带 shatter / dissolve / glow 余韵，保持动态行视图至余韵结束，杜绝行刚结束时截断碎裂或呼吸尾迹
        let hasActiveTailEffect: Bool = store.preferences.showLyricEffects
            && nowMs >= line.end
            && nowMs < line.end + 1250
            && line.emphasis.contains { $0.effect == "shatter" || $0.effect == "dissolve" || $0.effect == "glow" }
        let useSweepRenderer = isActive || activeBlend > 0.004 || hasActiveTailEffect
        let inactiveDimScale = store.config.hdr ? 0.6 : 1.0

        // 1:1 对齐 lyric-player.ts lineAppearance + 连续模糊阻尼过渡：焦点/激活/悬停/手动滚动及 HDR 退场余晖期完全清晰（0px），避免离屏模糊截断 EDR 高光
        let blurRadius: CGFloat = {
            if isActive || dist == 0 || isHovered || isUserScrolling || (store.config.hdr && useSweepRenderer) { return 0 }
            let baseBlur = placed.isPast ? 3.0 : min(4.0, 1.0 + Double(dist))
            let spotBlur = spotDimmed ? (2.5 * globalSpot) : 0
            return CGFloat(max(baseBlur, spotBlur) * LyricSpecs.compactBlurFactor * placed.blurProgress)
        }()

        let rowDimFactor: Double = spotDimmed ? (1.0 - 0.35 * globalSpot) : 1.0
        let bgAlpha: Double = line.isBackground ? (0.75 * placed.expand) : 1.0
        let slotMaxWidth: CGFloat = isMultiVocal ? (stageWidth * 0.85) : stageWidth

        // 已逐字对齐的音译由行内 .lyric-ruby 在每个音节正下方渲染并同步擦除，不再重复渲染整行音译（对齐 lyric-player.ts 1242）
        let showWholeLineRomaji = showRomaji && line.romanizationWords.isEmpty

        VStack(alignment: hAlign, spacing: 2.5) {
            HStack(alignment: .center, spacing: 5) {
                if let edgeHexes = line.edgeColors, !edgeHexes.isEmpty {
                    let activeEdgeOpacity = (1.0 - 0.5 * rowSpotLevel) * 0.96
                    SingerEdgeBarView(
                        edgeHexes: edgeHexes,
                        fontSize: mainFontSize,
                        isBackground: line.isBackground,
                        opacity: 0.55 + (activeEdgeOpacity - 0.55) * activeBlend
                    )
                }

                if useSweepRenderer {
                    LyricLineSweepView(
                        line: line,
                        lineKeyPrefix: "stage-\(item.id)",
                        songFont: songFont,
                        songMotion: store.lyrics.motion,
                        wordSynced: wordSynced,
                        showEffects: store.preferences.showLyricEffects,
                        showRomaji: showRomaji,
                        hdrEnabled: store.config.hdr,
                        rhythm: store.rhythm,
                        seekAtMs: store.seekAtMs,
                        debrisEngine: store.debrisEngine,
                        nowMs: nowMs,
                        fontSize: mainFontSize,
                        isBackground: line.isBackground,
                        allowsWrapping: true,
                        wrapAlignment: hAlign,
                        spotlightLevel: rowSpotLevel,
                        activeBlend: activeBlend
                    )
                } else {
                    StaticStageLyricLineView(
                        line: line,
                        lineKeyPrefix: "stage-static-\(item.id)",
                        songFont: songFont,
                        wordSynced: wordSynced,
                        showEffects: store.preferences.showLyricEffects,
                        showRomaji: showRomaji,
                        hdrEnabled: store.config.hdr,
                        isUserScrolling: isUserScrolling,
                        fontSize: mainFontSize,
                        wrapAlignment: hAlign
                    )
                }
            }

            if showWholeLineRomaji, let roma = line.romanization, !roma.isEmpty {
                let inactiveRoma = 0.24 * inactiveDimScale
                Text(roma)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.white.opacity(inactiveRoma + (0.65 - inactiveRoma) * activeBlend))
                    .lineLimit(2)
                    .multilineTextAlignment(textAlign)
            }

            if showTranslation, let trans = line.translation, !trans.isEmpty {
                let inactiveTrans = 0.22 * inactiveDimScale
                Text(trans)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.white.opacity(inactiveTrans + (0.52 - inactiveTrans) * activeBlend))
                    .lineLimit(2)
                    .multilineTextAlignment(textAlign)
            }

            if showTranslation, let secTrans = line.secondaryTranslation, !secTrans.isEmpty {
                let inactiveSec = 0.18 * inactiveDimScale
                Text(secTrans)
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(.white.opacity(inactiveSec + (0.42 - inactiveSec) * activeBlend))
                    .lineLimit(2)
                    .multilineTextAlignment(textAlign)
            }
        }
        .padding(.vertical, 3)
        .padding(.horizontal, 6)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color.white.opacity(isHovered ? 0.06 : 0))
        )
        .overlay(alignment: line.align == "right" ? .topTrailing : (line.align == "center" ? .top : .topLeading)) {
            let effectiveSingerName = line.resolvedSingerName(showTranslation: showTranslation)
            if placed.pillOpen > 0.01 && ((effectiveSingerName?.isEmpty == false) || line.singerDotOnly) {
                SingerPillBadgeView(
                    dots: item.singerDots,
                    singerName: effectiveSingerName,
                    dotOnly: line.singerDotOnly
                )
                .opacity(placed.pillOpen)
                .scaleEffect((placed.scale > 1.001 ? (1.0 / placed.scale) : 1.0) * CGFloat(0.92 + 0.08 * placed.pillOpen), anchor: .bottom)
                .offset(y: -17 + CGFloat(1.0 - placed.pillOpen) * 4.0)
                .allowsHitTesting(false)
            }
        }
        .frame(maxWidth: slotMaxWidth, alignment: frameAlign)
        .frame(width: stageWidth, alignment: frameAlign)
        // 先在未缩放坐标系测量正文自然高度回传给弹簧引擎，再施加缩放与弹簧纵向位移
        .onGeometryChange(for: CGFloat.self) { proxy in
            proxy.size.height
        } action: { h in
            if abs(h - measuredRowHeight) > 0.5 {
                measuredRowHeight = h
            }
            store.stageSpringEngine.reportHeight(id: placed.id, height: h)
        }
        .scaleEffect(placed.scale, anchor: scaleAnchor)
        .rotationEffect(.degrees(abs(placed.rotDeg) < 0.02 ? 0 : placed.rotDeg), anchor: scaleAnchor)
        .blur(radius: blurRadius)
        .opacity(bgAlpha * rowDimFactor)
        .contentShape(Rectangle())
        .onHover { hovering in
            if isHovered != hovering {
                isHovered = hovering
            }
        }
        .onTapGesture(perform: onSelect)
        .allowsHitTesting(
            placed.y + max(20, measuredRowHeight) > 4
                && placed.y < stageHeight - 4
                && (!line.isBackground || placed.expand > 0.35)
        )
        .offset(x: abs(placed.x) < 0.02 ? 0 : placed.x, y: placed.y)
    }
}

private struct SingerPillBadgeView: View {
    let dots: [SingerColorDot]
    let singerName: String?
    let dotOnly: Bool

    @ViewBuilder
    private var dotCluster: some View {
        HStack(spacing: -1.8) {
            ForEach(dots) { dot in
                Circle()
                    .fill(Color(cssColor: dot.hex))
                    .frame(width: 6.2, height: 6.2)
                    .overlay {
                        if dots.count > 1 {
                            Circle()
                                .stroke(Color.black.opacity(0.32), lineWidth: 0.8)
                        }
                    }
            }
        }
    }

    var body: some View {
        if dotOnly || (singerName ?? "").isEmpty {
            dotCluster
                .padding(3.5)
                .background(Color.white.opacity(0.14), in: Capsule())
                .overlay(Capsule().strokeBorder(Color.white.opacity(0.10), lineWidth: 0.6))
        } else if let name = singerName {
            HStack(spacing: 4) {
                dotCluster
                Text(name)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.88))
                    .lineLimit(1)
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 1.5)
            .background(Color.white.opacity(0.14), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.10), lineWidth: 0.6))
        }
    }
}

// MARK: - 3. 底部两行纯粹主控栏（1:1 对齐 MusicPageControls compact：第 1 行副歌标记进度条 + 第 2 行经典对称五键）

private struct ExpandedControlsSection: View {
    let store: IslandStore
    let isPlaylistOpen: Bool
    let onTogglePlaylist: () -> Void

    @State private var isPlayHovered: Bool = false

    var body: some View {
        VStack(spacing: 8) {
            // 第 1 行：8pt 圆角进度条（带副歌高光区间标记）+ 双侧等宽数字时间戳
            PlaybackScrubberBar(store: store)

            // 第 2 行：主控五键（播放模式 / 上一首 / 44pt 居中播放圆钮 / 下一首 / 歌单）
            HStack {
                PlayerIconButton(helpText: store.playMode.label, action: { store.cyclePlayMode() }) {
                    Image(systemName: store.playMode.iconName)
                        .font(.system(size: 16, weight: .medium))
                }

                Spacer()

                PlayerIconButton(
                    helpText: "上一首",
                    busy: store.pendingStep == -1,
                    action: { store.prevTrack() }
                ) {
                    Image(systemName: "backward.end.fill")
                        .font(.system(size: 17))
                }

                Spacer()

                Button {
                    store.togglePlay()
                } label: {
                    Image(systemName: store.isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(Color(white: 0.10))
                        .offset(x: store.isPlaying ? 0 : 1)
                        .frame(width: 44, height: 44)
                        .background(Color.white, in: Circle())
                        .shadow(color: .black.opacity(0.28), radius: 8, y: 3)
                        .scaleEffect(isPlayHovered ? 1.05 : 1.0)
                        .animation(.easeOut(duration: 0.16), value: isPlayHovered)
                }
                .buttonStyle(.plain)
                .help(store.isPlaying ? "暂停" : "播放")
                .onHover { hovering in
                    if isPlayHovered != hovering {
                        isPlayHovered = hovering
                    }
                }

                Spacer()

                PlayerIconButton(
                    helpText: "下一首",
                    busy: store.pendingStep == 1,
                    action: { store.nextTrack() }
                ) {
                    Image(systemName: "forward.end.fill")
                        .font(.system(size: 17))
                }

                Spacer()

                PlayerIconButton(
                    helpText: "播放列表",
                    highlightedBg: isPlaylistOpen,
                    action: onTogglePlaylist
                ) {
                    LucideListMusicIcon()
                }
            }
        }
        .background(Color.black.opacity(0.001))
        .contentShape(Rectangle())
    }
}

// MARK: - 1:1 复刻前端 Lucide 24×24 矢量图标（免疫 macOS 中文区域 SF Symbol 本地化为「格式」等问题）

private struct LucideCaseSensitiveIcon: View {
    private static let mainPath = SVGPathParser.parse("M3 15 L7 7 L11 15 M4 13 H10 M21 9 V15")

    var body: some View {
        Canvas { ctx, size in
            let scale = min(size.width, size.height) / 24.0
            var sub = ctx
            sub.scaleBy(x: scale, y: scale)
            let style = StrokeStyle(lineWidth: 2.0, lineCap: .round, lineJoin: .round)
            sub.stroke(Self.mainPath, with: .foreground, style: style)
            sub.stroke(Path(ellipseIn: CGRect(x: 15, y: 9, width: 6, height: 6)), with: .foreground, style: style)
        }
        .frame(width: 19, height: 19)
    }
}

private struct LucideLanguagesIcon: View {
    private static let path = SVGPathParser.parse("m5 8 6 6 m-7 0 6-6 2-3 M2 5 h12 M7 2 h1 m14 20 -5 -10 -5 10 M14 18 h6")

    var body: some View {
        Canvas { ctx, size in
            let scale = min(size.width, size.height) / 24.0
            var sub = ctx
            sub.scaleBy(x: scale, y: scale)
            let style = StrokeStyle(lineWidth: 1.95, lineCap: .round, lineJoin: .round)
            sub.stroke(Self.path, with: .foreground, style: style)
        }
        .frame(width: 18.5, height: 18.5)
    }
}

private struct LucideListMusicIcon: View {
    private static let path = SVGPathParser.parse("M21 15 V6 M18.5 18 a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5 Z M12 12 H3 M16 6 H3 M12 18 H3")

    var body: some View {
        Canvas { ctx, size in
            let scale = min(size.width, size.height) / 24.0
            var sub = ctx
            sub.scaleBy(x: scale, y: scale)
            let style = StrokeStyle(lineWidth: 2.0, lineCap: .round, lineJoin: .round)
            var lines = Path()
            lines.move(to: CGPoint(x: 21, y: 15))
            lines.addLine(to: CGPoint(x: 21, y: 6))
            lines.move(to: CGPoint(x: 16, y: 6))
            lines.addLine(to: CGPoint(x: 3, y: 6))
            lines.move(to: CGPoint(x: 12, y: 12))
            lines.addLine(to: CGPoint(x: 3, y: 12))
            lines.move(to: CGPoint(x: 12, y: 18))
            lines.addLine(to: CGPoint(x: 3, y: 18))
            sub.stroke(lines, with: .foreground, style: style)
            sub.stroke(Path(ellipseIn: CGRect(x: 16, y: 13, width: 5, height: 5)), with: .foreground, style: style)
        }
        .frame(width: 18.5, height: 18.5)
    }
}

// MARK: - 第 1 行进度条（对齐 ProgressRow + ProgressControl：8pt 高圆角槽 + bg-white/35 副歌标记 + 00:55 / 04:16）

private struct ChorusMarkSegment: Identifiable {
    let id: String
    let startRatio: CGFloat
    let widthRatio: CGFloat
}

private struct PlaybackScrubberBar: View {
    let store: IslandStore
    @State private var dragMs: Double? = nil

    var body: some View {
        TimelineView(.animation(minimumInterval: 0.1, paused: !store.isPlaying && dragMs == nil)) { context in
            let totalMs = store.effectiveDurationMs
            let safeTotalMs = max(1, totalMs)
            let currentMs = dragMs ?? store.currentPositionMs(at: context.date)
            let ratio = totalMs > 0 ? max(0, min(1, currentMs / safeTotalMs)) : 0
            let marks: [ChorusMarkSegment] = totalMs > 0
                ? store.chorusRanges.enumerated().map { idx, item in
                    let s = max(0, min(1, item.start / totalMs))
                    let e = max(s, min(1, item.end / totalMs))
                    return ChorusMarkSegment(
                        id: "c-\(idx)-\(Int(item.start))",
                        startRatio: CGFloat(s),
                        widthRatio: CGFloat(e - s)
                    )
                }
                : []

            VStack(spacing: 6) {
                GeometryReader { geo in
                    let w = max(1, geo.size.width)
                    ZStack(alignment: .leading) {
                        Capsule()
                            .fill(Color.white.opacity(0.20))
                            .frame(height: 8)

                        Rectangle()
                            .fill(Color.white)
                            .frame(width: w * ratio, height: 8)

                        ForEach(marks) { mark in
                            Capsule()
                                .fill(Color.white.opacity(0.35))
                                .frame(width: max(3, w * mark.widthRatio), height: 8)
                                .offset(x: w * mark.startRatio)
                        }
                    }
                    .frame(width: w, height: 8, alignment: .leading)
                    .clipShape(Capsule())
                    .frame(maxHeight: .infinity)
                    .contentShape(Rectangle())
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .onChanged { val in
                                guard totalMs > 0 else { return }
                                let p = max(0, min(1, val.location.x / w))
                                dragMs = p * totalMs
                            }
                            .onEnded { val in
                                guard totalMs > 0 else { return }
                                let p = max(0, min(1, val.location.x / w))
                                dragMs = nil
                                store.seek(toMs: p * totalMs)
                            }
                    )
                }
                .frame(height: 16)
                .onGeometryChange(for: CGRect.self) { proxy in
                    proxy.frame(in: .named("panelCanvas"))
                } action: { rect in
                    store.scrubberCanvasRect = rect
                }
                .onDisappear {
                    store.scrubberCanvasRect = .zero
                }

                HStack {
                    Text(Self.formatDurationMMSS(ms: currentMs))
                    Spacer()
                    Text(totalMs > 0 ? Self.formatDurationMMSS(ms: totalMs) : "--:--")
                }
                .font(.system(size: 12, weight: .medium).monospacedDigit())
                .foregroundStyle(.white.opacity(0.60))
            }
        }
    }

    private static func formatDurationMMSS(ms: Double) -> String {
        let total = max(0, Int(floor(ms / 1000.0)))
        return String(format: "%02d:%02d", total / 60, total % 60)
    }
}

// MARK: - 右上角统一「小窗控制中心」浮层（1:1 对齐网页端 MiniPlayerMoreMenu：音量条 + 3×2 短标签开关网格 + 原地展开翻译语种）

private struct ExpandedControlCenterPopover: View {
    private enum PanelPage: Equatable {
        case main
        case languages
    }

    @Bindable var store: IslandStore
    let copied: Bool
    let onCopyLyrics: () -> Void

    @State private var page: PanelPage = .main

    private var volumeSymbol: String {
        if store.isMuted || store.volume <= 0.001 { return "speaker.slash.fill" }
        if store.volume < 0.50 { return "speaker.wave.1.fill" }
        return "speaker.wave.2.fill"
    }

    private var currentLangSummary: String {
        let selections = store.preferences.translationSelections
        guard !selections.isEmpty else { return "跟随站点语言" }
        let items = store.preferences.availableTranslationLangs
        let labels = selections.map { sel in
            items.first(where: { $0.lang == sel.lang })?.label ?? sel.lang
        }
        return labels.joined(separator: " + ")
    }

    var body: some View {
        let prefs = store.preferences
        let items = prefs.availableTranslationLangs
        let selections = prefs.translationSelections
        let volPercent = Int(round((store.isMuted ? 0 : store.volume) * 100))

        Group {
            switch page {
            case .main:
                VStack(alignment: .leading, spacing: 10) {
                    // 1. 音量滑块 + 点喇叭一键静音
                    HStack(spacing: 8) {
                        Button {
                            store.toggleMuted()
                        } label: {
                            Image(systemName: volumeSymbol)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.85))
                                .frame(width: 26, height: 26)
                                .background(Color.white.opacity(store.isMuted ? 0.14 : 0), in: Circle())
                                .contentShape(Circle())
                        }
                        .buttonStyle(.plain)
                        .help(store.isMuted ? "取消静音" : "静音")

                        Slider(value: $store.sliderVolume, in: 0...1)
                            .tint(Color.white)

                        Text("\(volPercent)%")
                            .font(.system(size: 11, weight: .medium).monospacedDigit())
                            .foregroundStyle(Color.white.opacity(0.60))
                            .frame(width: 32, alignment: .trailing)
                    }
                    .padding(.horizontal, 2)

                    Rectangle()
                        .fill(Color.white.opacity(0.10))
                        .frame(height: 1)

                    // 2. 3×2 短标签胶囊开关网格
                    Grid(horizontalSpacing: 6, verticalSpacing: 6) {
                        GridRow {
                            ControlCenterTileButton(
                                label: "翻译",
                                helpText: prefs.translationsGenerating ? "正在翻译歌词…" : (prefs.canToggleTranslation ? "显示翻译" : "暂无额外歌词"),
                                active: prefs.canToggleTranslation && prefs.showTranslation,
                                disabled: !prefs.canToggleTranslation,
                                busy: prefs.translationsGenerating,
                                action: { store.toggleTranslation() }
                            ) {
                                LucideLanguagesIcon()
                                    .scaleEffect(0.86)
                            }

                            ControlCenterTileButton(
                                label: "音译",
                                helpText: prefs.pronunciationsGenerating ? "正在生成读音…" : (prefs.canToggleRomaji ? "显示音译" : "暂无额外歌词"),
                                active: prefs.canToggleRomaji && prefs.showRomaji,
                                disabled: !prefs.canToggleRomaji,
                                busy: prefs.pronunciationsGenerating,
                                action: { store.toggleRomaji() }
                            ) {
                                LucideCaseSensitiveIcon()
                                    .scaleEffect(0.86)
                            }

                            ControlCenterTileButton(
                                label: "歌词特效",
                                helpText: "歌词特效",
                                active: prefs.showLyricEffects,
                                action: { store.toggleEffects() }
                            ) {
                                Image(systemName: "sparkles")
                                    .font(.system(size: 14, weight: .medium))
                            }
                        }

                        GridRow {
                            ControlCenterTileButton(
                                label: "评论与旁白",
                                helpText: "评论与旁白",
                                active: prefs.showLyricMoments,
                                action: { store.toggleMoments() }
                            ) {
                                Image(systemName: "text.bubble")
                                    .font(.system(size: 13.5, weight: .medium))
                            }

                            ControlCenterTileButton(
                                label: "HDR",
                                helpText: "HDR 高光",
                                active: store.config.hdr,
                                action: { store.toggleHdr() }
                            ) {
                                Text("HDR")
                                    .font(.system(size: 9, weight: .heavy, design: .rounded))
                                    .padding(.horizontal, 3)
                                    .padding(.vertical, 1)
                                    .overlay {
                                        RoundedRectangle(cornerRadius: 3, style: .continuous)
                                            .strokeBorder(lineWidth: 1.1)
                                    }
                            }

                            ControlCenterTileButton(
                                label: copied ? "已复制" : "复制歌词",
                                helpText: copied ? "已复制歌词及译文" : "复制歌词",
                                active: copied,
                                action: onCopyLyrics
                            ) {
                                Image(systemName: copied ? "checkmark" : "doc.on.doc")
                                    .font(.system(size: 13.5, weight: .semibold))
                                    .foregroundStyle(copied ? Color.green : Color.white)
                            }
                        }
                    }

                    // 3. 翻译语言原地展开入口
                    if !items.isEmpty {
                        Rectangle()
                            .fill(Color.white.opacity(0.10))
                            .frame(height: 1)

                        ControlCenterLangSummaryRow(summary: currentLangSummary) {
                            withAnimation(.easeOut(duration: 0.18)) {
                                page = .languages
                            }
                        }
                    }
                }

            case .languages:
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Button {
                            withAnimation(.easeOut(duration: 0.18)) {
                                page = .main
                            }
                        } label: {
                            HStack(spacing: 3) {
                                Image(systemName: "chevron.left")
                                    .font(.system(size: 10.5, weight: .semibold))
                                Text("返回")
                                    .font(.system(size: 11.5, weight: .medium))
                            }
                            .foregroundStyle(Color.white.opacity(0.85))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 4)
                            .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)

                        Spacer(minLength: 4)
                    }
                    .padding(.horizontal, 2)

                    let songLangLabel = store.preferences.songLangLabel?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                    Text(songLangLabel.isEmpty ? "可选 2 种语言翻译" : "歌曲语言：\(songLangLabel)，可选 2 种语言翻译")
                        .font(.system(size: 10.5, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.48))
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 6)
                        .padding(.bottom, 2)

                    ScrollView(.vertical, showsIndicators: true) {
                        VStack(alignment: .leading, spacing: 2) {
                            TranslationOptionRow(
                                title: "跟随站点语言",
                                selectionOrder: selections.isEmpty ? 0 : nil,
                                totalSelected: selections.isEmpty ? 1 : selections.count,
                                generating: false
                            ) {
                                store.resetTranslationLangs()
                            }

                            ForEach(items) { item in
                                let hasDual = item.hasAi && item.hasNative
                                if hasDual {
                                    let aiIdx = selections.firstIndex(where: { $0.lang == item.lang && !$0.preferNative })
                                    TranslationOptionRow(
                                        title: "\(item.label) · AI",
                                        selectionOrder: aiIdx,
                                        totalSelected: selections.count,
                                        generating: item.generating
                                    ) {
                                        store.toggleTranslationLang(lang: item.lang, preferNative: false, hasDualSources: true)
                                    }

                                    let nativeIdx = selections.firstIndex(where: { $0.lang == item.lang && $0.preferNative })
                                    TranslationOptionRow(
                                        title: "\(item.label) · 原版",
                                        selectionOrder: nativeIdx,
                                        totalSelected: selections.count,
                                        generating: false
                                    ) {
                                        store.toggleTranslationLang(lang: item.lang, preferNative: true, hasDualSources: true)
                                    }
                                } else {
                                    let preferNative = item.hasNative && !item.hasAi
                                    let selIdx = selections.firstIndex(where: { $0.lang == item.lang })
                                    TranslationOptionRow(
                                        title: item.label,
                                        selectionOrder: selIdx,
                                        totalSelected: selections.count,
                                        generating: item.generating
                                    ) {
                                        store.toggleTranslationLang(lang: item.lang, preferNative: preferNative, hasDualSources: false)
                                    }
                                }
                            }
                        }
                    }
                    .frame(maxHeight: 196)
                }
            }
        }
        .padding(10)
        .frame(width: 244)
        .background(
            Color(white: 0.06).opacity(0.96),
            in: RoundedRectangle(cornerRadius: 16, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(Color.white.opacity(0.14), lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.55), radius: 20, y: 8)
        .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

private struct ControlCenterTileButton<IconContent: View>: View {
    let label: String
    let helpText: String
    var active: Bool = false
    var disabled: Bool = false
    var busy: Bool = false
    let action: () -> Void
    @ViewBuilder let icon: () -> IconContent

    @State private var isHovered: Bool = false

    var body: some View {
        let fgOpacity: Double = {
            if disabled { return 0.28 }
            if active { return 1.0 }
            return isHovered ? 0.92 : 0.62
        }()

        Button(action: action) {
            VStack(spacing: 4) {
                ZStack {
                    if busy {
                        ProgressView()
                            .controlSize(.mini)
                            .tint(Color.white)
                    } else {
                        icon()
                            .foregroundStyle(Color.white.opacity(fgOpacity))
                    }
                }
                .frame(height: 17)

                Text(label)
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(Color.white.opacity(fgOpacity))
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 7)
            .padding(.horizontal, 4)
            .background(
                Color.white.opacity(active ? 0.16 : (isHovered && !disabled ? 0.11 : 0.06)),
                in: RoundedRectangle(cornerRadius: 11, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .strokeBorder(Color.white.opacity(active ? 0.20 : 0), lineWidth: 1)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .help(helpText)
        .onHover { hovering in
            if isHovered != hovering {
                isHovered = hovering
            }
        }
    }
}

private struct ControlCenterLangSummaryRow: View {
    let summary: String
    let action: () -> Void

    @State private var isHovered: Bool = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: "globe")
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.72))

                Text("翻译语言")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.88))

                Spacer(minLength: 4)

                Text(summary)
                    .font(.system(size: 11))
                    .foregroundStyle(Color.white.opacity(0.50))
                    .lineLimit(1)

                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.45))
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(
                Color.white.opacity(isHovered ? 0.10 : 0),
                in: RoundedRectangle(cornerRadius: 10, style: .continuous)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            if isHovered != hovering {
                isHovered = hovering
            }
        }
    }
}

private struct TranslationOptionRow: View {
    let title: String
    let selectionOrder: Int?
    let totalSelected: Int
    let generating: Bool
    let action: () -> Void

    @State private var isHovered: Bool = false

    var body: some View {
        let isSelected = selectionOrder != nil
        Button(action: action) {
            HStack(spacing: 8) {
                if let order = selectionOrder, totalSelected > 1 {
                    Text("\(order + 1)")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(Color.black)
                        .frame(width: 14, height: 14)
                        .background(Color.white, in: Circle())
                } else {
                    Image(systemName: "checkmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Color.white.opacity(isSelected ? 1.0 : 0))
                        .frame(width: 14, height: 14)
                }

                Text(title)
                    .font(.system(size: 12, weight: isSelected ? .medium : .regular))
                    .foregroundStyle(Color.white.opacity(isSelected ? 1.0 : 0.80))
                    .lineLimit(1)

                Spacer(minLength: 4)

                if generating {
                    ProgressView()
                        .controlSize(.mini)
                        .tint(Color.white)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                Color.white.opacity(isSelected || isHovered ? 0.10 : 0),
                in: RoundedRectangle(cornerRadius: 10, style: .continuous)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            if isHovered != hovering {
                isHovered = hovering
            }
        }
    }
}

// MARK: - 内嵌式歌单队列舞台（1:1 对齐 MusicMiniPlaylist & MusicPlaylistItem：封面缩略图、别名、权重检索与输入法焦点）

private struct ExpandedPlaylistQueueSection: View {
    let store: IslandStore
    let onDismiss: () -> Void

    @State private var query: String = ""
    @State private var filteredTracks: [PlaylistTrackItem] = []
    @State private var scrollRequestToken: Int = 0
    @FocusState private var isSearchFocused: Bool

    private var activeTrackIndex: Int? {
        if let idx = store.currentIndex, store.playlist.indices.contains(idx) {
            return idx
        }
        if let curId = store.track?.id {
            return store.playlist.first(where: { $0.id == curId })?.index
        }
        return nil
    }

    private var headerTitle: String {
        guard store.playlistComplete else { return "播放列表" }
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return "播放列表 · \(store.playlist.count) 首"
        }
        return "找到 \(filteredTracks.count) / \(store.playlist.count) 首"
    }

    var body: some View {
        let curIdx = activeTrackIndex
        let curId = store.track?.id
        let isPlaying = store.isPlaying
        let accent = store.accentColor

        VStack(alignment: .leading, spacing: 8) {
            // 1. 顶部标题栏 + 定位当前曲目 + 收起按钮
            HStack(spacing: 6) {
                Text(headerTitle)
                    .font(.system(size: 12, weight: .semibold).monospacedDigit())
                    .foregroundStyle(Color.white.opacity(0.76))
                    .lineLimit(1)

                Spacer(minLength: 4)

                if store.playlistComplete && curIdx != nil {
                    PlaylistSmallIconButton(helpText: "定位当前播放曲目", systemImage: "scope") {
                        if !query.isEmpty {
                            query = ""
                        }
                        scrollRequestToken &+= 1
                    }
                }

                PlaylistSmallIconButton(helpText: "返回歌词", systemImage: "xmark", action: onDismiss)
            }
            .padding(.horizontal, 2)

            // 2. 搜索输入框（支持中英日输入法、⌘A/C/V/X、回车即播首条、Esc 清空或关闭）
            HStack(spacing: 7) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color.white.opacity(isSearchFocused ? 0.85 : 0.50))

                TextField(
                    "",
                    text: $query,
                    prompt: Text("搜索歌名、别名、歌手或专辑…")
                        .foregroundStyle(Color.white.opacity(0.42))
                )
                .textFieldStyle(.plain)
                .focusEffectDisabled()
                .focused($isSearchFocused)
                .font(.system(size: 12.5))
                .foregroundStyle(Color.white)
                .tint(Color.white)
                .disabled(!store.playlistComplete)
                .onSubmit {
                    if let first = filteredTracks.first {
                        store.playTrack(at: first.index)
                    }
                }
                .onExitCommand {
                    if !query.isEmpty {
                        query = ""
                    } else {
                        onDismiss()
                    }
                }

                if !query.isEmpty {
                    Button {
                        query = ""
                        focusSearchField()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 12))
                            .foregroundStyle(Color.white.opacity(0.55))
                    }
                    .buttonStyle(.plain)
                    .help("清空搜索词")
                }
            }
            .padding(.horizontal, 10)
            .frame(height: 30)
            .background(
                Color.white.opacity(isSearchFocused ? 0.13 : 0.08),
                in: RoundedRectangle(cornerRadius: 9, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .strokeBorder(
                        Color.white.opacity(isSearchFocused ? 0.36 : 0.14),
                        lineWidth: 1
                    )
            }
            .contentShape(Rectangle())
            .simultaneousGesture(
                TapGesture().onEnded {
                    if store.playlistComplete {
                        focusSearchField()
                    }
                }
            )

            // 3. 列表主体（加载骨架屏 / 空状态 / 虚拟化曲目列表）
            if !store.playlistComplete {
                PlaylistPendingSkeletonView {
                    store.requestFullPlaylistIfNeeded()
                }
            } else if filteredTracks.isEmpty {
                PlaylistEmptyStateView(
                    hasQuery: !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ) {
                    query = ""
                    focusSearchField()
                }
            } else {
                ScrollViewReader { proxy in
                    ScrollView(.vertical, showsIndicators: true) {
                        LazyVStack(spacing: 3) {
                            ForEach(filteredTracks, id: \.index) { item in
                                PlaylistTrackRow(
                                    item: item,
                                    isCurrent: (curIdx != nil ? item.index == curIdx : item.id == curId),
                                    isPlaying: isPlaying,
                                    accentColor: accent
                                ) {
                                    store.playTrack(at: item.index)
                                }
                                .id(item.index)
                            }
                        }
                        .padding(.trailing, 2)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .onAppear {
                        scrollToActiveTrack(using: proxy, animated: false)
                    }
                    .onChange(of: scrollRequestToken) { _, _ in
                        DispatchQueue.main.async {
                            scrollToActiveTrack(using: proxy, animated: true)
                        }
                    }
                }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(
            Color.black.opacity(0.36),
            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(Color.white.opacity(0.11), lineWidth: 1)
        }
        .onAppear {
            rebuildFilteredTracks()
            store.requestFullPlaylistIfNeeded()
            focusSearchField()
        }
        .onChange(of: query) { _, _ in
            rebuildFilteredTracks()
        }
        .onChange(of: store.playlist) { _, _ in
            rebuildFilteredTracks()
        }
        .onChange(of: store.playlistComplete) { _, complete in
            if complete {
                rebuildFilteredTracks()
                focusSearchField()
                scrollRequestToken &+= 1
            }
        }
    }

    private func focusSearchField() {
        store.requestKeyFocus()
        DispatchQueue.main.async {
            if store.playlistComplete {
                isSearchFocused = true
            }
        }
    }

    private func scrollToActiveTrack(using proxy: ScrollViewProxy, animated: Bool) {
        guard let target = activeTrackIndex,
              filteredTracks.contains(where: { $0.index == target }) else { return }
        if animated {
            withAnimation(.easeOut(duration: 0.22)) {
                proxy.scrollTo(target, anchor: .center)
            }
        } else {
            DispatchQueue.main.async {
                proxy.scrollTo(target, anchor: .center)
            }
        }
    }

    private func rebuildFilteredTracks() {
        filteredTracks = PlaylistSearchFilter.filter(store.playlist, query: query)
    }
}

private struct PlaylistSmallIconButton: View {
    let helpText: String
    let systemImage: String
    let action: () -> Void

    @State private var isHovered: Bool = false

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.white.opacity(isHovered ? 0.95 : 0.58))
                .frame(width: 22, height: 22)
                .background(
                    Color.white.opacity(isHovered ? 0.14 : 0.05),
                    in: Circle()
                )
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .help(helpText)
        .onHover { hovering in
            if isHovered != hovering {
                isHovered = hovering
            }
        }
    }
}

private struct PlaylistPendingSkeletonView: View {
    let onRetry: () -> Void
    @State private var pulse: Bool = false
    @State private var showRetryHint: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(0..<4, id: \.self) { row in
                HStack(spacing: 10) {
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .fill(Color.white.opacity(pulse ? 0.15 : 0.08))
                        .frame(width: 36, height: 36)

                    VStack(alignment: .leading, spacing: 6) {
                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .fill(Color.white.opacity(pulse ? 0.16 : 0.09))
                            .frame(width: row.isMultiple(of: 2) ? 156 : 124, height: 11)

                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .fill(Color.white.opacity(pulse ? 0.12 : 0.06))
                            .frame(width: row.isMultiple(of: 2) ? 98 : 82, height: 9)
                    }

                    Spacer()
                }
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
            }

            if showRetryHint {
                HStack {
                    Spacer()
                    Button("重新加载歌单", action: onRetry)
                        .buttonStyle(.plain)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.82))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(Color.white.opacity(0.12), in: Capsule())
                    Spacer()
                }
                .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .onAppear {
            withAnimation(.easeInOut(duration: 0.85).repeatForever(autoreverses: true)) {
                pulse = true
            }
        }
        .task {
            try? await Task.sleep(for: .seconds(4))
            if !Task.isCancelled {
                showRetryHint = true
            }
        }
    }
}

private struct PlaylistEmptyStateView: View {
    let hasQuery: Bool
    let onClearQuery: () -> Void

    @State private var isHovered: Bool = false

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: hasQuery ? "magnifyingglass" : "music.note.list")
                .font(.system(size: 18))
                .foregroundStyle(Color.white.opacity(0.35))

            Text(hasQuery ? "未找到匹配的曲目" : "歌单暂无曲目")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.56))

            if hasQuery {
                Button(action: onClearQuery) {
                    Text("清空搜索条件")
                        .font(.system(size: 11.5, weight: .medium))
                        .foregroundStyle(Color.white.opacity(isHovered ? 0.95 : 0.78))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 4.5)
                        .background(Color.white.opacity(isHovered ? 0.16 : 0.10), in: Capsule())
                }
                .buttonStyle(.plain)
                .onHover { hovering in
                    if isHovered != hovering {
                        isHovered = hovering
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// 遵循 swiftui-expert-skill：单根节点（unary Button）、只接收纯值参数，隔绝 60Hz 播放时钟重绘
private struct PlaylistTrackRow: View {
    let item: PlaylistTrackItem
    let isCurrent: Bool
    let isPlaying: Bool
    let accentColor: Color
    let onSelect: () -> Void

    @State private var isHovered: Bool = false

    private var titleText: AttributedString {
        var main = AttributedString(item.name)
        main.foregroundColor = isCurrent ? Color.white : Color.white.opacity(0.90)
        main.font = .system(size: 12.5, weight: isCurrent ? .semibold : .medium)

        if let extra = item.resolvedTitleExtra, !extra.isEmpty {
            var alias = AttributedString(" (\(extra))")
            alias.foregroundColor = Color.white.opacity(isCurrent ? 0.56 : 0.44)
            alias.font = .system(size: 11.5, weight: .regular)
            main.append(alias)
        }
        return main
    }

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 9) {
                ZStack {
                    CachedPlaylistCoverThumb(
                        urlString: item.albumPic,
                        size: 36,
                        cornerRadius: 7,
                        accent: accentColor
                    )

                    if isCurrent {
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .fill(Color.black.opacity(0.46))
                            .frame(width: 36, height: 36)

                        PlaylistEqualizerBadge(isPlaying: isPlaying)
                    }
                }
                .frame(width: 36, height: 36)

                VStack(alignment: .leading, spacing: 2) {
                    Text(titleText)
                        .lineLimit(1)
                        .truncationMode(.tail)

                    if !item.subtitle.isEmpty {
                        Text(item.subtitle)
                            .font(.system(size: 11))
                            .foregroundStyle(Color.white.opacity(isCurrent ? 0.68 : 0.50))
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                if let dur = item.formattedDuration {
                    Text(dur)
                        .font(.system(size: 11, weight: isCurrent ? .medium : .regular).monospacedDigit())
                        .foregroundStyle(Color.white.opacity(isCurrent ? 0.82 : 0.38))
                }
            }
            .padding(.horizontal, 7)
            .padding(.vertical, 5)
            .background(
                Color.white.opacity(isCurrent ? 0.13 : (isHovered ? 0.08 : 0)),
                in: RoundedRectangle(cornerRadius: 9, style: .continuous)
            )
            .overlay(alignment: .leading) {
                if isCurrent {
                    Capsule()
                        .fill(accentColor)
                        .frame(width: 2.5, height: 18)
                        .offset(x: 1.5)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            if isHovered != hovering {
                isHovered = hovering
            }
        }
    }
}

private struct PlaylistEqualizerBadge: View {
    let isPlaying: Bool

    var body: some View {
        TimelineView(.animation(minimumInterval: 0.08, paused: !isPlaying)) { context in
            let now = context.date.timeIntervalSinceReferenceDate
            HStack(alignment: .bottom, spacing: 2) {
                Capsule()
                    .fill(Color.white)
                    .frame(width: 2.4, height: Self.barHeight(index: 0, isPlaying: isPlaying, time: now))
                Capsule()
                    .fill(Color.white)
                    .frame(width: 2.4, height: Self.barHeight(index: 1, isPlaying: isPlaying, time: now))
                Capsule()
                    .fill(Color.white)
                    .frame(width: 2.4, height: Self.barHeight(index: 2, isPlaying: isPlaying, time: now))
            }
            .frame(width: 14, height: 14, alignment: .bottom)
        }
    }

    private static func barHeight(index: Int, isPlaying: Bool, time: TimeInterval) -> CGFloat {
        let ratio: Double
        if isPlaying {
            let speed = 5.2 + Double(index) * 1.35
            let phase = Double(index) * 1.4
            let wave = 0.5 + 0.5 * sin(time * speed + phase)
            ratio = 0.35 + 0.65 * wave
        } else {
            ratio = (index == 1) ? 0.55 : 0.32
        }
        return max(3.5, CGFloat(13.0 * ratio))
    }
}

// MARK: - 歌单封面内存缩略图缓存（后台 ImageIO 降采样解码 + NSCache 同步命中，杜绝 LazyVStack 复用闪烁）

private struct SendableCGThumbnail: @unchecked Sendable {
    let cgImage: CGImage
}

@MainActor
private final class PlaylistCoverMemoryCache {
    static let shared = PlaylistCoverMemoryCache()

    private let cache: NSCache<NSString, NSImage> = {
        let c = NSCache<NSString, NSImage>()
        c.countLimit = 320
        return c
    }()

    func image(for key: String) -> NSImage? {
        cache.object(forKey: key as NSString)
    }

    func insert(_ image: NSImage, for key: String) {
        cache.setObject(image, forKey: key as NSString)
    }
}

private struct CachedPlaylistCoverThumb: View {
    let urlString: String?
    let size: CGFloat
    let cornerRadius: CGFloat
    let accent: Color

    @Environment(\.displayScale) private var displayScale
    @State private var loadedImage: NSImage? = nil

    var body: some View {
        let cached = urlString.flatMap { PlaylistCoverMemoryCache.shared.image(for: $0) } ?? loadedImage

        ZStack {
            LinearGradient(
                colors: [accent.opacity(0.45), Color(white: 0.14)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            if let nsImage = cached {
                Image(nsImage: nsImage)
                    .resizable()
                    .scaledToFill()
            } else {
                Image(systemName: "music.note")
                    .font(.system(size: size * 0.40, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.48))
            }

            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .strokeBorder(Color.white.opacity(0.14), lineWidth: 0.7)
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        .task(id: urlString) {
            guard let key = urlString, !key.isEmpty else {
                loadedImage = nil
                return
            }
            if let hit = PlaylistCoverMemoryCache.shared.image(for: key) {
                if loadedImage !== hit {
                    loadedImage = hit
                }
                return
            }
            guard let url = URL(string: key) else { return }
            let targetPixelSize = max(72, Int(ceil(size * max(1.0, displayScale) * 1.5)))
            if let thumb = await Self.fetchAndDownsample(url: url, maxPixelSize: targetPixelSize) {
                guard !Task.isCancelled else { return }
                let nsImage = NSImage(
                    cgImage: thumb.cgImage,
                    size: NSSize(width: thumb.cgImage.width, height: thumb.cgImage.height)
                )
                PlaylistCoverMemoryCache.shared.insert(nsImage, for: key)
                loadedImage = nsImage
            }
        }
    }

    private nonisolated static func fetchAndDownsample(url: URL, maxPixelSize: Int) async -> SendableCGThumbnail? {
        let req = URLRequest(url: url, cachePolicy: .returnCacheDataElseLoad, timeoutInterval: 12)
        guard let (data, response) = try? await URLSession.shared.data(for: req),
              let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode),
              !data.isEmpty else {
            return nil
        }

        let sourceOptions: [CFString: Any] = [kCGImageSourceShouldCache: false]
        guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions as CFDictionary) else {
            return nil
        }

        let downsampleOptions: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize
        ]
        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, downsampleOptions as CFDictionary) else {
            return nil
        }
        return SendableCGThumbnail(cgImage: cgImage)
    }
}
