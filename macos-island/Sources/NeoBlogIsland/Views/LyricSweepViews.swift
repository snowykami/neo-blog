import AppKit
import ImageIO
import SwiftUI

private struct SendableDecodedCover: @unchecked Sendable {
    let cgImage: CGImage
}

/// 灵动岛全局专辑封面解码与预热缓存（NSCache 内存同步直读 + 后台 ImageIO 降采样）：
/// 切歌或展开/收起形变时若目标封面已在前后一首空闲预热中解码完毕，首帧 0ms 直接命中内存，彻底消除占位图标闪烁。
@MainActor
final class IslandArtworkCache {
    static let shared = IslandArtworkCache()

    private let cache: NSCache<NSString, NSImage> = {
        let c = NSCache<NSString, NSImage>()
        c.countLimit = 64
        return c
    }()

    private var inFlight: Set<String> = []

    func image(for urlString: String?) -> NSImage? {
        guard let key = urlString, !key.isEmpty else { return nil }
        return cache.object(forKey: key as NSString)
    }

    func preload(urlStrings: [String?]) {
        for raw in urlStrings {
            guard let key = raw, !key.isEmpty else { continue }
            if cache.object(forKey: key as NSString) != nil || inFlight.contains(key) {
                continue
            }
            guard let url = URL(string: key) else { continue }
            inFlight.insert(key)
            Task(priority: .utility) { [weak self] in
                let decoded = await Self.fetchAndDecode(url: url, maxPixelSize: 480)
                await MainActor.run {
                    guard let self else { return }
                    self.inFlight.remove(key)
                    if let decoded {
                        let img = NSImage(
                            cgImage: decoded.cgImage,
                            size: NSSize(width: decoded.cgImage.width, height: decoded.cgImage.height)
                        )
                        self.cache.setObject(img, forKey: key as NSString)
                    }
                }
            }
        }
    }

    func load(urlString: String?) async -> NSImage? {
        guard let key = urlString, !key.isEmpty else { return nil }
        if let hit = cache.object(forKey: key as NSString) {
            return hit
        }
        guard let url = URL(string: key) else { return nil }
        guard let decoded = await Self.fetchAndDecode(url: url, maxPixelSize: 480) else {
            return nil
        }
        let img = NSImage(
            cgImage: decoded.cgImage,
            size: NSSize(width: decoded.cgImage.width, height: decoded.cgImage.height)
        )
        cache.setObject(img, forKey: key as NSString)
        return img
    }

    private nonisolated static func fetchAndDecode(url: URL, maxPixelSize: Int) async -> SendableDecodedCover? {
        let req = URLRequest(url: url, cachePolicy: .returnCacheDataElseLoad, timeoutInterval: 12)
        guard let (data, response) = try? await URLSession.shared.data(for: req),
              let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode),
              !data.isEmpty else {
            return nil
        }
        let srcOpts: [CFString: Any] = [kCGImageSourceShouldCache: false]
        guard let src = CGImageSourceCreateWithData(data as CFData, srcOpts as CFDictionary) else {
            return nil
        }
        let thumbOpts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, thumbOpts as CFDictionary) else {
            return nil
        }
        return SendableDecodedCover(cgImage: cg)
    }
}

// 【双端同步维护约定】
// 本文件对应网页端 `web/src/lib/lyrics/lyric-player.ts`、`ruby-layout.ts`、`word-effects.ts`、`lyric-debris.ts`、
// `music-stage-effects.tsx`、`marquee-text.tsx` 及 `music-island-compact.tsx`。
// 一旦新增歌词动效、逐字振假名/音译注音、字体、多声部样式、舞台粒子或封面/律动条表现，Web 与 Swift 两端必须同步实现。

// MARK: - 专辑封面圆盘 / 圆角方形视图（静态封面层与旋转动画层彻底分离，旋转时 0 次 AsyncImage 重算）

struct AlbumCoverView: View {
    let albumPicURL: String?
    let accent: Color
    let isSpinning: Bool
    let size: CGFloat
    let cornerRadius: CGFloat

    @State private var accumulatedSeconds: TimeInterval = 0
    @State private var spinAnchorDate: Date? = nil

    var body: some View {
        let shouldRotateDisc = cornerRadius >= size * 0.45
        if shouldRotateDisc {
            TimelineView(.animation(paused: !isSpinning)) { context in
                let activeDelta: TimeInterval = {
                    guard isSpinning else { return 0 }
                    let anchor = spinAnchorDate ?? context.date
                    return max(0, context.date.timeIntervalSince(anchor))
                }()
                let totalElapsed = accumulatedSeconds + activeDelta
                let angle = (totalElapsed.truncatingRemainder(dividingBy: 14.0) / 14.0) * 360.0
                CoverArtworkLayer(
                    albumPicURL: albumPicURL,
                    accent: accent,
                    size: size,
                    cornerRadius: cornerRadius
                )
                .rotationEffect(.degrees(angle))
            }
            .onAppear {
                spinAnchorDate = isSpinning ? Date() : nil
            }
            .onChange(of: isSpinning) { _, spinning in
                let now = Date()
                if spinning {
                    spinAnchorDate = now
                } else {
                    if let anchor = spinAnchorDate {
                        accumulatedSeconds += max(0, now.timeIntervalSince(anchor))
                    }
                    spinAnchorDate = nil
                }
            }
            .onChange(of: albumPicURL) { _, _ in
                accumulatedSeconds = 0
                spinAnchorDate = isSpinning ? Date() : nil
            }
        } else {
            CoverArtworkLayer(
                albumPicURL: albumPicURL,
                accent: accent,
                size: size,
                cornerRadius: cornerRadius
            )
        }
    }
}

private struct CoverArtworkLayer: View {
    let albumPicURL: String?
    let accent: Color
    let size: CGFloat
    let cornerRadius: CGFloat

    @State private var loadedImage: NSImage? = nil

    var body: some View {
        let resolvedImage = IslandArtworkCache.shared.image(for: albumPicURL) ?? loadedImage

        ZStack {
            LinearGradient(
                colors: [accent.opacity(0.65), Color(white: 0.14)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            if let nsImage = resolvedImage {
                Image(nsImage: nsImage)
                    .resizable()
                    .scaledToFill()
            } else {
                PlaceholderDiscIcon(size: size)
            }

            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .strokeBorder(Color.white.opacity(0.18), lineWidth: 0.8)
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        .task(id: albumPicURL) {
            guard let urlStr = albumPicURL, !urlStr.isEmpty else {
                loadedImage = nil
                return
            }
            if let hit = IslandArtworkCache.shared.image(for: urlStr) {
                loadedImage = hit
                return
            }
            let fetched = await IslandArtworkCache.shared.load(urlString: urlStr)
            if !Task.isCancelled {
                loadedImage = fetched
            }
        }
    }
}

private struct PlaceholderDiscIcon: View {
    let size: CGFloat

    var body: some View {
        Image(systemName: "music.note")
            .font(.system(size: size * 0.42, weight: .semibold))
            .foregroundStyle(.white.opacity(0.75))
    }
}

// MARK: - 模糊封面背景 + MusicStageEffects contained（呼吸/副歌爆发/方向性染色/聚光灯暖光/18 种舞台粒子）

struct CoverBackdropView: View {
    let store: IslandStore
    let expanded: Bool

    var body: some View {
        GeometryReader { geo in
            ZStack {
                CoverBlurredArtworkLayer(
                    albumPicURL: store.track?.albumPic,
                    accentColor: store.accentColor,
                    expanded: expanded,
                    size: geo.size
                )

                Color.black.opacity(expanded ? 0.46 : 0.38)

                if store.preferences.showLyricEffects && (expanded || store.showPlaying) {
                    ContainedStageEffectsOverlay(store: store, expanded: expanded)
                }

                if !expanded && store.config.beatBars && store.isPlaying && store.rhythm.reliable {
                    BeatTintPulseOverlay(store: store)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .clipped()
        }
    }
}

private struct CoverBlurredArtworkLayer: View {
    let albumPicURL: String?
    let accentColor: Color
    let expanded: Bool
    let size: CGSize

    @State private var loadedImage: NSImage? = nil

    var body: some View {
        let resolvedImage = IslandArtworkCache.shared.image(for: albumPicURL) ?? loadedImage

        ZStack {
            Color(red: 0.04, green: 0.04, blue: 0.05)

            if let nsImage = resolvedImage {
                Image(nsImage: nsImage)
                    .resizable()
                    .scaledToFill()
                    .frame(width: size.width * 1.2, height: size.height * 1.2)
                    .blur(radius: expanded ? 26 : 12)
                    .opacity(expanded ? 0.44 : 0.36)
            } else {
                LinearGradient(
                    colors: [accentColor.opacity(expanded ? 0.30 : 0.20), .clear],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            }
        }
        .task(id: albumPicURL) {
            guard let urlStr = albumPicURL, !urlStr.isEmpty else {
                loadedImage = nil
                return
            }
            if let hit = IslandArtworkCache.shared.image(for: urlStr) {
                loadedImage = hit
                return
            }
            let fetched = await IslandArtworkCache.shared.load(urlString: urlStr)
            if !Task.isCancelled {
                loadedImage = fetched
            }
        }
    }
}

/// 1:1 对应 web/src/components/music-page/music-stage-effects.tsx (contained)：
/// 小窗与胶囊精简版全屏特效层（背景呼吸、副歌爆发、短语/多声部染色偏移、聚光灯暖色背光及粒子场景）
private struct ContainedStageEffectsOverlay: View {
    let store: IslandStore
    let expanded: Bool

    var body: some View {
        let engine = expanded ? store.expandedStageParticles : store.compactStageParticles
        TimelineView(.animation(paused: !store.isPlaying && !engine.hasActiveParticles)) { context in
            GeometryReader { geo in
                let ms = store.currentPositionMs(at: context.date)
                let signals = store.stageSignals(at: ms)
                let beat = store.rhythm.reliable ? store.rhythm.backgroundLevel(timeMs: ms) : 0
                let pulseAlpha = max(signals.pulse * 0.22, max(signals.burst * 0.45, beat * 0.12))
                let tintAlpha = signals.tintStrength * 0.38
                let smoothedAmbience = engine.smoothAmbience(
                    date: context.date,
                    tintHex: signals.tintColorHex,
                    tintAlpha: tintAlpha,
                    vocalShiftRatio: signals.vocalShiftRatio
                )
                let w = geo.size.width
                let h = geo.size.height

                ZStack {
                    if let tintColor = smoothedAmbience.color {
                        RadialGradient(
                            colors: [tintColor, .clear],
                            center: UnitPoint(x: 0.65, y: 0.45),
                            startRadius: 0,
                            endRadius: max(w, h) * 0.72
                        )
                        .offset(x: CGFloat(smoothedAmbience.shiftRatio) * w)
                        .blendMode(.screen)
                    }

                    if pulseAlpha > 0.004 {
                        RadialGradient(
                            colors: [store.accentColor.opacity(pulseAlpha), .clear],
                            center: .center,
                            startRadius: 0,
                            endRadius: max(w, h) * 0.75
                        )
                        .blendMode(.softLight)
                    }

                    if expanded && signals.spotlightLevel > 0.004 {
                        let spot = signals.spotlightLevel
                        ZStack {
                            RadialGradient(
                                colors: [Color(red: 1.0, green: 0.925, blue: 0.784).opacity(0.22 * spot), .clear],
                                center: .center,
                                startRadius: 0,
                                endRadius: max(w, h) * 0.46
                            )
                            RadialGradient(
                                colors: [.clear, Color.black.opacity(0.18 * spot)],
                                center: .center,
                                startRadius: min(w, h) * 0.28,
                                endRadius: max(w, h) * 0.72
                            )
                        }
                    }

                    Canvas { ctx, canvasSize in
                        engine.stepAndDraw(
                            in: &ctx,
                            size: canvasSize,
                            date: context.date,
                            timeMs: ms,
                            scene: signals.scene,
                            isPlaying: store.isPlaying,
                            rhythm: store.rhythm
                        )
                    }
                }
            }
        }
        .allowsHitTesting(false)
    }
}

private struct BeatTintPulseOverlay: View {
    let store: IslandStore

    var body: some View {
        TimelineView(.animation) { context in
            let ms = store.currentPositionMs(at: context.date)
            let beatTint = 0.22 * store.rhythm.backgroundLevel(timeMs: ms)
            Color.edrCss(
                store.accentHex,
                tint: 1.0,
                gain: store.config.hdr ? 1.45 : 1.0,
                opacity: beatTint
            )
        }
    }
}

// MARK: - 单行超长跑马灯视图（1:1 对应 web/src/components/common/marquee-text.tsx）
// 关键布局铁律：测量节点必须放在 .background、滚动双份轨道必须放在 .overlay，主视图使用 frame(minWidth: 0, maxWidth: ...)
// 绝不允许在主布局树（如 ZStack 子节点）使用 .fixedSize(horizontal: true)，否则会把父级 HStack / VStack 反向撑爆！

struct MarqueeTextView<Content: View>: View {
    let resetId: AnyHashable
    var speed: Double = 30.0
    var holdSeconds: Double = 2.0
    var gapPx: CGFloat = 40.0
    /// 非 nil 时为自适应上限模式（短文本贴合自身宽度、超长时封顶在此宽度内跑马灯滚动，用于收起态胶囊）
    var maxContainerWidth: CGFloat? = nil
    @ViewBuilder let content: () -> Content

    @State private var containerWidth: CGFloat = 0
    @State private var contentWidth: CGFloat = 0

    var body: some View {
        let effectiveContainerWidth: CGFloat = {
            if let cap = maxContainerWidth {
                return contentWidth > 0 ? min(contentWidth, cap) : min(containerWidth > 0 ? containerWidth : cap, cap)
            }
            return containerWidth
        }()
        let isOverflowing = effectiveContainerWidth > 1 && contentWidth > effectiveContainerWidth + 1.0

        Group {
            if let cap = maxContainerWidth {
                content()
                    .lineLimit(1)
                    .frame(
                        width: contentWidth > 0 ? min(contentWidth, cap) : nil,
                        alignment: .leading
                    )
                    .frame(maxWidth: cap, alignment: .leading)
            } else {
                content()
                    .lineLimit(1)
                    .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
            }
        }
        .opacity(isOverflowing ? 0 : 1)
        .onGeometryChange(for: CGFloat.self) { proxy in
            proxy.size.width
        } action: { w in
            if abs(w - containerWidth) > 0.5 {
                containerWidth = w
            }
        }
        // 测量节点置于 .background：SwiftUI 保证 .background 永远不参与主视图理想/最小宽度计算
        .background(alignment: .leading) {
            content()
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)
                .hidden()
                .allowsHitTesting(false)
                .onGeometryChange(for: CGFloat.self) { proxy in
                    proxy.size.width
                } action: { w in
                    if abs(w - contentWidth) > 0.5 {
                        contentWidth = w
                    }
                }
        }
        // 双份滚动轨道置于 .overlay：完全受主视图已确定的宽度约束，绝不外溢撑宽父容器
        .overlay(alignment: .leading) {
            if isOverflowing {
                MarqueeScrollingTrackView(
                    resetId: resetId,
                    contentWidth: contentWidth,
                    containerWidth: effectiveContainerWidth,
                    speed: speed,
                    holdSeconds: holdSeconds,
                    gapPx: gapPx,
                    content: content
                )
            }
        }
        .clipped()
    }
}

private struct MarqueeScrollingTrackView<Content: View>: View {
    let resetId: AnyHashable
    let contentWidth: CGFloat
    let containerWidth: CGFloat
    let speed: Double
    let holdSeconds: Double
    let gapPx: CGFloat
    @ViewBuilder let content: () -> Content

    @State private var anchorDate: Date = Date()
    @State private var pausedElapsed: TimeInterval = 0
    @State private var hoverStartDate: Date? = nil
    @State private var isHovered: Bool = false

    var body: some View {
        let distance = Double(contentWidth + gapPx)
        let scrollDuration = distance / max(5.0, speed)
        let cycleDuration = holdSeconds + scrollDuration
        let fadeRatio = min(0.18, Double(12.0 / max(32.0, containerWidth)))

        TimelineView(.animation(paused: isHovered)) { timeline in
            let activeNow = hoverStartDate ?? timeline.date
            let elapsed = max(0, pausedElapsed + activeNow.timeIntervalSince(anchorDate))
            let phase = elapsed.truncatingRemainder(dividingBy: max(0.1, cycleDuration))
            let inHold = phase <= holdSeconds
            let progress = inHold ? 0.0 : ((phase - holdSeconds) / max(0.01, scrollDuration))
            let dx = -CGFloat(progress * distance)

            HStack(spacing: gapPx) {
                content().fixedSize(horizontal: true, vertical: false)
                content().fixedSize(horizontal: true, vertical: false)
            }
            .offset(x: dx)
            .frame(width: containerWidth, alignment: .leading)
            .clipped()
            .mask {
                LinearGradient(
                    stops: [
                        .init(color: inHold ? .black : .clear, location: 0),
                        .init(color: .black, location: inHold ? 0 : fadeRatio),
                        .init(color: .black, location: 1.0 - fadeRatio),
                        .init(color: .clear, location: 1.0)
                    ],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            }
        }
        .onHover { hovering in
            guard hovering != isHovered else { return }
            let now = Date()
            if hovering {
                pausedElapsed += now.timeIntervalSince(anchorDate)
                hoverStartDate = now
            } else {
                anchorDate = now
                hoverStartDate = nil
            }
            isHovered = hovering
        }
        .onChange(of: resetId) { _, _ in
            anchorDate = Date()
            pausedElapsed = 0
            hoverStartDate = isHovered ? Date() : nil
        }
    }
}

// MARK: - 歌手颜色指示竖条（1:1 对应 lyric-player.css .lyric-edge：独唱为单色胶囊竖条，多人合唱为边界分明的纵向等分纯色块，避免过渡渐变发灰）

struct SingerEdgeBarView: View {
    let edgeHexes: [String]
    let fontSize: CGFloat
    let isBackground: Bool
    let opacity: Double

    var body: some View {
        let barWidth: CGFloat = isBackground ? 2.2 : 3.0
        let barHeight: CGFloat = fontSize * 1.0
        Group {
            if edgeHexes.count <= 1 {
                Capsule(style: .continuous)
                    .fill(Color(cssColor: edgeHexes.first))
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(edgeHexes.enumerated()), id: \.offset) { _, hex in
                        Color(cssColor: hex)
                    }
                }
                .clipShape(Capsule(style: .continuous))
            }
        }
        .frame(width: barWidth, height: barHeight)
        .opacity(opacity)
    }
}

// MARK: - 3 颗节拍倒计时呼吸间奏圆点（1:1 对应 interlude.ts & lyric-player.css）

struct InterludeDotsView: View {
    private static let dotIds = [0, 1, 2]

    let range: TimeIntervalRange
    let rhythm: RhythmEngineContext
    let nowMs: Double
    let align: String
    let dotSize: CGFloat
    var hdrEnabled: Bool = false

    var body: some View {
        let states = rhythm.interludeDots(start: range.start, end: range.end, timeMs: nowMs, count: 3)
        let frameAlign: Alignment = align == "right" ? .trailing : (align == "center" ? .center : .leading)
        let dotColor = Color.edrCss("#ffffff", tint: 0, gain: hdrEnabled ? 1.32 : 1.0)

        HStack(spacing: dotSize * 0.8) {
            ForEach(Self.dotIds, id: \.self) { idx in
                let st = states[idx]
                let anchor: UnitPoint = idx == 0
                    ? UnitPoint(x: 1.8, y: 0.5)
                    : (idx == 2 ? UnitPoint(x: -0.8, y: 0.5) : .center)

                Circle()
                    .fill(dotColor)
                    .frame(width: dotSize, height: dotSize)
                    .opacity(st.opacity)
                    .scaleEffect(st.scale, anchor: anchor)
            }
        }
        .padding(.horizontal, 10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: frameAlign)
        .allowedDynamicRange(hdrEnabled ? .high : .standard)
    }
}

// MARK: - 5 根节拍律动条（有真实节拍模型时按拍跳动变亮，否则按错频正弦回退；原生线性 EDR）

struct BeatBarsView: View {
    private struct BarSpec: Identifiable {
        let id: Int
        let weight: Double
        let lagMs: Double
        let freq: Double
    }

    private static let specs: [BarSpec] = [
        .init(id: 0, weight: 0.60, lagMs: 90, freq: 6.3),
        .init(id: 1, weight: 0.85, lagMs: 40, freq: 8.1),
        .init(id: 2, weight: 1.00, lagMs: 0, freq: 9.7),
        .init(id: 3, weight: 0.80, lagMs: 60, freq: 7.4),
        .init(id: 4, weight: 0.65, lagMs: 120, freq: 5.2)
    ]

    let store: IslandStore

    var body: some View {
        TimelineView(.animation(paused: !store.isPlaying)) { context in
            let nowMs = store.currentPositionMs(at: context.date)
            let reliable = store.rhythm.reliable
            let hdr = store.config.hdr
            let colorHex = store.glow?.color ?? store.accentHex

            HStack(spacing: 2.0) {
                ForEach(Self.specs) { spec in
                    let level: Double = reliable
                        ? store.rhythm.backgroundLevel(timeMs: nowMs - spec.lagMs)
                        : (0.5 + 0.5 * sin(nowMs / 1000.0 * spec.freq + Double(spec.id)))
                    let scale = 0.30 + 0.70 * spec.weight * level
                    let opacity = reliable ? (0.55 + 0.45 * level) : 0.88
                    let gain = hdr ? (1.0 + 0.85 * level) : 1.0

                    Capsule(style: .continuous)
                        .fill(Color.edrCss(colorHex, tint: 1.0, gain: gain, opacity: opacity))
                        .frame(width: 2.0, height: max(4, 15.5 * scale))
                }
            }
            .frame(height: 16)
            .allowedDynamicRange(hdr ? .high : .standard)
        }
    }
}

// MARK: - 支持振假名（上方）+ 逐音节对齐音译（下方 placeRuby 防重叠推距）+ 左/中/右逐行对齐的流式换行 Layout
// 1:1 对应 web/src/lib/lyrics/ruby-layout.ts (placeRuby) 与 lyric-player.ts (layoutRubyUnits)

enum LyricWordSlotRole: Equatable {
    case auto
    case main(unitIndex: Int, intraWord: Bool = false)
    case furigana(unitIndex: Int)
    case ruby(unitIndex: Int, firstPartRatio: CGFloat)
}

private struct LyricWordSlotRoleKey: LayoutValueKey {
    static let defaultValue: LyricWordSlotRole = .auto
}

extension View {
    func lyricWordSlotRole(_ role: LyricWordSlotRole) -> some View {
        layoutValue(key: LyricWordSlotRoleKey.self, value: role)
    }
}

struct WrappingWordFlowLayout: Layout {
    var alignment: HorizontalAlignment = .leading
    var lineSpacing: CGFloat = 2
    var rubyGap: CGFloat = 2.5

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxW = proposal.width ?? .infinity
        let rows = Self.computeRows(maxWidth: maxW, rubyGap: rubyGap, subviews: subviews)
        let width = rows.map(\.width).max() ?? 0
        let totalHeight = rows.enumerated().reduce(CGFloat(0)) { acc, pair in
            acc + pair.element.height + (pair.offset > 0 ? lineSpacing : 0)
        }
        return CGSize(width: width, height: totalHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let rows = Self.computeRows(maxWidth: max(1, bounds.width), rubyGap: rubyGap, subviews: subviews)
        var y = bounds.minY
        for row in rows {
            let startX: CGFloat = {
                switch alignment {
                case .trailing:
                    return bounds.maxX - row.width
                case .center:
                    return bounds.minX + (bounds.width - row.width) * 0.5
                default:
                    return bounds.minX
                }
            }()
            for p in row.placements {
                let mainY = y + row.topBand + (row.mainBand - p.mainSize.height) * 0.5
                subviews[p.mainSubIdx].place(
                    at: CGPoint(x: startX + p.mainX, y: mainY),
                    anchor: .topLeading,
                    proposal: ProposedViewSize(p.mainSize)
                )
                if let fIdx = p.furiSubIdx, let fSize = p.furiSize {
                    let furiY = y + max(0, row.topBand - 1.0 - fSize.height)
                    subviews[fIdx].place(
                        at: CGPoint(x: startX + p.furiX, y: furiY),
                        anchor: .topLeading,
                        proposal: ProposedViewSize(fSize)
                    )
                }
                if let rIdx = p.rubySubIdx, let rSize = p.rubySize {
                    let rubyY = y + row.topBand + row.mainBand + 1.0
                    subviews[rIdx].place(
                        at: CGPoint(x: startX + p.rubyX, y: rubyY),
                        anchor: .topLeading,
                        proposal: ProposedViewSize(rSize)
                    )
                }
            }
            y += row.height + lineSpacing
        }
    }

    private struct MeasuredUnit {
        var mainSubIdx: Int = -1
        var mainSize: CGSize = .zero
        var intraWord: Bool = false
        var furiSubIdx: Int? = nil
        var furiSize: CGSize? = nil
        var rubySubIdx: Int? = nil
        var rubySize: CGSize? = nil
        var firstPartRatio: CGFloat = 1.0
    }

    private struct PlacedUnit {
        let mainSubIdx: Int
        let mainSize: CGSize
        let mainX: CGFloat
        let furiSubIdx: Int?
        let furiSize: CGSize?
        let furiX: CGFloat
        let rubySubIdx: Int?
        let rubySize: CGSize?
        let rubyX: CGFloat
    }

    private struct Row {
        var placements: [PlacedUnit] = []
        var topBand: CGFloat = 0
        var mainBand: CGFloat = 0
        var bottomBand: CGFloat = 0
        var width: CGFloat = 0
        var height: CGFloat { topBand + mainBand + bottomBand }
    }

    private static func computeRows(maxWidth: CGFloat, rubyGap: CGFloat, subviews: Subviews) -> [Row] {
        guard !subviews.isEmpty else { return [] }

        var unitMap: [Int: MeasuredUnit] = [:]
        var orderedUnitIds: [Int] = []
        var autoBase = 1_000_000

        for (sIdx, sub) in subviews.enumerated() {
            let sz = sub.sizeThatFits(.unspecified)
            let role = sub[LyricWordSlotRoleKey.self]
            switch role {
            case .auto:
                let uid = autoBase
                autoBase += 1
                orderedUnitIds.append(uid)
                unitMap[uid] = MeasuredUnit(mainSubIdx: sIdx, mainSize: sz)

            case .main(let uid, let intra):
                if unitMap[uid] == nil {
                    orderedUnitIds.append(uid)
                    unitMap[uid] = MeasuredUnit()
                }
                unitMap[uid]?.mainSubIdx = sIdx
                unitMap[uid]?.mainSize = sz
                unitMap[uid]?.intraWord = intra

            case .furigana(let uid):
                if unitMap[uid] == nil {
                    orderedUnitIds.append(uid)
                    unitMap[uid] = MeasuredUnit()
                }
                unitMap[uid]?.furiSubIdx = sIdx
                unitMap[uid]?.furiSize = sz

            case .ruby(let uid, let ratio):
                if unitMap[uid] == nil {
                    orderedUnitIds.append(uid)
                    unitMap[uid] = MeasuredUnit()
                }
                unitMap[uid]?.rubySubIdx = sIdx
                unitMap[uid]?.rubySize = sz
                unitMap[uid]?.firstPartRatio = max(0.05, min(1.0, ratio))
            }
        }

        let units: [MeasuredUnit] = orderedUnitIds.compactMap { uid in
            guard let u = unitMap[uid], u.mainSubIdx >= 0 else { return nil }
            return u
        }
        guard !units.isEmpty else { return [] }

        var rows: [Row] = [Row()]
        var cursorX: CGFloat = 0
        var previousRubyEnd: CGFloat = -.infinity
        var rowMaxRight: CGFloat = 0

        func evaluatePlacement(for u: MeasuredUnit, at curX: CGFloat, prevRubyEnd: CGFloat, useIntraGap: Bool) -> (placed: PlacedUnit, nextCursorX: CGFloat, nextRubyEnd: CGFloat, rightExtent: CGFloat) {
            let charW = u.mainSize.width
            let furiW = u.furiSize?.width ?? 0
            let furiPad = u.furiSize != nil ? max(0, (furiW - charW) * 0.5) : 0

            var shift: CGFloat = 0
            var rubyX: CGFloat = 0
            var nextRuby = prevRubyEnd
            var rubyRight: CGFloat = 0

            if let rSize = u.rubySize, rSize.width > 0 {
                let firstW = rSize.width * u.firstPartRatio
                let offset = (charW - firstW) * 0.5
                let rawStart = curX + furiPad + offset
                let effectiveGap = useIntraGap ? rubyGap * 0.15 : rubyGap
                // 对齐 ruby-layout.ts placeRuby：首音拍居中于底字，词内子音节采用紧凑间距避免撑裂单词
                shift = max(0, max(-rawStart, prevRubyEnd + effectiveGap - rawStart))
                rubyX = curX + shift + furiPad + offset
                rubyRight = rubyX + rSize.width
                nextRuby = rubyRight
            }

            let unitLeft = curX + shift
            let mainX = unitLeft + furiPad
            let furiX = mainX + (charW - furiW) * 0.5
            let nextCur = unitLeft + furiPad + charW + furiPad
            let extent = max(nextCur, rubyRight)

            let placed = PlacedUnit(
                mainSubIdx: u.mainSubIdx,
                mainSize: u.mainSize,
                mainX: mainX,
                furiSubIdx: u.furiSubIdx,
                furiSize: u.furiSize,
                furiX: furiX,
                rubySubIdx: u.rubySubIdx,
                rubySize: u.rubySize,
                rubyX: rubyX
            )
            return (placed, nextCur, nextRuby, extent)
        }

        // 将同属一个未断开外语多音节单词内部的连续子音节归为整词串，防止在词中腰斩断行（如 beneath 断成 benea / th）
        var wordRuns: [[MeasuredUnit]] = []
        for u in units {
            if u.intraWord, !wordRuns.isEmpty {
                wordRuns[wordRuns.count - 1].append(u)
            } else {
                wordRuns.append([u])
            }
        }

        func evaluateRun(_ run: [MeasuredUnit], startX: CGFloat, startPrevRubyEnd: CGFloat) -> (placements: [PlacedUnit], nextCursorX: CGFloat, nextRubyEnd: CGFloat, maxExtent: CGFloat) {
            var curX = startX
            var prevRuby = startPrevRubyEnd
            var maxExt: CGFloat = 0
            var list: [PlacedUnit] = []
            list.reserveCapacity(run.count)
            for (idxInRun, u) in run.enumerated() {
                let cand = evaluatePlacement(for: u, at: curX, prevRubyEnd: prevRuby, useIntraGap: idxInRun > 0 && u.intraWord)
                list.append(cand.placed)
                curX = cand.nextCursorX
                prevRuby = cand.nextRubyEnd
                maxExt = max(maxExt, cand.rightExtent)
            }
            return (list, curX, prevRuby, maxExt)
        }

        func appendUnitToRow(_ u: MeasuredUnit, placed: PlacedUnit, nextCur: CGFloat, nextRuby: CGFloat, extent: CGFloat) {
            let rIdx = rows.count - 1
            rows[rIdx].placements.append(placed)
            rows[rIdx].mainBand = max(rows[rIdx].mainBand, u.mainSize.height)
            if let fSize = u.furiSize, fSize.height > 0 {
                rows[rIdx].topBand = max(rows[rIdx].topBand, fSize.height + 1.0)
            }
            if let rSize = u.rubySize, rSize.height > 0 {
                rows[rIdx].bottomBand = max(rows[rIdx].bottomBand, rSize.height + 1.0)
            }
            cursorX = nextCur
            previousRubyEnd = nextRuby
            rowMaxRight = max(rowMaxRight, extent)
            rows[rIdx].width = rowMaxRight
        }

        for run in wordRuns {
            var runCandidate = evaluateRun(run, startX: cursorX, startPrevRubyEnd: previousRubyEnd)
            if !rows[rows.count - 1].placements.isEmpty && runCandidate.maxExtent > maxWidth + 0.5 {
                rows[rows.count - 1].width = rowMaxRight
                rows.append(Row())
                cursorX = 0
                previousRubyEnd = -.infinity
                rowMaxRight = 0
                runCandidate = evaluateRun(run, startX: 0, startPrevRubyEnd: -.infinity)
            }
            // 极端兜底：单个超长词本身超过整行宽度时退回逐音节换行
            if run.count > 1 && runCandidate.maxExtent > maxWidth + 0.5 {
                for (idxInRun, u) in run.enumerated() {
                    var cand = evaluatePlacement(for: u, at: cursorX, prevRubyEnd: previousRubyEnd, useIntraGap: idxInRun > 0 && u.intraWord && cursorX > 0)
                    if !rows[rows.count - 1].placements.isEmpty && cand.rightExtent > maxWidth + 0.5 {
                        rows[rows.count - 1].width = rowMaxRight
                        rows.append(Row())
                        cursorX = 0
                        previousRubyEnd = -.infinity
                        rowMaxRight = 0
                        cand = evaluatePlacement(for: u, at: 0, prevRubyEnd: -.infinity, useIntraGap: false)
                    }
                    appendUnitToRow(u, placed: cand.placed, nextCur: cand.nextCursorX, nextRuby: cand.nextRubyEnd, extent: cand.rightExtent)
                }
                continue
            }

            let rIdx = rows.count - 1
            for (idxInRun, u) in run.enumerated() {
                rows[rIdx].placements.append(runCandidate.placements[idxInRun])
                rows[rIdx].mainBand = max(rows[rIdx].mainBand, u.mainSize.height)
                if let fSize = u.furiSize, fSize.height > 0 {
                    rows[rIdx].topBand = max(rows[rIdx].topBand, fSize.height + 1.0)
                }
                if let rSize = u.rubySize, rSize.height > 0 {
                    rows[rIdx].bottomBand = max(rows[rIdx].bottomBand, rSize.height + 1.0)
                }
            }
            cursorX = runCandidate.nextCursorX
            previousRubyEnd = runCandidate.nextRubyEnd
            rowMaxRight = max(rowMaxRight, runCandidate.maxExtent)
            rows[rIdx].width = rowMaxRight
        }

        return rows
    }
}

// MARK: - 统一逐词羽化横向扫光遮罩（1:1 对齐 lyric-player.ts paintWords：主词、振假名与逐字音译共用 0.5em 丝滑擦除）

private struct FeatheredWordWipeModifier: ViewModifier {
    let wordStart: Double
    let wordEnd: Double
    let fontSize: CGFloat
    let bleedEm: CGFloat
    let peakGain: Double
    let hdrEnabled: Bool
    var activeBlend: Double = 1.0
    let nowMs: Double

    func body(content: Content) -> some View {
        let shiftedMs = nowMs + LyricSpecs.animationHeadstartMs
        let dur = max(1, wordEnd - wordStart)
        let progress: Double = wordEnd <= wordStart
            ? (shiftedMs >= wordStart ? 1.0 : 0.0)
            : min(1.0, max(0.0, (shiftedMs - wordStart) / dur))

        let inactiveDim = Color.hdrMaskDimAlpha(baseDimAlpha: LyricSpecs.inactiveAlpha, gain: 1.0, hdrEnabled: hdrEnabled)
        let rightDimAlpha = Color.hdrMaskDimAlpha(
            baseDimAlpha: LyricSpecs.inactiveAlpha,
            gain: progress > 0 ? peakGain : 1.0,
            hdrEnabled: hdrEnabled
        )
        let sungExitAlpha = inactiveDim + (1.0 - inactiveDim) * activeBlend
        let bleed = fontSize * bleedEm

        if progress <= 0 {
            content
                .opacity(inactiveDim)
        } else if progress >= 0.999 {
            if activeBlend >= 0.999 {
                content
            } else {
                content
                    .opacity(sungExitAlpha)
            }
        } else {
            let leftStopAlpha = activeBlend >= 0.999 ? 1.0 : sungExitAlpha
            content
                .padding(bleed)
                .mask {
                    GeometryReader { geo in
                        let totalW = max(1, geo.size.width)
                        let innerW = max(1, totalW - bleed * 2)
                        let featherPx = CGFloat(LyricSpecs.featherEm) * fontSize
                        let x = bleed + CGFloat(progress) * (innerW + featherPx)
                        let leftStop = max(0, min(1, (x - featherPx) / totalW))
                        let rightStop = max(leftStop + 0.001, min(1, x / totalW))
                        LinearGradient(
                            stops: [
                                .init(color: .black.opacity(leftStopAlpha), location: 0),
                                .init(color: .black.opacity(leftStopAlpha), location: leftStop),
                                .init(color: .black.opacity(rightDimAlpha), location: rightStop),
                                .init(color: .black.opacity(rightDimAlpha), location: 1)
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    }
                }
                .padding(-bleed)
        }
    }
}

// MARK: - 展开态非激活行静态排版视图（0Hz 无 TimelineView，复用同一套 WrappingWordFlowLayout 与强调字形保证激活进出 0px 0 亮度差跳变）

struct StaticStageLyricLineView: View {
    let line: LyricLinePayload
    let lineKeyPrefix: String
    let songFont: String?
    let wordSynced: Bool
    var showEffects: Bool = true
    let showRomaji: Bool
    var hdrEnabled: Bool = false
    var isUserScrolling: Bool = false
    let fontSize: CGFloat
    let wrapAlignment: HorizontalAlignment

    var body: some View {
        let rawBaseAlpha: Double = {
            if isUserScrolling {
                return wordSynced ? 0.55 : 0.45
            }
            return wordSynced ? LyricSpecs.inactiveAlpha : LyricSpecs.inactiveAlphaLineTimed
        }()
        let baseAlpha = rawBaseAlpha * (hdrEnabled ? 0.6 : 1.0)
        let defaultFont = LyricFontResolver.swiftUIFont(key: songFont, size: fontSize, bold: false)
        let hasAlignedRomaji = showRomaji && !line.romanizationWords.isEmpty
        let hasEmphasisStyle = showEffects && !line.emphasis.isEmpty
        let needsUnitFlow = wordSynced && !line.words.isEmpty && (line.hasFurigana || hasAlignedRomaji || hasEmphasisStyle)

        if !needsUnitFlow {
            let textAlign: TextAlignment = wrapAlignment == .trailing ? .trailing : (wrapAlignment == .center ? .center : .leading)
            Text(line.plainText)
                .font(defaultFont)
                .foregroundStyle(.white.opacity(baseAlpha))
                .lineLimit(4)
                .multilineTextAlignment(textAlign)
        } else {
            let furiFontSize = fontSize * 0.42
            let rubyFontSize = max(fontSize * 0.58, 10.0)
            let romanByWord = Dictionary(grouping: line.romanizationWords, by: \.word)

            WrappingWordFlowLayout(alignment: wrapAlignment, lineSpacing: 2, rubyGap: rubyFontSize * 0.25) {
                ForEach(Array(line.words.enumerated()), id: \.offset) { wIdx, word in
                    let matchedGroup = hasEmphasisStyle
                        ? line.emphasis.first(where: { wIdx >= $0.from && wIdx < $0.to })
                        : nil
                    let wordBold = matchedGroup.map { $0.styles.contains("bold") || $0.factor > 0 } ?? false
                    let wordItalic = matchedGroup?.styles.contains("italic") ?? false
                    let wordFont = matchedGroup != nil
                        ? LyricFontResolver.swiftUIFont(key: matchedGroup?.font ?? songFont, size: fontSize, bold: wordBold)
                        : defaultFont
                    let baseWordText = Text(word.text).font(wordFont)
                    let styledWordText = wordItalic ? baseWordText.italic() : baseWordText

                    let isIntra = wIdx > 0 && RomanizationAligner.isIntraWordJoin(prevText: line.words[wIdx - 1].text, curText: word.text)
                    styledWordText
                        .foregroundStyle(.white.opacity(baseAlpha))
                        .lyricWordSlotRole(.main(unitIndex: wIdx, intraWord: isIntra))

                    if let furiList = word.ruby, !furiList.isEmpty {
                        Text(furiList.map(\.text).joined())
                            .font(.system(size: furiFontSize, weight: .semibold))
                            .foregroundStyle(.white.opacity(baseAlpha * 0.72))
                            .lyricWordSlotRole(.furigana(unitIndex: wIdx))
                    }

                    if hasAlignedRomaji, let rParts = romanByWord[wIdx], !rParts.isEmpty {
                        let joined = rParts.map(\.text).joined()
                        let firstLen = max(1, rParts[0].text.count)
                        let totalLen = max(1, joined.count)
                        let ratio = CGFloat(firstLen) / CGFloat(totalLen)

                        Text(joined)
                            .font(.system(size: rubyFontSize, weight: .semibold))
                            .foregroundStyle(.white.opacity(baseAlpha * 0.75))
                            .lyricWordSlotRole(.ruby(unitIndex: wIdx, firstPartRatio: ratio))
                    }
                }
            }
        }
    }
}

// MARK: - 全特性逐字歌词行渲染器（7 套字体 + 9 种 AI 强调特效 + 上方振假名与下方逐音节音译同步擦除 & 强调联动 + 连续跨行退场与原生 EDR）

struct LyricLineSweepView: View {
    let line: LyricLinePayload
    let lineKeyPrefix: String
    let songFont: String?
    var songMotion: String? = nil
    let wordSynced: Bool
    let showEffects: Bool
    var showRomaji: Bool = false
    let hdrEnabled: Bool
    let rhythm: RhythmEngineContext
    let seekAtMs: Double
    let debrisEngine: DebrisEngine
    let nowMs: Double
    let fontSize: CGFloat
    let isBackground: Bool
    var allowsWrapping: Bool = false
    var wrapAlignment: HorizontalAlignment = .leading
    var spotlightLevel: Double = 0
    var activeBlend: Double = 1.0

    var body: some View {
        let defaultFont = LyricFontResolver.swiftUIFont(key: songFont, size: fontSize, bold: false)
        let clampedSpot = min(1.0, max(0.0, spotlightLevel))
        let clampedBlend = min(1.0, max(0.0, activeBlend))

        if !wordSynced || line.words.isEmpty {
            let inTimeWindow = nowMs >= line.start && nowMs < line.end + 400
            let effBlend = allowsWrapping ? clampedBlend : (inTimeWindow ? 1.0 : 0.0)
            let fullGain = 1.35 + (1.85 - 1.35) * clampedSpot
            let gain = hdrEnabled ? (1.0 + (fullGain - 1.0) * effBlend) : 1.0
            let inactiveAlpha = LyricSpecs.inactiveAlphaLineTimed * (hdrEnabled ? 0.6 : 1.0)
            let lineOpacity = inactiveAlpha + (0.98 - inactiveAlpha) * effBlend
            let textAlign: TextAlignment = wrapAlignment == .trailing ? .trailing : (wrapAlignment == .center ? .center : .leading)
            Text(line.plainText)
                .font(defaultFont)
                .foregroundStyle(Color.edrCss("#ffffff", tint: 0, gain: gain, opacity: lineOpacity))
                .lineLimit(allowsWrapping ? 4 : 1)
                .multilineTextAlignment(textAlign)
                .fixedSize(horizontal: !allowsWrapping, vertical: false)
                .allowedDynamicRange(hdrEnabled && effBlend > 0.005 ? .high : .standard)
        } else {
            let includeRuby = allowsWrapping
            let units = Self.buildWordUnits(
                line: line,
                prefix: lineKeyPrefix,
                showEffects: showEffects,
                includeFurigana: includeRuby,
                includeRomaji: includeRuby && showRomaji
            )
            let rubyFontSize = max(fontSize * 0.58, 10.0)
            let furiFontSize = fontSize * 0.42

            if allowsWrapping {
                WrappingWordFlowLayout(alignment: wrapAlignment, lineSpacing: 2, rubyGap: rubyFontSize * 0.25) {
                    ForEach(units) { unit in
                        LyricWordUnitView(
                            unit: unit,
                            defaultFont: defaultFont,
                            lineEnd: line.end,
                            songFont: songFont,
                            songMotion: songMotion,
                            fontSize: fontSize,
                            isBackground: isBackground,
                            hdrEnabled: hdrEnabled,
                            spotlightLevel: clampedSpot,
                            activeBlend: clampedBlend,
                            rhythm: rhythm,
                            seekAtMs: seekAtMs,
                            debrisEngine: debrisEngine,
                            nowMs: nowMs
                        )
                        .lyricWordSlotRole(.main(unitIndex: unit.wordIndex, intraWord: unit.intraWord))

                        if !unit.furigana.isEmpty {
                            FuriganaGroupSweepView(
                                items: unit.furigana,
                                prefix: unit.id,
                                fontSize: furiFontSize,
                                hdrEnabled: hdrEnabled,
                                spotlightLevel: clampedSpot,
                                activeBlend: clampedBlend,
                                nowMs: nowMs
                            )
                            .lyricWordSlotRole(.furigana(unitIndex: unit.wordIndex))
                        }

                        if !unit.romanParts.isEmpty {
                            RubyRomanGroupSweepView(
                                parts: unit.romanParts,
                                lineEnd: line.end,
                                songFont: songFont,
                                fontSize: rubyFontSize,
                                isBackground: isBackground,
                                hdrEnabled: hdrEnabled,
                                spotlightLevel: clampedSpot,
                                activeBlend: clampedBlend,
                                rhythm: rhythm,
                                seekAtMs: seekAtMs,
                                debrisEngine: debrisEngine,
                                nowMs: nowMs
                            )
                            .lyricWordSlotRole(.ruby(unitIndex: unit.wordIndex, firstPartRatio: unit.firstRomanRatio))
                        }
                    }
                }
            } else {
                HStack(spacing: 0) {
                    ForEach(units) { unit in
                        LyricWordUnitView(
                            unit: unit,
                            defaultFont: defaultFont,
                            lineEnd: line.end,
                            songFont: songFont,
                            songMotion: songMotion,
                            fontSize: fontSize,
                            isBackground: isBackground,
                            hdrEnabled: hdrEnabled,
                            spotlightLevel: clampedSpot,
                            activeBlend: 1.0,
                            rhythm: rhythm,
                            seekAtMs: seekAtMs,
                            debrisEngine: debrisEngine,
                            nowMs: nowMs
                        )
                    }
                }
                .fixedSize(horizontal: true, vertical: false)
            }
        }
    }

    struct CharSlice: Identifiable {
        let id: String
        let globalIndex: Int
        let char: String
        let start: Double
        let end: Double
    }

    struct FuriganaItem: Identifiable {
        let id: String
        let payload: LyricRubyPayload
    }

    struct RomanPartUnit: Identifiable {
        enum Kind {
            case plain(LyricWordPayload)
            case emphasized(LyricEmphasisPayload, LyricWordPayload, Int, [CharSlice])
        }
        let id: String
        let kind: Kind
    }

    struct WordUnit: Identifiable {
        enum Kind {
            case plain(LyricWordPayload)
            case emphasized(LyricEmphasisPayload, LyricWordPayload, Int, [CharSlice])
        }
        let id: String
        let wordIndex: Int
        let intraWord: Bool
        let kind: Kind
        let furigana: [FuriganaItem]
        let romanParts: [RomanPartUnit]
        let firstRomanRatio: CGFloat
    }

    private static func buildWordUnits(
        line: LyricLinePayload,
        prefix: String,
        showEffects: Bool,
        includeFurigana: Bool,
        includeRomaji: Bool
    ) -> [WordUnit] {
        let romanByWord: [Int: [LyricRomanWordPayload]] = includeRomaji
            ? Dictionary(grouping: line.romanizationWords, by: \.word)
            : [:]

        func makeFurigana(for wIdx: Int, word: LyricWordPayload) -> [FuriganaItem] {
            guard includeFurigana, let list = word.ruby, !list.isEmpty else { return [] }
            return list.enumerated().map { fi, r in
                FuriganaItem(id: "\(prefix)-f-\(wIdx)-\(fi)", payload: r)
            }
        }

        func calcFirstRatio(_ parts: [LyricRomanWordPayload]) -> CGFloat {
            guard let first = parts.first else { return 1.0 }
            let firstLen = max(1, first.text.count)
            let totalLen = max(1, parts.reduce(0) { $0 + $1.text.count })
            return CGFloat(firstLen) / CGFloat(totalLen)
        }

        guard showEffects, !line.emphasis.isEmpty else {
            return line.words.enumerated().map { idx, w in
                let rList = romanByWord[idx] ?? []
                let romanUnits: [RomanPartUnit] = rList.enumerated().map { ri, rw in
                    RomanPartUnit(
                        id: "\(prefix)-rp-\(idx)-\(ri)",
                        kind: .plain(LyricWordPayload(text: rw.text, start: rw.start, end: rw.end))
                    )
                }
                return WordUnit(
                    id: "\(prefix)-p-\(idx)",
                    wordIndex: idx,
                    intraWord: idx > 0 && RomanizationAligner.isIntraWordJoin(prevText: line.words[idx - 1].text, curText: w.text),
                    kind: .plain(w),
                    furigana: makeFurigana(for: idx, word: w),
                    romanParts: romanUnits,
                    firstRomanRatio: calcFirstRatio(rList)
                )
            }
        }

        var out: [WordUnit] = []
        var i = 0
        let n = line.words.count
        while i < n {
            if let (gIdx, group) = line.emphasis.enumerated().first(where: { $0.element.from == i && $0.element.to > i }) {
                let endIdx = min(n, group.to)
                var totalChars = 0
                var totalRubyChars = 0
                for wIdx in i..<endIdx {
                    totalChars += max(1, line.words[wIdx].text.count)
                    if includeRomaji, let rList = romanByWord[wIdx] {
                        for rw in rList {
                            totalRubyChars += max(1, rw.text.count)
                        }
                    }
                }
                var globalCursor = 0
                var rubyGlobalCursor = 0
                for wIdx in i..<endIdx {
                    let w = line.words[wIdx]
                    let chars = Array(w.text)
                    let cCount = max(1, chars.count)
                    var slices: [CharSlice] = []
                    slices.reserveCapacity(cCount)
                    for (ci, ch) in chars.enumerated() {
                        let s = w.start + (w.end - w.start) * Double(ci) / Double(cCount)
                        let e = w.start + (w.end - w.start) * Double(ci + 1) / Double(cCount)
                        slices.append(
                            CharSlice(
                                id: "\(prefix)-e\(gIdx)-c\(globalCursor)",
                                globalIndex: globalCursor,
                                char: String(ch),
                                start: s,
                                end: e
                            )
                        )
                        globalCursor += 1
                    }

                    // 对齐 lyric-player.ts rubyEmphasis：强调音节正下方的逐字音译拆成单字，继承该强调组的字体、颜色与逐字动效同步演出
                    let rList = romanByWord[wIdx] ?? []
                    let romanUnits: [RomanPartUnit] = rList.enumerated().map { ri, rw in
                        let rChars = Array(rw.text)
                        let rcCount = max(1, rChars.count)
                        var rSlices: [CharSlice] = []
                        rSlices.reserveCapacity(rcCount)
                        for (rci, rch) in rChars.enumerated() {
                            let rs = rw.start + (rw.end - rw.start) * Double(rci) / Double(rcCount)
                            let re = rw.start + (rw.end - rw.start) * Double(rci + 1) / Double(rcCount)
                            rSlices.append(
                                CharSlice(
                                    id: "\(prefix)-re\(gIdx)-c\(rubyGlobalCursor)",
                                    globalIndex: rubyGlobalCursor,
                                    char: String(rch),
                                    start: rs,
                                    end: re
                                )
                            )
                            rubyGlobalCursor += 1
                        }
                        let rwWord = LyricWordPayload(text: rw.text, start: rw.start, end: rw.end)
                        return RomanPartUnit(
                            id: "\(prefix)-re\(gIdx)-w\(wIdx)-\(ri)",
                            kind: .emphasized(group, rwWord, max(1, totalRubyChars), rSlices)
                        )
                    }

                    out.append(
                        WordUnit(
                            id: "\(prefix)-e\(gIdx)-w\(wIdx)",
                            wordIndex: wIdx,
                            intraWord: wIdx > 0 && RomanizationAligner.isIntraWordJoin(prevText: line.words[wIdx - 1].text, curText: w.text),
                            kind: .emphasized(group, w, max(1, totalChars), slices),
                            furigana: makeFurigana(for: wIdx, word: w),
                            romanParts: romanUnits,
                            firstRomanRatio: calcFirstRatio(rList)
                        )
                    )
                }
                i = endIdx
            } else {
                let w = line.words[i]
                let rList = romanByWord[i] ?? []
                let romanUnits: [RomanPartUnit] = rList.enumerated().map { ri, rw in
                    RomanPartUnit(
                        id: "\(prefix)-rp-\(i)-\(ri)",
                        kind: .plain(LyricWordPayload(text: rw.text, start: rw.start, end: rw.end))
                    )
                }
                out.append(
                    WordUnit(
                        id: "\(prefix)-p-\(i)",
                        wordIndex: i,
                        intraWord: i > 0 && RomanizationAligner.isIntraWordJoin(prevText: line.words[i - 1].text, curText: w.text),
                        kind: .plain(w),
                        furigana: makeFurigana(for: i, word: w),
                        romanParts: romanUnits,
                        firstRomanRatio: calcFirstRatio(rList)
                    )
                )
                i += 1
            }
        }
        return out
    }
}

// MARK: - 日文汉字上方逐假名擦除组（1:1 对应 lyric-player.ts .lyric-furigana）

private struct FuriganaGroupSweepView: View {
    let items: [LyricLineSweepView.FuriganaItem]
    let prefix: String
    let fontSize: CGFloat
    let hdrEnabled: Bool
    let spotlightLevel: Double
    let activeBlend: Double
    let nowMs: Double

    var body: some View {
        let font = Font.system(size: fontSize, weight: .semibold)
        HStack(spacing: 0) {
            ForEach(items) { item in
                PlainWordSpanView(
                    word: LyricWordPayload(text: item.payload.text, start: item.payload.start, end: item.payload.end),
                    font: font,
                    fontSize: fontSize,
                    isBackground: false,
                    hdrEnabled: hdrEnabled,
                    spotlightLevel: spotlightLevel,
                    activeBlend: activeBlend,
                    allowsFloat: false,
                    nowMs: nowMs
                )
            }
        }
        .opacity(0.72)
    }
}

// MARK: - 音节下方逐段音译擦除组（1:1 对应 lyric-player.ts .lyric-ruby + rubyEmphasis）

private struct RubyRomanGroupSweepView: View {
    let parts: [LyricLineSweepView.RomanPartUnit]
    let lineEnd: Double
    let songFont: String?
    let fontSize: CGFloat
    let isBackground: Bool
    let hdrEnabled: Bool
    let spotlightLevel: Double
    let activeBlend: Double
    let rhythm: RhythmEngineContext
    let seekAtMs: Double
    let debrisEngine: DebrisEngine
    let nowMs: Double

    var body: some View {
        let plainFont = Font.system(size: fontSize, weight: .semibold)
        HStack(spacing: 0) {
            ForEach(parts) { part in
                ZStack {
                    switch part.kind {
                    case .plain(let word):
                        PlainWordSpanView(
                            word: word,
                            font: plainFont,
                            fontSize: fontSize,
                            isBackground: isBackground,
                            hdrEnabled: hdrEnabled,
                            spotlightLevel: spotlightLevel,
                            activeBlend: activeBlend,
                            allowsFloat: false,
                            nowMs: nowMs
                        )
                    case .emphasized(let group, let word, let groupCharCount, let slices):
                        EmphasizedWordSpanView(
                            wordKey: part.id,
                            group: group,
                            word: word,
                            groupCharCount: groupCharCount,
                            charSlices: slices,
                            lineEnd: lineEnd,
                            songFont: songFont,
                            songMotion: nil,
                            fontSize: fontSize,
                            isBackground: isBackground,
                            hdrEnabled: hdrEnabled,
                            spotlightLevel: spotlightLevel,
                            activeBlend: activeBlend,
                            allowsFloat: false,
                            allowsDebris: false,
                            rhythm: rhythm,
                            seekAtMs: seekAtMs,
                            debrisEngine: debrisEngine,
                            nowMs: nowMs
                        )
                    }
                }
            }
        }
        .opacity(0.75)
    }
}

/// 单根容器（Unary View）包装词节点，保证 ForEach 结构恒定（遵循 swiftui-expert-skill list-patterns）
private struct LyricWordUnitView: View {
    let unit: LyricLineSweepView.WordUnit
    let defaultFont: Font
    let lineEnd: Double
    let songFont: String?
    var songMotion: String? = nil
    let fontSize: CGFloat
    let isBackground: Bool
    let hdrEnabled: Bool
    let spotlightLevel: Double
    let activeBlend: Double
    let rhythm: RhythmEngineContext
    let seekAtMs: Double
    let debrisEngine: DebrisEngine
    let nowMs: Double

    var body: some View {
        ZStack {
            switch unit.kind {
            case .plain(let word):
                PlainWordSpanView(
                    word: word,
                    font: defaultFont,
                    fontSize: fontSize,
                    isBackground: isBackground,
                    hdrEnabled: hdrEnabled,
                    songMotion: songMotion,
                    spotlightLevel: spotlightLevel,
                    activeBlend: activeBlend,
                    allowsFloat: true,
                    nowMs: nowMs
                )

            case .emphasized(let group, let word, let groupCharCount, let charSlices):
                EmphasizedWordSpanView(
                    wordKey: unit.id,
                    group: group,
                    word: word,
                    groupCharCount: groupCharCount,
                    charSlices: charSlices,
                    lineEnd: lineEnd,
                    songFont: songFont,
                    songMotion: songMotion,
                    fontSize: fontSize,
                    isBackground: isBackground,
                    hdrEnabled: hdrEnabled,
                    spotlightLevel: spotlightLevel,
                    activeBlend: activeBlend,
                    allowsFloat: true,
                    allowsDebris: true,
                    rhythm: rhythm,
                    seekAtMs: seekAtMs,
                    debrisEngine: debrisEngine,
                    nowMs: nowMs
                )
            }
        }
    }
}

private struct PlainWordSpanView: View {
    let word: LyricWordPayload
    let font: Font
    let fontSize: CGFloat
    let isBackground: Bool
    let hdrEnabled: Bool
    var songMotion: String? = nil
    var spotlightLevel: Double = 0
    var activeBlend: Double = 1.0
    var allowsFloat: Bool = true
    let nowMs: Double

    var body: some View {
        let shiftedMs = nowMs + LyricSpecs.animationHeadstartMs
        let dur = max(1, word.end - word.start)
        let progress = word.end <= word.start
            ? (shiftedMs >= word.start ? 1.0 : 0.0)
            : min(1.0, max(0.0, (shiftedMs - word.start) / dur))
        let liftBlend = min(1.0, max(0.0, activeBlend * 1.85))
        let motionPreset = songMotion.flatMap(LyricMotionPreset.init(rawValue:))
        let effWordFloatEm = motionPreset?.wordFloatEm ?? LyricSpecs.wordFloatEm
        let effBounceBell = motionPreset?.bounceBell ?? 0.0
        let floatPx = allowsFloat ? (effWordFloatEm * Double(fontSize) * (isBackground ? 2.0 : 1.0)) : 0
        let liftCurve = CubicBezier.easeOut.eval(progress) + (effBounceBell > 0 ? Foundation.sin(progress * .pi) * effBounceBell : 0.0)
        let dy = (allowsFloat && progress > 0 && liftBlend > 0)
            ? CGFloat(-floatPx * liftCurve * liftBlend)
            : 0
        let fullPeakGain = 1.32 + (1.78 - 1.32) * spotlightLevel
        let peakGain = hdrEnabled ? (1.0 + (fullPeakGain - 1.0) * activeBlend) : 1.0
        let activeWhite = Color.edrCss("#ffffff", tint: 0, gain: progress > 0 ? peakGain : 1.0)

        Text(word.text)
            .font(font)
            .foregroundStyle(activeWhite)
            .modifier(
                FeatheredWordWipeModifier(
                    wordStart: word.start,
                    wordEnd: word.end,
                    fontSize: fontSize,
                    bleedEm: 0.16,
                    peakGain: peakGain,
                    hdrEnabled: hdrEnabled,
                    activeBlend: activeBlend,
                    nowMs: nowMs
                )
            )
            .offset(y: dy)
            .allowedDynamicRange(hdrEnabled && progress > 0 && activeBlend > 0.005 ? .high : .standard)
    }
}

private struct EmphasizedWordSpanView: View {
    let wordKey: String
    let group: LyricEmphasisPayload
    let word: LyricWordPayload
    let groupCharCount: Int
    let charSlices: [LyricLineSweepView.CharSlice]
    let lineEnd: Double
    let songFont: String?
    var songMotion: String? = nil
    let fontSize: CGFloat
    let isBackground: Bool
    let hdrEnabled: Bool
    let spotlightLevel: Double
    let activeBlend: Double
    var allowsFloat: Bool = true
    let allowsDebris: Bool
    let rhythm: RhythmEngineContext
    let seekAtMs: Double
    let debrisEngine: DebrisEngine
    let nowMs: Double

    var body: some View {
        let count = max(1, groupCharCount)
        let f = group.factor
        let pace = rhythm.nearestFixedPace
        let duration = max(LyricSpecs.emphasisMinMs, group.end - group.start) * rhythm.envelopeScale
        let isWave = group.effect == "wave"
        let stagger = (duration * (isWave ? (1.0 / 1.5) : LyricSpecs.emphasisStaggerRatio)) / Double(count)

        let holdState: HoldVibratoState? = (group.effect == "shake" && group.hold != nil)
            ? LyricWordEffects.holdVibrato(start: group.hold!.start, end: group.hold!.end, timeMs: nowMs, pace: pace)
            : nil
        let shineCenter: Double? = group.effect == "shimmer"
            ? rhythm.shimmerCenter(start: group.start, timeMs: nowMs, count: count)
            : nil
        let beatVal: Double = group.effect == "heartbeat"
            ? rhythm.heartbeatLevel(start: group.start, end: group.end, timeMs: nowMs)
            : 0
        let accentVal: Double = group.effect == "swell"
            ? rhythm.swellAccent(start: group.start, timeMs: nowMs)
            : 0
        let breathVal: (gate: Double, y: Double)? = group.effect == "glow"
            ? rhythm.glowLevel(start: group.start, lineEnd: max(lineEnd, group.end), timeMs: nowMs)
            : nil
        let waveVals: [Double]? = isWave
            ? rhythm.waveLevels(start: group.start, end: group.end, count: count, timeMs: nowMs)
            : nil
        let kickVal: Double = (group.effect == "shake" && holdState == nil)
            ? rhythm.shakeLevel(start: group.start, until: group.start + duration, timeMs: nowMs)
            : 0

        let isBold = group.styles.contains("bold") || f > 0
        let isItalic = group.styles.contains("italic")
        let isUnderlined = group.styles.contains("underline")
        let resolvedFont = LyricFontResolver.swiftUIFont(key: group.font ?? songFont, size: fontSize, bold: isBold)
        let shatterFlash = group.effect == "shatter" ? LyricWordEffects.shatterFlash(end: group.end, timeMs: nowMs) : 0
        let fullWordPeakGain = 1.55 + (1.88 - 1.55) * spotlightLevel
        let wordPeakGain = hdrEnabled ? (1.0 + (fullWordPeakGain - 1.0) * activeBlend) : 1.0
        let shiftedWordMs = nowMs + LyricSpecs.animationHeadstartMs
        let wordWipeStarted = word.end <= word.start ? (shiftedWordMs >= word.start) : (shiftedWordMs > word.start)
        let needsDebrisGeometry = allowsDebris && (group.effect == "dissolve" || group.effect == "shatter") && f > 0

        HStack(spacing: 0) {
            ForEach(charSlices) { slice in
                let gi = slice.globalIndex
                if needsDebrisGeometry {
                    DebrisEmphasisCharWrapper(
                        charKey: slice.id,
                        slice: slice,
                        charIndex: gi,
                        count: count,
                        group: group,
                        duration: duration,
                        stagger: stagger,
                        pace: pace,
                        holdState: holdState,
                        shineCenter: shineCenter,
                        beatVal: beatVal,
                        accentVal: accentVal,
                        breathVal: breathVal,
                        riseVal: (waveVals != nil && gi < waveVals!.count) ? waveVals![gi] : 0,
                        kickVal: kickVal,
                        font: resolvedFont,
                        songMotion: songMotion,
                        fontSize: fontSize,
                        isBackground: isBackground,
                        isItalic: isItalic,
                        isUnderlined: isUnderlined,
                        hdrEnabled: hdrEnabled,
                        wordWipeStarted: wordWipeStarted,
                        spotlightLevel: spotlightLevel,
                        activeBlend: activeBlend,
                        allowsFloat: allowsFloat,
                        rhythm: rhythm,
                        seekAtMs: seekAtMs,
                        debrisEngine: debrisEngine,
                        nowMs: nowMs
                    )
                } else {
                    EmphasisCharGlyphView(
                        slice: slice,
                        charIndex: gi,
                        count: count,
                        group: group,
                        duration: duration,
                        stagger: stagger,
                        pace: pace,
                        holdState: holdState,
                        shineCenter: shineCenter,
                        beatVal: beatVal,
                        accentVal: accentVal,
                        breathVal: breathVal,
                        riseVal: (waveVals != nil && gi < waveVals!.count) ? waveVals![gi] : 0,
                        kickVal: kickVal,
                        font: resolvedFont,
                        songMotion: songMotion,
                        fontSize: fontSize,
                        isBackground: isBackground,
                        isItalic: isItalic,
                        isUnderlined: isUnderlined,
                        hdrEnabled: hdrEnabled,
                        wordWipeStarted: wordWipeStarted,
                        spotlightLevel: spotlightLevel,
                        activeBlend: activeBlend,
                        allowsFloat: allowsFloat,
                        rhythm: rhythm,
                        dissolveAmount: 0,
                        shatterCrack: 0,
                        shatterAmount: 0,
                        nowMs: nowMs
                    )
                }
            }
        }
        .modifier(
            FeatheredWordWipeModifier(
                wordStart: word.start,
                wordEnd: word.end,
                fontSize: fontSize,
                bleedEm: 0.34,
                peakGain: wordPeakGain,
                hdrEnabled: hdrEnabled,
                activeBlend: activeBlend,
                nowMs: nowMs
            )
        )
        .background {
            if shatterFlash > 0.02 {
                Capsule()
                    .fill(Color.edrCss(group.colorHex ?? "#ffffff", tint: group.colorHex != nil ? 0.7 : 0, gain: hdrEnabled ? 2.0 : 1.0, opacity: shatterFlash * 0.45))
                    .blur(radius: 8)
            }
        }
    }
}

/// 仅对主字 dissolve / shatter 挂载 @State 几何追踪（遵循 swiftui-expert-skill POD 视图原则）
private struct DebrisEmphasisCharWrapper: View {
    let charKey: String
    let slice: LyricLineSweepView.CharSlice
    let charIndex: Int
    let count: Int
    let group: LyricEmphasisPayload
    let duration: Double
    let stagger: Double
    let pace: FixedLyricPace
    let holdState: HoldVibratoState?
    let shineCenter: Double?
    let beatVal: Double
    let accentVal: Double
    let breathVal: (gate: Double, y: Double)?
    let riseVal: Double
    let kickVal: Double
    let font: Font
    let songMotion: String?
    let fontSize: CGFloat
    let isBackground: Bool
    let isItalic: Bool
    let isUnderlined: Bool
    let hdrEnabled: Bool
    let wordWipeStarted: Bool
    let spotlightLevel: Double
    let activeBlend: Double
    let allowsFloat: Bool
    let rhythm: RhythmEngineContext
    let seekAtMs: Double
    let debrisEngine: DebrisEngine
    let nowMs: Double

    @State private var localFrame: CGRect = .zero

    var body: some View {
        let dissolveInfo: (at: Double, amount: Double) = group.effect == "dissolve"
            ? LyricWordEffects.dissolveState(
                start: group.start, end: group.end, charIndex: charIndex, count: count,
                timeMs: nowMs, seekAt: seekAtMs, fadeMs: rhythm.dissolveFadeMs
            )
            : (0, 0)

        let shatterInfo: (at: Double, crack: Double, amount: Double) = group.effect == "shatter"
            ? LyricWordEffects.shatterState(end: group.end, timeMs: nowMs, seekAt: seekAtMs)
            : (0, 0, 0)

        let glowColor = Color(cssColor: group.colorHex ?? "#ffffff")

        EmphasisCharGlyphView(
            slice: slice,
            charIndex: charIndex,
            count: count,
            group: group,
            duration: duration,
            stagger: stagger,
            pace: pace,
            holdState: holdState,
            shineCenter: shineCenter,
            beatVal: beatVal,
            accentVal: accentVal,
            breathVal: breathVal,
            riseVal: riseVal,
            kickVal: kickVal,
            font: font,
            songMotion: songMotion,
            fontSize: fontSize,
            isBackground: isBackground,
            isItalic: isItalic,
            isUnderlined: isUnderlined,
            hdrEnabled: hdrEnabled,
            wordWipeStarted: wordWipeStarted,
            spotlightLevel: spotlightLevel,
            activeBlend: activeBlend,
            allowsFloat: allowsFloat,
            rhythm: rhythm,
            dissolveAmount: dissolveInfo.amount,
            shatterCrack: shatterInfo.crack,
            shatterAmount: shatterInfo.amount,
            nowMs: nowMs
        )
        .onGeometryChange(for: CGRect.self) { proxy in
            proxy.frame(in: .named("debrisSpace"))
        } action: { rect in
            if abs(rect.minX - localFrame.minX) > 0.5
                || abs(rect.minY - localFrame.minY) > 0.5
                || abs(rect.width - localFrame.width) > 0.5 {
                localFrame = rect
            }
        }
        .onChange(of: dissolveInfo.amount > 0) { _, active in
            if active {
                debrisEngine.triggerDissolveIfNeeded(
                    key: charKey, at: dissolveInfo.at, nowMs: nowMs,
                    rect: localFrame, color: glowColor
                )
            }
        }
        .onChange(of: shatterInfo.amount > 0) { _, active in
            if active {
                let push = count > 1 ? (Double(charIndex) / Double(count - 1)) * 2.0 - 1.0 : 0
                debrisEngine.triggerShatterIfNeeded(
                    key: charKey, at: shatterInfo.at, nowMs: nowMs,
                    rect: localFrame, push: push, color: glowColor
                )
            }
        }
    }
}

/// 纯值类型（无任何 @State 包装器）单字符动效视图
private struct EmphasisCharGlyphView: View {
    let slice: LyricLineSweepView.CharSlice
    let charIndex: Int
    let count: Int
    let group: LyricEmphasisPayload
    let duration: Double
    let stagger: Double
    let pace: FixedLyricPace
    let holdState: HoldVibratoState?
    let shineCenter: Double?
    let beatVal: Double
    let accentVal: Double
    let breathVal: (gate: Double, y: Double)?
    let riseVal: Double
    let kickVal: Double
    let font: Font
    let songMotion: String?
    let fontSize: CGFloat
    let isBackground: Bool
    let isItalic: Bool
    let isUnderlined: Bool
    let hdrEnabled: Bool
    let wordWipeStarted: Bool
    let spotlightLevel: Double
    let activeBlend: Double
    let allowsFloat: Bool
    let rhythm: RhythmEngineContext
    let dissolveAmount: Double
    let shatterCrack: Double
    let shatterAmount: Double
    let nowMs: Double

    // 1:1 对齐 web/src/lib/hdr-color.ts SHIMMER_HALF_BAND = 0.4（光带半宽 0.4 字宽，中心峰值权重 0.95）
    private static let shimmerHalfBand: Double = 0.40
    private static let shimmerPeakWeight: Double = 0.95

    var body: some View {
        let em = Double(fontSize)
        let f = group.factor
        let begin = group.start + stagger * Double(charIndex)
        let baseV = CubicBezier.swellCurve((nowMs - begin) / duration)
        let v: Double = (holdState != nil && nowMs >= begin + duration * 0.5)
            ? max(baseV, holdState!.release)
            : baseV
        let vibrato = holdState?.amount ?? 0

        let shiftedMs = nowMs + LyricSpecs.animationHeadstartMs
        let sliceDur = max(1, slice.end - slice.start)
        let wipeProgress = slice.end <= slice.start
            ? (shiftedMs >= slice.start ? 1.0 : 0.0)
            : min(1.0, max(0.0, (shiftedMs - slice.start) / sliceDur))

        // 与 PlainWordSpanView 严格共享同一套演唱上浮基线：唱完后保持在同一上浮高度，直到整行结束随 activeBlend 同步回落
        let liftBlend = min(1.0, max(0.0, activeBlend * 1.85))
        let motionPreset = songMotion.flatMap(LyricMotionPreset.init(rawValue:))
        let effWordFloatEm = motionPreset?.wordFloatEm ?? LyricSpecs.wordFloatEm
        let effBounceBell = motionPreset?.bounceBell ?? 0.0
        let floatPx = allowsFloat ? (effWordFloatEm * em * (isBackground ? 2.0 : 1.0)) : 0
        let liftCurve = CubicBezier.easeOut.eval(wipeProgress) + (effBounceBell > 0 ? Foundation.sin(wipeProgress * .pi) * effBounceBell : 0.0)
        let baseLiftPx = (allowsFloat && wipeProgress > 0 && liftBlend > 0)
            ? (-floatPx * liftCurve * liftBlend)
            : 0

        let holdRamp = min(1.0, wipeProgress * 1.35) * LyricSpecs.emphasisTintHold
        let rawTint: Double = (group.colorHex != nil && wipeProgress > 0)
            ? max(v * LyricSpecs.emphasisTintPeak, holdRamp)
            : 0
        let tint = rawTint * activeBlend

        let motion = computeMotion(
            em: em, f: f, begin: begin, v: v, baseLiftPx: baseLiftPx, vibrato: vibrato,
            dissolveAmount: dissolveAmount, crack: shatterCrack
        )

        let baseHex = group.colorHex ?? "#ffffff"
        let fullBaseHdr = 1.55 + (1.88 - 1.55) * spotlightLevel
        let rawBaseGain = fullBaseHdr + 0.55 * v
        let baseGain: Double = (hdrEnabled && wordWipeStarted)
            ? (1.0 + (rawBaseGain - 1.0) * activeBlend)
            : 1.0
        let baseColor = Color.edrCss(baseHex, tint: tint, gain: baseGain)

        let localShineCenter = shineCenter.map { $0 - Double(charIndex) }
        let isShiningBand = localShineCenter.map { $0 >= -0.65 && $0 <= 1.65 } ?? false

        let charForegroundStyle: AnyShapeStyle = {
            guard isShiningBand, let localCenter = localShineCenter else {
                return AnyShapeStyle(baseColor)
            }
            let spotPeakFloor = 3.25 + (3.60 - 3.25) * spotlightLevel
            let fullWipedBandGain = max(rawBaseGain * 2.10, spotPeakFloor)
            let wipedBandGain = 1.0 + (fullWipedBandGain - 1.0) * activeBlend
            let effectiveBaseHdr = max(1.0, 1.0 + (fullBaseHdr - 1.0) * activeBlend)
            let bandGain: Double = hdrEnabled
                ? (wordWipeStarted ? wipedBandGain : (wipedBandGain / effectiveBaseHdr))
                : 1.0
            let midColor = Color.edrShimmerMix(
                baseHex: baseHex,
                baseTint: tint,
                baseGain: baseGain,
                bandGain: bandGain,
                weight: Self.shimmerPeakWeight * 0.5
            )
            let peakColor = Color.edrShimmerMix(
                baseHex: baseHex,
                baseTint: tint,
                baseGain: baseGain,
                bandGain: bandGain,
                weight: Self.shimmerPeakWeight
            )
            let half = Self.shimmerHalfBand
            return AnyShapeStyle(
                LinearGradient(
                    stops: [
                        .init(color: baseColor, location: 0.0),
                        .init(color: midColor, location: 0.25),
                        .init(color: peakColor, location: 0.50),
                        .init(color: midColor, location: 0.75),
                        .init(color: baseColor, location: 1.0)
                    ],
                    startPoint: UnitPoint(x: localCenter - half, y: 0.45),
                    endPoint: UnitPoint(x: localCenter + half, y: 0.55)
                )
            )
        }()

        let glowColor = Color(cssColor: baseHex)
        let underlineProgress = isUnderlined
            ? min(1.0, max(0.0, (nowMs - slice.start) / max(1, slice.end - slice.start)))
            : 0

        let charVisibility = max(0, 1.0 - max(dissolveAmount, shatterAmount))

        let baseText = Text(slice.char).font(font)
        let styledText = isItalic ? baseText.italic() : baseText

        styledText
            .foregroundStyle(charForegroundStyle)
            .shadow(
                color: (wipeProgress > 0 && motion.glow > 0.01) ? glowColor.opacity(min(0.95, motion.glow)) : .clear,
                radius: CGFloat(motion.glowRadiusPx)
            )
            .overlay(alignment: .bottomLeading) {
                if isUnderlined && underlineProgress > 0 && slice.char.trimmingCharacters(in: .whitespaces).isEmpty == false {
                    Capsule()
                        .fill(charForegroundStyle)
                        .frame(height: max(1.2, fontSize * 0.075))
                        .scaleEffect(x: underlineProgress, y: 1, anchor: .leading)
                        .offset(y: -fontSize * 0.04)
                }
            }
            .blur(radius: CGFloat(motion.blurPx))
            .scaleEffect(motion.scale)
            .offset(x: CGFloat(motion.dxPx), y: CGFloat(motion.dyPx))
            .opacity(charVisibility)
            .allowedDynamicRange(hdrEnabled && activeBlend > 0.005 && (wordWipeStarted || isShiningBand) ? .high : .standard)
    }

    private struct CharMotion {
        var scale: Double = 1.0
        var dxPx: Double = 0
        var dyPx: Double = 0
        var glow: Double = 0
        var glowRadiusPx: Double = 4
        var blurPx: Double = 0
    }

    private func computeMotion(
        em: Double,
        f: Double,
        begin: Double,
        v: Double,
        baseLiftPx: Double,
        vibrato: Double,
        dissolveAmount: Double,
        crack: Double
    ) -> CharMotion {
        var m = CharMotion(dyPx: baseLiftPx)

        if group.effect == "focus" && f > 0 {
            let focusStart = slice.start - 180.0
            let focusRatio = hdrEnabled ? 0.45 : 0.70
            let focusSpan = max(150.0, min(max(150.0, slice.end - focusStart), 180.0 + max(40.0, (slice.end - slice.start) * focusRatio)))
            let clear = min(1.0, max(0.0, (nowMs - focusStart) / focusSpan))
            m.blurPx = (1.0 - clear) * (0.05 + 0.07 * f) * em
        }
        if dissolveAmount > 0.002 {
            m.blurPx = max(m.blurPx, dissolveAmount * 0.08 * em)
        }

        guard f > 0 && (abs(baseLiftPx) >= 0.02 || v > 0 || (breathVal?.gate ?? 0) > 0 || riseVal > 0 || crack > 0 || dissolveAmount > 0) else {
            return m
        }

        var scale = 1.0
        var xEm = dissolveAmount * 0.15
        var yEm = 0.0
        var glow = 0.0
        var radiusEm = 0.30

        switch group.effect {
        case "swell":
            let k = v * (1.0 + RhythmEngineContext.swellGain * accentVal)
            scale = 1.0 + k * 0.14 * f
            xEm += -k * 0.03 * f * (Double(count) * 0.5 - Double(charIndex) - 0.5)
            yEm -= k * 0.025 * f
            glow = v * (0.25 + 0.45 * f) * (1.0 + 0.4 * accentVal)

        case "glow":
            if let b = breathVal {
                scale = 1.0 + b.gate * b.y * 0.04 * f
                glow = b.gate * (0.35 + 0.5 * f) * (0.3 + 0.7 * b.y)
                radiusEm = 0.45
            }

        case "shake":
            if let holdState {
                let wobble = LyricWordEffects.vibratoWave(timeMs: nowMs, onset: holdState.onset, charIndex: charIndex, pace: pace)
                scale = 1.0 + v * 0.14 * f + wobble * vibrato * 0.02 * f
                xEm += -v * 0.03 * f * (Double(count) * 0.5 - Double(charIndex) - 0.5)
                    + cos(2.0 * .pi * pace.vibratoHz * 2.0 * (nowMs - holdState.onset) / 1000.0 + Double(charIndex)) * vibrato * 0.008 * f
                yEm -= v * 0.025 * f + wobble * vibrato * 0.035 * f
                glow = v * (0.25 + 0.45 * f) + vibrato * 0.12 * f
            } else {
                let amp = v * (0.35 + 0.65 * kickVal)
                let phase = (nowMs - begin) / max(10, rhythm.shakeCarrierMs)
                xEm += sin(phase * 2.3 + Double(charIndex) * 1.7) * 0.035 * f * amp
                yEm += cos(phase * 1.9 + Double(charIndex) * 1.3) * 0.025 * f * amp
                scale = 1.0 + amp * 0.06 * f
                glow = amp * (0.15 + 0.25 * f)
            }

        case "focus":
            scale = 1.0 + v * 0.05 * f
            yEm -= v * 0.015 * f
            glow = v * (0.2 + 0.3 * f)
            radiusEm = 0.40

        case "heartbeat":
            scale = 1.0 + v * 0.04 * f + beatVal * 0.16 * f
            xEm += (Double(charIndex) - Double(count - 1) * 0.5) * beatVal * 0.06 * f
            yEm -= beatVal * 0.018 * f
            glow = v * (0.2 + 0.2 * f) + beatVal * (0.3 + 0.35 * f)

        case "shimmer", "dissolve", "shatter":
            scale = 1.0 + v * 0.04 * f
            yEm -= v * 0.015 * f
            glow = shineCenter == nil ? v * (0.25 + 0.3 * f) : 0
            if crack > 0 {
                // 1:1 对齐 lyric-player.ts 碎前蓄力颤抖频率（~14.3Hz / ~17.5Hz），消除 60fps 下高频混叠乱跳
                xEm += sin(nowMs * 0.09 + Double(charIndex) * 1.7) * 0.03 * crack
                yEm += cos(nowMs * 0.11 + Double(charIndex)) * 0.02 * crack
            }

        case "wave":
            yEm -= riseVal * (0.06 + 0.12 * f)
            scale = 1.0 + riseVal * 0.04 * f

        default:
            break
        }

        // 对齐 lyric-player.ts SPOTLIGHT_EMPHASIS_SCALE & SPOTLIGHT_EMPHASIS_GLOW：聚光灯整行放大期间柔和收敛字词放大与辉光避免连片发虚
        if spotlightLevel > 0 {
            let scaleDamp = 1.0 - 0.5 * spotlightLevel
            let glowDamp = 1.0 - 0.7 * spotlightLevel
            scale = 1.0 + (scale - 1.0) * scaleDamp
            glow *= glowDamp
        }

        m.scale = scale
        m.dxPx = xEm * em
        m.dyPx = baseLiftPx + yEm * em
        m.glow = glow
        m.glowRadiusPx = radiusEm * em
        return m
    }
}
