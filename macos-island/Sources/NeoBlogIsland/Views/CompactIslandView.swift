import SwiftUI

// 【双端同步维护约定】
// 本文件对应网页端 `web/src/components/layout/topbar-island/music-island-compact.tsx` 及 `web/src/lib/lyrics/strip-slots.ts` / `marquee.ts`。
// 一旦新增或调整紧凑胶囊布局、多行槽位或横向滚动策略，Web 与 Swift 两端必须同步实现。

// MARK: - 单行条单元格（基于 SwiftUI 真实几何宽度 + 原生左/中/右对齐 + 溢出时舒适走廊拉紧弦 C² 平滑横向滚动）

private struct StripLineCellView: View {
    let store: IslandStore
    let item: IslandStore.StripRenderItem
    let nowMs: Double
    let cellWidth: CGFloat
    let baseFontSize: CGFloat

    @State private var actualContentWidth: CGFloat = 0

    var body: some View {
        let line = item.line
        let fontSize: CGFloat = line.isBackground ? baseFontSize * 0.72 : baseFontSize
        let tieredScale: CGFloat = (item.slot != nil && !line.isBackground) ? CGFloat(LyricSpecs.stripTierScale) : 1.0
        let effectiveFontSize = fontSize * tieredScale
        let horizontalPad: CGFloat = 8
        let innerWidth = max(20, Double(cellWidth - horizontalPad * 2))

        let edgeHexes = (line.edgeColors?.isEmpty == false) ? line.edgeColors! : nil
        let edgeLeadPx: Double = edgeHexes != nil ? (Double(line.isBackground ? 2.0 : 2.5) + 4.5) : 0

        let (rawBoxes, estimatedTextWidth) = LyricFontResolver.measureLineWords(
            line: line,
            songFont: store.lyrics.font,
            fontSize: effectiveFontSize,
            showEffects: store.preferences.showLyricEffects
        )
        let estimatedTotalWidth = estimatedTextWidth + edgeLeadPx
        let contentWidth = actualContentWidth > 1 ? Double(actualContentWidth) : estimatedTotalWidth
        let overflow = contentWidth - innerWidth
        let isOverflowing = overflow > 1.0

        let offsetPx: Double = {
            guard isOverflowing else { return 0 }
            if store.lyrics.wordSynced && !line.words.isEmpty && line.words.contains(where: { $0.end > $0.start }) {
                let textWidth = max(1, contentWidth - edgeLeadPx)
                let widthScale = estimatedTextWidth > 1 ? (textWidth / estimatedTextWidth) : 1.0
                let scaledBoxes = rawBoxes.map {
                    MarqueeWordBox(left: edgeLeadPx + $0.left * widthScale, width: $0.width * widthScale)
                }
                let knots = MarqueeSolver.computeWordKnots(
                    words: line.words,
                    boxes: scaledBoxes,
                    containerWidth: innerWidth,
                    overflow: overflow
                )
                return MarqueeSolver.evaluateKnots(knots, timeMs: nowMs)
            } else {
                return MarqueeSolver.lineTimedOffset(
                    lineStart: line.start,
                    lineEnd: line.end,
                    nextLineStart: item.nextLineStart,
                    timeMs: nowMs,
                    overflow: overflow
                )
            }
        }()

        let nativeAlignment: Alignment = {
            guard !isOverflowing else { return .leading }
            switch line.align {
            case "right":
                return .trailing
            case "center":
                return .center
            default:
                return .leading
            }
        }()

        let fadeLeft = isOverflowing && offsetPx > 0.5
        let fadeRight = isOverflowing && offsetPx < overflow - 0.5
        let spot = store.spotlightState(at: nowMs)
        let isHdrSpot = store.config.hdr && spot?.line == item.lineIndex && (spot?.level ?? 0) >= 0.5

        HStack(alignment: .center, spacing: 4.5) {
            // 仅在有歌手标注时展示句首左侧歌手颜色指示条，不展示歌手名称胶囊（与网页端 strip 模式 1:1 一致）
            if let edgeHexes {
                SingerEdgeBarView(
                    edgeHexes: edgeHexes,
                    fontSize: effectiveFontSize,
                    isBackground: line.isBackground,
                    opacity: 0.96
                )
            }

            LyricLineSweepView(
                line: line,
                lineKeyPrefix: "strip-\(item.id)",
                songFont: store.lyrics.font,
                wordSynced: store.lyrics.wordSynced,
                showEffects: store.preferences.showLyricEffects,
                hdrEnabled: store.config.hdr,
                rhythm: store.rhythm,
                seekAtMs: store.seekAtMs,
                debrisEngine: store.debrisEngine,
                nowMs: nowMs,
                fontSize: effectiveFontSize,
                isBackground: line.isBackground,
                allowsWrapping: false,
                wrapAlignment: .leading,
                hdrSpotBoost: isHdrSpot
            )
        }
        .fixedSize(horizontal: true, vertical: false)
        .onGeometryChange(for: CGFloat.self) { proxy in
            proxy.size.width
        } action: { newWidth in
            if abs(newWidth - actualContentWidth) > 0.25 {
                actualContentWidth = newWidth
            }
        }
        .opacity(line.isBackground ? 0.78 : 1.0)
        .offset(x: isOverflowing ? CGFloat(-offsetPx) : 0)
        .frame(width: CGFloat(innerWidth), alignment: nativeAlignment)
        .padding(.horizontal, horizontalPad)
        .frame(width: cellWidth, alignment: .leading)
        .clipped()
        .mask {
            if fadeLeft || fadeRight {
                let edgeRatio = min(0.22, 14.0 / max(40.0, cellWidth))
                LinearGradient(
                    stops: [
                        .init(color: fadeLeft ? .clear : .black, location: 0),
                        .init(color: .black, location: fadeLeft ? edgeRatio : 0),
                        .init(color: .black, location: fadeRight ? (1.0 - edgeRatio) : 1.0),
                        .init(color: fadeRight ? .clear : .black, location: 1.0)
                    ],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            } else {
                Rectangle()
            }
        }
    }
}

// MARK: - 紧凑态舞台（仅在此子树内运行 60fps TimelineView，避免外层封面与律动条被无谓重绘）

private struct StripStageContainerView: View {
    let store: IslandStore
    let width: CGFloat
    let height: CGFloat
    let baseFontSize: CGFloat

    var body: some View {
        TimelineView(.animation(paused: !store.isPlaying && !store.debrisEngine.hasActiveDebris)) { context in
            let nowMs = store.currentPositionMs(at: context.date)
            let plan = store.stripRenderItems(at: nowMs, containerHeight: Double(height))

            ZStack {
                if let interlude = plan.interlude {
                    let nextAlign = store.lyrics.lines.first(where: { $0.start >= interlude.end - 50 })?.align ?? "left"
                    InterludeDotsView(
                        range: interlude,
                        rhythm: store.rhythm,
                        nowMs: nowMs,
                        align: nextAlign,
                        dotSize: 6.5,
                        hdrEnabled: store.config.hdr
                    )
                } else if !plan.items.isEmpty {
                    ForEach(plan.items) { item in
                        let isHalf = item.slot?.half == true
                        let isDuet = item.line.isDuet || item.line.align == "right"
                        let cellW = isHalf ? width * 0.5 : width
                        let xOffset: CGFloat = isHalf ? (isDuet ? width * 0.25 : -width * 0.25) : 0
                        let yOffset: CGFloat = {
                            guard let slot = item.slot else { return 0 }
                            return CGFloat(slot.row == .top ? LyricSpecs.stripTierTop : LyricSpecs.stripTierBottom) * height
                        }()

                        StripLineCellView(
                            store: store,
                            item: item,
                            nowMs: nowMs,
                            cellWidth: cellW,
                            baseFontSize: baseFontSize
                        )
                        .offset(x: xOffset, y: yOffset)
                        .transition(.asymmetric(
                            insertion: .offset(y: height * 0.42).combined(with: .opacity),
                            removal: .offset(y: -height * 0.42).combined(with: .opacity)
                        ))
                    }
                } else {
                    MarqueeTextView(resetId: store.track?.id ?? 0) {
                        Text(store.track?.inlineTitle ?? "")
                            .font(.system(size: baseFontSize - 0.5, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.84))
                    }
                    .padding(.horizontal, 8)
                    .frame(width: width, alignment: .leading)
                }

                if store.debrisEngine.hasActiveDebris {
                    Canvas { ctx, _ in
                        store.debrisEngine.stepAndDraw(in: &ctx, date: context.date)
                    }
                    .allowsHitTesting(false)
                }
            }
            .frame(width: width, height: height)
            .coordinateSpace(name: "debrisSpace")
            .animation(.spring(duration: 0.38, bounce: 0.14), value: plan.items.map(\.id))
        }
    }
}

// MARK: - 紧凑态胶囊外层布局（遵循 swiftui-expert-skill：按功能拆分为独立 View 结构体边界）

struct CompactIslandContent: View {
    let store: IslandStore
    let metrics: ScreenNotchMetrics
    let useNotch: Bool
    let coverNamespace: Namespace.ID

    var body: some View {
        if useNotch {
            NotchMergedCompactView(store: store, metrics: metrics, coverNamespace: coverNamespace)
        } else {
            FloatingCapsuleCompactView(store: store, coverNamespace: coverNamespace)
        }
    }
}

private struct NotchMergedCompactView: View {
    let store: IslandStore
    let metrics: ScreenNotchMetrics
    let coverNamespace: Namespace.ID

    var body: some View {
        let totalBodyWidth = max(316, metrics.notchWidth + 132)
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                HStack(spacing: 6) {
                    AlbumCoverView(
                        albumPicURL: store.track?.albumPic,
                        accent: store.accentColor,
                        isSpinning: store.showPlaying,
                        size: 22,
                        cornerRadius: 11
                    )
                    .matchedGeometryEffect(id: "albumCover", in: coverNamespace)
                }
                .frame(width: 50, alignment: .leading)
                .padding(.leading, 14)

                Spacer(minLength: 0)
                    .frame(width: metrics.notchWidth)

                HStack {
                    Spacer(minLength: 0)
                    CompactTrailingSlotView(store: store)
                }
                .frame(width: 50, alignment: .trailing)
                .padding(.trailing, 14)
            }
            .frame(width: totalBodyWidth, height: metrics.notchHeight)

            CompactCenterStageSlot(
                store: store,
                stripWidth: totalBodyWidth - 16,
                stripHeight: 34,
                baseFontSize: 14.5,
                staticHorizontalPadding: 14
            )
            .frame(width: totalBodyWidth, height: 34)
            .padding(.bottom, 3)
        }
    }
}

private struct FloatingCapsuleCompactView: View {
    let store: IslandStore
    let coverNamespace: Namespace.ID

    var body: some View {
        let playingStripWidth: CGFloat = 264
        HStack(spacing: 8) {
            AlbumCoverView(
                albumPicURL: store.track?.albumPic,
                accent: store.accentColor,
                isSpinning: store.showPlaying,
                size: 24,
                cornerRadius: 12
            )
            .matchedGeometryEffect(id: "albumCover", in: coverNamespace)

            CompactCenterStageSlot(
                store: store,
                stripWidth: playingStripWidth,
                stripHeight: 36,
                baseFontSize: 15.5,
                staticHorizontalPadding: 4
            )

            CompactTrailingSlotView(store: store)
        }
        .padding(.horizontal, 10)
        .frame(height: 36)
    }
}

private struct CompactCenterStageSlot: View {
    let store: IslandStore
    let stripWidth: CGFloat
    let stripHeight: CGFloat
    let baseFontSize: CGFloat
    let staticHorizontalPadding: CGFloat

    var body: some View {
        if store.showPlaying && store.startupBannerText == nil && store.peekText == nil && !store.lyrics.instrumental {
            StripStageContainerView(
                store: store,
                width: stripWidth,
                height: stripHeight,
                baseFontSize: baseFontSize
            )
        } else {
            CompactStaticBannerView(
                store: store,
                fontSize: baseFontSize - 0.5,
                maxTextWidth: max(60, stripWidth - staticHorizontalPadding * 2)
            )
            .padding(.horizontal, staticHorizontalPadding)
            .frame(maxWidth: stripWidth)
        }
    }
}

private struct CompactStaticBannerView: View {
    let store: IslandStore
    let fontSize: CGFloat
    let maxTextWidth: CGFloat

    var body: some View {
        if let banner = store.startupBannerText, store.track == nil {
            Text(banner)
                .font(.system(size: fontSize, weight: .semibold))
                .foregroundStyle(.white.opacity(0.90))
                .lineLimit(1)
                .frame(maxWidth: maxTextWidth)
        } else if let peek = store.peekText, !peek.isEmpty {
            MarqueeTextView(resetId: "peek-\(peek)", maxContainerWidth: maxTextWidth) {
                Text(peek)
                    .font(.system(size: fontSize, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.92))
            }
        } else if !store.showPlaying {
            let text = store.pausedText ?? store.track?.inlineTitle ?? ""
            MarqueeTextView(resetId: "paused-\(store.track?.id ?? 0)-\(text)", maxContainerWidth: maxTextWidth) {
                Text(text)
                    .font(LyricFontResolver.swiftUIFont(key: store.lyrics.font, size: fontSize, bold: false))
                    .foregroundStyle(.white.opacity(0.86))
            }
        } else if store.lyrics.instrumental {
            Text("纯音乐，请欣赏")
                .font(.system(size: fontSize, weight: .medium))
                .foregroundStyle(.white.opacity(0.75))
                .lineLimit(1)
        } else {
            let text = store.track?.inlineTitle ?? ""
            MarqueeTextView(resetId: "title-\(store.track?.id ?? 0)-\(text)", maxContainerWidth: maxTextWidth) {
                Text(text)
                    .font(.system(size: fontSize, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.84))
            }
        }
    }
}

private struct CompactTrailingSlotView: View {
    let store: IslandStore

    var body: some View {
        if store.track == nil {
            EmptyView()
        } else if !store.showPlaying {
            Image(systemName: "play.fill")
                .font(.system(size: 11.5, weight: .bold))
                .foregroundStyle(.white.opacity(0.90))
                .frame(width: 18, height: 18)
        } else if store.config.beatBars {
            BeatBarsView(store: store)
        }
    }
}
