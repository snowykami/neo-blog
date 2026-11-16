import SwiftUI

/// 展开后的迷你播放器面板（遵循 swiftui-expert-skill：按职责拆分为顶栏、舞台、三行控制栏与浮层菜单独立子视图边界）
///
/// 【双端同步维护约定】对应网页端 `web/src/components/common/mini-player.tsx` 与 `music-page-controls.tsx` (compact)；
/// 新增展开态交互、控件或舞台特性时双端必须同步实现。
struct ExpandedPlayerView: View {
    private enum FloatingMenuKind: Equatable {
        case none
        case playlist
        case translationLang
        case moreControls
        case volumeSlider
    }

    let store: IslandStore
    let topReservedHeight: CGFloat
    let coverNamespace: Namespace.ID

    @State private var activeMenu: FloatingMenuKind = .none
    @State private var copiedFeedback: Bool = false

    var body: some View {
        ZStack(alignment: .bottom) {
            VStack(spacing: 12) {
                if topReservedHeight > 0 {
                    Spacer().frame(height: topReservedHeight)
                }

                ExpandedHeaderSection(
                    track: store.track,
                    accentColor: store.accentColor,
                    isPlaying: store.isPlaying,
                    coverNamespace: coverNamespace,
                    onOpenFullPlayer: { store.openBlogPlayerPage() }
                )

                CompactStageLyricsView(
                    store: store,
                    allowWheelScroll: activeMenu == .none
                )
                .frame(height: 176)

                ExpandedControlsSection(
                    store: store,
                    isPlaylistOpen: activeMenu == .playlist,
                    isLangMenuOpen: activeMenu == .translationLang,
                    isMoreMenuOpen: activeMenu == .moreControls,
                    isVolumeSliderOpen: activeMenu == .volumeSlider,
                    onTogglePlaylist: { toggleMenu(.playlist) },
                    onToggleLangMenu: { toggleMenu(.translationLang) },
                    onToggleMoreMenu: { toggleMenu(.moreControls) },
                    onToggleVolumeSlider: { toggleMenu(.volumeSlider) }
                )
            }
            .frame(width: 328)
            .padding(.horizontal, 16)
            .padding(.top, topReservedHeight > 0 ? 4 : 16)
            .padding(.bottom, 16)

            // 浮层菜单锚定在底部控制栏上方（1:1 对齐网页端 MiniPlayer 内 TranslationLanguageMenu / MoreControlsMenu / MusicMiniPlaylist）
            if activeMenu != .none {
                Color.black.opacity(0.001)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        withAnimation(.spring(duration: 0.24, bounce: 0.12)) {
                            activeMenu = .none
                        }
                    }

                Group {
                    switch activeMenu {
                    case .playlist:
                        MiniPlaylistPopoverCard(store: store) {
                            withAnimation(.spring(duration: 0.24, bounce: 0.12)) {
                                activeMenu = .none
                            }
                        }
                        .padding(.horizontal, 14)
                        .padding(.bottom, 102)

                    case .translationLang:
                        TranslationLanguagePopoverCard(store: store)
                            .padding(.trailing, 16)
                            .padding(.bottom, 54)
                            .frame(maxWidth: .infinity, alignment: .trailing)

                    case .moreControls:
                        MoreControlsFloatingPill(
                            copied: copiedFeedback,
                            showLyricMoments: store.preferences.showLyricMoments,
                            showLyricEffects: store.preferences.showLyricEffects,
                            hdrEnabled: store.config.hdr,
                            onCopyLyrics: {
                                if store.copyFormattedLyricsToPasteboard() {
                                    copiedFeedback = true
                                    DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                                        copiedFeedback = false
                                    }
                                }
                            },
                            onToggleMoments: { store.toggleMoments() },
                            onToggleEffects: { store.toggleEffects() },
                            onToggleHdr: { store.toggleHdr() }
                        )
                        .padding(.trailing, 16)
                        .padding(.bottom, 54)
                        .frame(maxWidth: .infinity, alignment: .trailing)

                    case .volumeSlider:
                        VolumeSliderFloatingPill(store: store)
                            .padding(.leading, 16)
                            .padding(.bottom, 54)
                            .frame(maxWidth: .infinity, alignment: .leading)

                    case .none:
                        EmptyView()
                    }
                }
                .transition(.opacity.combined(with: .scale(scale: 0.90, anchor: .bottom)))
            }
        }
        .frame(width: 360)
        .clipped()
    }

    private func toggleMenu(_ target: FloatingMenuKind) {
        withAnimation(.spring(duration: 0.28, bounce: 0.18)) {
            activeMenu = (activeMenu == target) ? .none : target
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

// MARK: - 1. 顶栏（对齐 mini-player.tsx 79-110：56pt 圆角封面 + 标题/别名 + 歌手·专辑 + 右上角打开完整播放器页）

private struct ExpandedHeaderSection: View {
    let track: IslandTrack?
    let accentColor: Color
    let isPlaying: Bool
    let coverNamespace: Namespace.ID
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
                            .foregroundStyle(.white)

                        if let extra = track?.titleExtra, !extra.isEmpty {
                            Text("(\(extra))")
                                .font(.system(size: 13.5))
                                .foregroundStyle(.white.opacity(0.50))
                        }
                    }
                }

                MarqueeTextView(resetId: "artist-\(track?.id ?? 0)-\(track?.artistSubtitle ?? "")") {
                    Text(track?.artistSubtitle ?? "")
                        .font(.system(size: 13))
                        .foregroundStyle(.white.opacity(0.60))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            PlayerIconButton(helpText: "打开播放器页面", action: onOpenFullPlayer) {
                Image(systemName: "arrow.up.left.and.arrow.down.right")
                    .font(.system(size: 13, weight: .semibold))
            }
            .offset(x: 4, y: -4)
        }
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
                        spot: spot
                    )

                    ZStack(alignment: .bottom) {
                        ZStack(alignment: .topLeading) {
                            Color.clear

                            ForEach(placedItems) { placed in
                                StagePlacedEntryView(
                                    store: store,
                                    placed: placed,
                                    stageWidth: stageW - 8,
                                    isMultiVocal: isMultiVocal,
                                    isManualScrolling: springEngine.isManualScrolling,
                                    nowMs: nowMs
                                )
                            }
                        }
                        .padding(.horizontal, 4)
                        .frame(width: stageGeo.size.width, height: stageGeo.size.height, alignment: .topLeading)
                        .clipped()
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

        case .line(let item):
            LyricStageRow(
                store: store,
                item: item,
                placed: placed,
                stageWidth: stageWidth,
                isMultiVocal: isMultiVocal,
                isUserScrolling: isManualScrolling,
                nowMs: nowMs,
                songFont: store.lyrics.font,
                wordSynced: store.lyrics.wordSynced,
                showRomaji: store.preferences.showRomaji,
                showTranslation: store.preferences.showTranslation
            ) {
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
    let isMultiVocal: Bool
    let isUserScrolling: Bool
    let nowMs: Double
    let songFont: String?
    let wordSynced: Bool
    let showRomaji: Bool
    let showTranslation: Bool
    let onSelect: () -> Void

    @State private var isHovered: Bool = false

    var body: some View {
        let line = item.line
        let isActive = placed.isActive
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

        // 1:1 对齐 lyric-player.ts lineAppearance：焦点/激活/悬停/手动滚动行完全清晰（0px），过去行温和模糊，聚光灯下其余行额外压暗变虚
        let blurRadius: CGFloat = {
            if isActive || dist == 0 || isHovered || isUserScrolling { return 0 }
            let baseBlur = placed.isPast ? 3.0 : min(4.0, 1.0 + Double(dist))
            let spotBlur = spotDimmed ? (2.5 * globalSpot) : 0
            return CGFloat(max(baseBlur, spotBlur) * LyricSpecs.compactBlurFactor)
        }()

        let rowDimFactor: Double = spotDimmed ? (1.0 - 0.35 * globalSpot) : 1.0
        let bgAlpha: Double = line.isBackground ? (0.75 * placed.expand) : 1.0
        let slotMaxWidth: CGFloat = isMultiVocal ? (stageWidth * 0.85) : stageWidth

        // 已逐字对齐的音译由行内 .lyric-ruby 在每个音节正下方渲染并同步擦除，不再重复渲染整行音译（对齐 lyric-player.ts 1242）
        let showWholeLineRomaji = showRomaji && line.romanizationWords.isEmpty

        VStack(alignment: hAlign, spacing: 2.5) {
            HStack(alignment: .center, spacing: 5) {
                if let edgeHexes = line.edgeColors, !edgeHexes.isEmpty {
                    SingerEdgeBarView(
                        edgeHexes: edgeHexes,
                        fontSize: mainFontSize,
                        isBackground: line.isBackground,
                        opacity: isActive ? (1.0 - 0.5 * rowSpotLevel) * 0.96 : 0.55
                    )
                }

                if isActive {
                    LyricLineSweepView(
                        line: line,
                        lineKeyPrefix: "stage-\(item.id)",
                        songFont: songFont,
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
                        hdrSpotBoost: store.config.hdr && rowSpotLevel >= 0.5
                    )
                } else {
                    StaticStageLyricLineView(
                        line: line,
                        lineKeyPrefix: "stage-static-\(item.id)",
                        songFont: songFont,
                        wordSynced: wordSynced,
                        showRomaji: showRomaji,
                        fontSize: mainFontSize,
                        wrapAlignment: hAlign
                    )
                }
            }

            if showWholeLineRomaji, let roma = line.romanization, !roma.isEmpty {
                Text(roma)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.white.opacity(isActive ? 0.65 : 0.24))
                    .lineLimit(2)
                    .multilineTextAlignment(textAlign)
            }

            if showTranslation, let trans = line.translation, !trans.isEmpty {
                Text(trans)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.white.opacity(isActive ? 0.52 : 0.22))
                    .lineLimit(2)
                    .multilineTextAlignment(textAlign)
            }

            if showTranslation, let secTrans = line.secondaryTranslation, !secTrans.isEmpty {
                Text(secTrans)
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(.white.opacity(isActive ? 0.42 : 0.18))
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
            if placed.isSingerPillVisible {
                SingerPillBadgeView(
                    dots: item.singerDots,
                    singerName: line.singerName,
                    dotOnly: line.singerDotOnly
                )
                .scaleEffect(placed.scale > 1.001 ? (1.0 / placed.scale) : 1.0, anchor: .bottom)
                .offset(y: -17)
                .transition(.opacity)
                .allowsHitTesting(false)
            }
        }
        .frame(maxWidth: slotMaxWidth, alignment: frameAlign)
        .frame(width: stageWidth, alignment: frameAlign)
        // 先在未缩放坐标系测量正文自然高度回传给弹簧引擎，再施加缩放与弹簧纵向位移
        .onGeometryChange(for: CGFloat.self) { proxy in
            proxy.size.height
        } action: { h in
            store.stageSpringEngine.reportHeight(id: placed.id, height: h)
        }
        .scaleEffect(placed.scale, anchor: scaleAnchor)
        .blur(radius: blurRadius)
        .opacity(bgAlpha * rowDimFactor)
        .contentShape(Rectangle())
        .onHover { hovering in
            if isHovered != hovering {
                isHovered = hovering
            }
        }
        .onTapGesture(perform: onSelect)
        .offset(y: placed.y)
    }
}

private struct SingerPillBadgeView: View {
    let dots: [SingerColorDot]
    let singerName: String?
    let dotOnly: Bool

    var body: some View {
        if dotOnly || (singerName ?? "").isEmpty {
            HStack(spacing: -2) {
                ForEach(dots) { dot in
                    Circle()
                        .fill(Color(cssColor: dot.hex))
                        .frame(width: 6, height: 6)
                }
            }
            .padding(3.5)
            .background(Color.white.opacity(0.14), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.10), lineWidth: 0.6))
        } else if let name = singerName {
            HStack(spacing: 4) {
                HStack(spacing: -2) {
                    ForEach(dots) { dot in
                        Circle()
                            .fill(Color(cssColor: dot.hex))
                            .frame(width: 6, height: 6)
                    }
                }
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

// MARK: - 3. 底部三行控制栏（1:1 对齐 MusicPageControls compact：第 1 行副歌标记进度条 + 第 2 行主控五键 + 第 3 行静音与四颗次级图标按钮）

private struct ExpandedControlsSection: View {
    let store: IslandStore
    let isPlaylistOpen: Bool
    let isLangMenuOpen: Bool
    let isMoreMenuOpen: Bool
    let isVolumeSliderOpen: Bool
    let onTogglePlaylist: () -> Void
    let onToggleLangMenu: () -> Void
    let onToggleMoreMenu: () -> Void
    let onToggleVolumeSlider: () -> Void

    @State private var isPlayHovered: Bool = false

    var body: some View {
        let prefs = store.preferences
        let canOpenLangMenu = !prefs.availableTranslationLangs.isEmpty

        VStack(spacing: 8) {
            // 第 1 行：8pt 圆角进度条（带副歌高光区间标记）+ 双侧等宽数字时间戳
            PlaybackScrubberBar(store: store)

            // 第 2 行：主控五键（播放模式 / 上一首 / 44pt 居中播放圆钮 / 下一首 / 歌单浮层）
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

            // 第 3 行：左侧静音按钮（右键可调音量滑块）+ 右侧四颗次要图标按钮（翻译语言 / 译文开关 / 读音开关 / 更多三点菜单）
            HStack(spacing: 8) {
                PlayerIconButton(
                    helpText: (store.isMuted || store.volume <= 0.001) ? "取消静音（右键调节音量）" : "静音（右键调节音量）",
                    active: store.isMuted ? true : nil,
                    highlightedBg: isVolumeSliderOpen,
                    action: { store.toggleMuted() }
                ) {
                    Image(systemName: volumeSymbol)
                        .font(.system(size: 16, weight: .medium))
                }
                .contextMenu {
                    Button(isVolumeSliderOpen ? "收起音量滑块" : "调节音量…") {
                        onToggleVolumeSlider()
                    }
                    Button(store.isMuted ? "取消静音" : "静音") {
                        store.toggleMuted()
                    }
                }

                Spacer()

                HStack(spacing: 4) {
                    // 1) 翻译语言菜单（GlobeIcon）
                    PlayerIconButton(
                        helpText: canOpenLangMenu ? "翻译语言" : "暂无可用翻译语种",
                        active: !prefs.translationSelections.isEmpty ? true : nil,
                        highlightedBg: isLangMenuOpen,
                        disabled: !canOpenLangMenu,
                        action: onToggleLangMenu
                    ) {
                        Image(systemName: "globe")
                            .font(.system(size: 16, weight: .medium))
                    }

                    // 2) 翻译显示开关（1:1 复刻 Lucide LanguagesIcon 文A，不使用气泡 SF Symbol）
                    PlayerIconButton(
                        helpText: prefs.translationsGenerating ? "正在翻译歌词…" : (prefs.canToggleTranslation ? "显示翻译" : "暂无额外歌词"),
                        active: prefs.canToggleTranslation && prefs.showTranslation,
                        disabled: !prefs.canToggleTranslation,
                        busy: prefs.translationsGenerating,
                        action: { store.toggleTranslation() }
                    ) {
                        LucideLanguagesIcon()
                    }

                    // 3) 音译/罗马音显示开关（1:1 复刻 Lucide CaseSensitiveIcon Aa，杜绝中文系统下 SF Symbol textformat 被本地化为「格式」二字）
                    PlayerIconButton(
                        helpText: prefs.pronunciationsGenerating ? "正在生成读音…" : (prefs.canToggleRomaji ? "显示读音" : "暂无额外歌词"),
                        active: prefs.canToggleRomaji && prefs.showRomaji,
                        disabled: !prefs.canToggleRomaji,
                        busy: prefs.pronunciationsGenerating,
                        action: { store.toggleRomaji() }
                    ) {
                        LucideCaseSensitiveIcon()
                    }

                    // 4) 更多选项三点菜单（MoreHorizontalIcon，展开时顺时针旋转 90°）
                    PlayerIconButton(
                        helpText: "更多选项",
                        highlightedBg: isMoreMenuOpen,
                        action: onToggleMoreMenu
                    ) {
                        Image(systemName: "ellipsis")
                            .font(.system(size: 16, weight: .semibold))
                            .rotationEffect(.degrees(isMoreMenuOpen ? 90 : 0))
                            .animation(.easeOut(duration: 0.2), value: isMoreMenuOpen)
                    }
                }
            }
        }
    }

    private var volumeSymbol: String {
        if store.isMuted || store.volume <= 0.001 { return "speaker.slash.fill" }
        if store.volume < 0.50 { return "speaker.wave.1.fill" }
        return "speaker.wave.2.fill"
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

// MARK: - 浮层 A：更多选项横向胶囊菜单（1:1 对齐 MoreControlsMenu：复制歌词 / 评论与旁白 / 歌词特效 / HDR 高光）

private struct MoreControlsFloatingPill: View {
    let copied: Bool
    let showLyricMoments: Bool
    let showLyricEffects: Bool
    let hdrEnabled: Bool
    let onCopyLyrics: () -> Void
    let onToggleMoments: () -> Void
    let onToggleEffects: () -> Void
    let onToggleHdr: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            PlayerIconButton(
                helpText: copied ? "已复制歌词" : "复制歌词",
                active: copied ? true : nil,
                action: onCopyLyrics
            ) {
                Image(systemName: copied ? "checkmark" : "doc.on.doc")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(copied ? Color.green : .white)
            }

            PlayerIconButton(
                helpText: "评论与旁白",
                active: showLyricMoments,
                action: onToggleMoments
            ) {
                Image(systemName: "text.bubble")
                    .font(.system(size: 15, weight: .medium))
            }

            PlayerIconButton(
                helpText: "歌词特效",
                active: showLyricEffects,
                action: onToggleEffects
            ) {
                Image(systemName: "sparkles")
                    .font(.system(size: 15.5, weight: .medium))
            }

            PlayerIconButton(
                helpText: "HDR 高光",
                active: hdrEnabled,
                action: onToggleHdr
            ) {
                Text("HDR")
                    .font(.system(size: 9.5, weight: .heavy, design: .rounded))
                    .padding(.horizontal, 3.5)
                    .padding(.vertical, 1.5)
                    .overlay {
                        RoundedRectangle(cornerRadius: 3.5, style: .continuous)
                            .strokeBorder(lineWidth: 1.2)
                    }
            }
        }
        .padding(4)
        .background(Color(white: 0.05).opacity(0.92), in: Capsule())
        .overlay {
            Capsule()
                .strokeBorder(Color.white.opacity(0.15), lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.50), radius: 16, y: 6)
    }
}

// MARK: - 浮层 B：翻译语言选择菜单（1:1 对齐 TranslationLanguageMenu：跟随界面语言 + AI/原版双语对比勾选）

private struct TranslationLanguagePopoverCard: View {
    let store: IslandStore

    var body: some View {
        let selections = store.preferences.translationSelections
        let items = store.preferences.availableTranslationLangs

        VStack(alignment: .leading, spacing: 2) {
            Text("可勾选两项上下对比")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.white.opacity(0.50))
                .padding(.horizontal, 10)
                .padding(.vertical, 4)

            TranslationOptionRow(
                title: "跟随界面语言",
                selectionOrder: selections.isEmpty ? 0 : nil,
                totalSelected: selections.isEmpty ? 1 : selections.count,
                generating: false
            ) {
                store.resetTranslationLangs()
            }

            ScrollView(.vertical, showsIndicators: true) {
                VStack(alignment: .leading, spacing: 2) {
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
            .frame(maxHeight: 190)
        }
        .padding(6)
        .frame(width: 220)
        .background(Color(white: 0.05).opacity(0.94), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(Color.white.opacity(0.15), lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.55), radius: 18, y: 6)
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
                        .foregroundStyle(.black)
                        .frame(width: 14, height: 14)
                        .background(Color.white, in: Circle())
                } else {
                    Image(systemName: "checkmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.white.opacity(isSelected ? 1.0 : 0))
                        .frame(width: 14, height: 14)
                }

                Text(title)
                    .font(.system(size: 12, weight: isSelected ? .medium : .regular))
                    .foregroundStyle(.white.opacity(isSelected ? 1.0 : 0.80))
                    .lineLimit(1)

                Spacer(minLength: 4)

                if generating {
                    ProgressView()
                        .controlSize(.mini)
                        .tint(.white)
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

// MARK: - 浮层 C：音量精细调节胶囊（右键静音按钮呼出）

private struct VolumeSliderFloatingPill: View {
    @Bindable var store: IslandStore

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: store.isMuted || store.volume <= 0.001 ? "speaker.slash.fill" : "speaker.wave.2.fill")
                .font(.system(size: 12))
                .foregroundStyle(.white.opacity(0.75))
                .frame(width: 16)

            Slider(value: $store.sliderVolume, in: 0...1)
                .frame(width: 120)
                .tint(.white)

            Text("\(Int(round((store.isMuted ? 0 : store.volume) * 100)))%")
                .font(.system(size: 11, weight: .medium).monospacedDigit())
                .foregroundStyle(.white.opacity(0.65))
                .frame(width: 34, alignment: .trailing)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color(white: 0.05).opacity(0.94), in: Capsule())
        .overlay {
            Capsule()
                .strokeBorder(Color.white.opacity(0.15), lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.50), radius: 16, y: 6)
    }
}

// MARK: - 浮层 D：小歌单弹出卡片（1:1 对齐 MusicMiniPlaylist：歌单计数标题 + 搜索框 + 定位当前曲目）

private struct MiniPlaylistPopoverCard: View {
    let store: IslandStore
    let onDismiss: () -> Void

    @State private var query: String = ""
    @State private var filteredTracks: [PlaylistTrackItem] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(store.playlistComplete ? "播放列表 (\(store.playlist.count))" : "正在加载播放列表…")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.white.opacity(0.60))
                Spacer()
                Button(action: onDismiss) {
                    Image(systemName: "xmark")
                        .font(.system(size: 10.5, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.50))
                        .frame(width: 20, height: 20)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 4)

            HStack(spacing: 7) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.50))
                TextField("搜索歌曲、歌手或专辑…", text: $query)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12))
                    .foregroundStyle(.white)
                    .disabled(!store.playlistComplete)
                if !query.isEmpty {
                    Button { query = "" } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 11.5))
                            .foregroundStyle(.white.opacity(0.45))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 6)
            .background(Color.white.opacity(0.10), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.15), lineWidth: 1)
            }

            if !store.playlistComplete {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                        .tint(.white)
                    Text("正在补全完整歌单…")
                        .font(.system(size: 12))
                        .foregroundStyle(.white.opacity(0.55))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 28)
            } else if filteredTracks.isEmpty {
                Text(store.playlist.isEmpty ? "暂无曲目" : "未找到匹配的曲目")
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.50))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 28)
            } else {
                ScrollViewReader { proxy in
                    ScrollView(.vertical, showsIndicators: true) {
                        LazyVStack(spacing: 2) {
                            ForEach(filteredTracks) { item in
                                PlaylistTrackRow(
                                    item: item,
                                    isCurrent: item.id == store.track?.id,
                                    isPlaying: store.isPlaying,
                                    accentColor: store.accentColor
                                ) {
                                    store.playTrack(at: item.index)
                                    onDismiss()
                                }
                            }
                        }
                    }
                    .frame(maxHeight: 192)
                    .onAppear {
                        if let curId = store.track?.id {
                            DispatchQueue.main.async {
                                proxy.scrollTo(curId, anchor: .center)
                            }
                        }
                    }
                }
            }
        }
        .padding(10)
        .background(Color(white: 0.06).opacity(0.96), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(Color.white.opacity(0.12), lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.55), radius: 20, y: 8)
        .onAppear {
            rebuildFilteredTracks()
            store.requestFullPlaylistIfNeeded()
        }
        .onChange(of: query) { _, _ in
            rebuildFilteredTracks()
        }
        .onChange(of: store.playlist) { _, _ in
            rebuildFilteredTracks()
        }
    }

    private func rebuildFilteredTracks() {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            filteredTracks = store.playlist
            return
        }
        filteredTracks = store.playlist.filter {
            $0.name.localizedStandardContains(trimmed)
                || $0.artists.localizedStandardContains(trimmed)
                || $0.album.localizedStandardContains(trimmed)
        }
    }
}

private struct PlaylistTrackRow: View {
    let item: PlaylistTrackItem
    let isCurrent: Bool
    let isPlaying: Bool
    let accentColor: Color
    let onSelect: () -> Void

    @State private var isHovered: Bool = false

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 8) {
                if isCurrent {
                    Image(systemName: isPlaying ? "waveform" : "pause.fill")
                        .font(.system(size: 10.5, weight: .bold))
                        .foregroundStyle(accentColor)
                        .frame(width: 16)
                } else {
                    Text("\(item.index + 1)")
                        .font(.system(size: 10.5).monospacedDigit())
                        .foregroundStyle(.white.opacity(0.38))
                        .frame(width: 16)
                }

                VStack(alignment: .leading, spacing: 1) {
                    Text(item.name)
                        .font(.system(size: 12.5, weight: isCurrent ? .semibold : .regular))
                        .foregroundStyle(isCurrent ? .white : .white.opacity(0.88))
                        .lineLimit(1)
                    if !item.artists.isEmpty {
                        Text(item.artists)
                            .font(.system(size: 10.5))
                            .foregroundStyle(.white.opacity(0.45))
                            .lineLimit(1)
                    }
                }

                Spacer(minLength: 4)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(
                Color.white.opacity(isCurrent ? 0.12 : (isHovered ? 0.07 : 0)),
                in: RoundedRectangle(cornerRadius: 8, style: .continuous)
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
