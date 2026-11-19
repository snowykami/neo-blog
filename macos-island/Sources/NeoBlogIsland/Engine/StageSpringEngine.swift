import AppKit
import Observation
import SwiftUI

// MARK: - 1:1 对应 web/src/lib/lyrics/lyric-player.ts (layout / computeTops / Spring 阶梯入场与惯性滚轮)
// 【双端同步维护约定】
// 展开态多行舞台不使用死板的整块 NSScrollView 偏移，而是为每一条歌词/间奏/底栏维护独立的半隐式欧拉阻尼弹簧（DampedSpring）：
// - 位移弹簧：mass=1, stiffness=100, damping=18（Apple Music / AMLL 同款柔和弹性）
// - 换行阶梯延迟：LYRIC_STAGGER_BASE_S = 0.05s，逐行按 1/1.05 递减，形成自上而下的丝滑波浪涟漪感
// - 歌手胶囊展开弹簧、和声折叠弹簧、间奏展开弹簧、聚光灯居中推开全部在同一物理步内协同推进

struct PlacedStageEntry: Identifiable {
    let id: String
    let entryIndex: Int
    let entry: StageTimelineEntry
    let x: CGFloat
    let y: CGFloat
    let rotDeg: Double
    let scale: CGFloat
    let expand: Double
    let isActive: Bool
    let activeBlend: Double
    let isFocus: Bool
    let isSingerPillVisible: Bool
    let pillOpen: Double
    let blurProgress: Double
    let visualDistance: Int
    let isPast: Bool
    let rowSpotLevel: Double
    let globalSpotLevel: Double
}

@Observable
@MainActor
final class StageSpringEngine {
    private final class ItemNode {
        let y: DampedSpring
        let x: DampedSpring
        let rot: DampedSpring
        let scale: DampedSpring
        let expand: DampedSpring?
        let pillExpand: DampedSpring?
        var wasActive: Bool = false
        var exitLinear: Double = 0.0
        var blurProgress: Double = 1.0

        init(entry: StageTimelineEntry) {
            self.y = DampedSpring(initial: 0, params: LyricSpecs.positionSpring)
            self.x = DampedSpring(initial: 0, params: LyricSpecs.positionSpring)
            self.rot = DampedSpring(initial: 0, params: LyricSpecs.positionSpring)
            switch entry {
            case .line(let item):
                if item.line.isBackground {
                    self.scale = DampedSpring(initial: LyricSpecs.bgCollapsedScale, params: LyricSpecs.scaleSpring)
                    self.expand = DampedSpring(initial: 0, params: LyricSpecs.bgExpandSpring)
                    self.pillExpand = nil
                } else {
                    self.scale = DampedSpring(initial: LyricSpecs.inactiveScale, params: LyricSpecs.scaleSpring)
                    self.expand = nil
                    let hasPill = ((item.line.singerName?.isEmpty == false) || item.line.singerDotOnly) && !item.singerDots.isEmpty
                    self.pillExpand = hasPill ? DampedSpring(initial: 0, params: LyricSpecs.positionSpring) : nil
                }
            case .interlude:
                self.scale = DampedSpring(initial: 1.0, params: LyricSpecs.scaleSpring)
                self.expand = DampedSpring(initial: 0, params: LyricSpecs.scaleSpring)
                self.pillExpand = nil
            case .footer:
                self.scale = DampedSpring(initial: 1.0, params: LyricSpecs.scaleSpring)
                self.expand = nil
                self.pillExpand = nil
            }
        }
    }

    private static let staggerDecay: Double = 1.05
    private static let overscanPx: Double = 220.0
    private static let seekThresholdMs: Double = 1000.0
    private static let userScrollHoldSec: TimeInterval = 3.0
    private static let interludeHeightPx: Double = 28.0
    private static let pillSlotHeightPx: Double = 18.0
    private static let itemGapPx: Double = 6.0
    private static let mainFontSizePx: Double = 16.5
    private static let compactMultiSyncTarget: Double = 0.47
    private static let compactMultiGroupBlend: Double = 0.72
    private static let compactMultiSpanRefRatio: Double = 0.45
    private static let compactMinTopSafeRatio: Double = 0.12

    /// 仅在动画活跃/静止或手动滚动生灭边界翻转，避免静止暂停时 60Hz 唤醒
    private(set) var isAnimating: Bool = false
    private(set) var isManualScrolling: Bool = false
    /// 用于唤醒静止暂停态下的单帧重排（如暂停时用滚轮翻看歌词或切换译文/读音开关）
    private(set) var wakeRevision: Int = 0

    @ObservationIgnored private var nodes: [String: ItemNode] = [:]
    @ObservationIgnored private var measuredHeights: [String: Double] = [:]
    @ObservationIgnored private var lastEntriesSignature: String = ""
    @ObservationIgnored private var lastStepDate: Date? = nil
    @ObservationIgnored private var lastTimeMs: Double? = nil
    @ObservationIgnored private var lastFocusEntryIndex: Int? = nil
    @ObservationIgnored private var lastFocusChangeMs: Double? = nil
    @ObservationIgnored private var currentStepIntervalMs: Double? = nil
    @ObservationIgnored private var forceTeleportNext: Bool = true

    @ObservationIgnored private var manualOffset: Double? = nil
    @ObservationIgnored private var manualHoldUntil: Date = .distantPast
    @ObservationIgnored private var lastComputedTops: [Double] = []
    @ObservationIgnored private var lastFocusCurrentY: Double = 0

    func reset() {
        nodes.removeAll()
        measuredHeights.removeAll()
        lastEntriesSignature = ""
        lastStepDate = nil
        lastTimeMs = nil
        lastFocusEntryIndex = nil
        lastFocusChangeMs = nil
        currentStepIntervalMs = nil
        forceTeleportNext = true
        manualOffset = nil
        manualHoldUntil = .distantPast
        lastComputedTops = []
        syncFlags(animating: false, manual: false)
    }

    func invalidateHeights() {
        measuredHeights.removeAll()
        wake()
    }

    func reportHeight(id: String, height: CGFloat) {
        let h = Double(height)
        guard h > 1.0 else { return }
        if let old = measuredHeights[id], abs(old - h) <= 0.5 {
            return
        }
        measuredHeights[id] = h
        wake()
    }

    func handleWheel(deltaY: Double, isMomentum: Bool) {
        guard abs(deltaY) > 0.01 else { return }
        let now = Date()
        if manualOffset == nil {
            if let fIdx = lastFocusEntryIndex, lastComputedTops.indices.contains(fIdx) {
                manualOffset = lastComputedTops[fIdx] - lastFocusCurrentY
            } else {
                manualOffset = 0
            }
        }
        manualOffset = (manualOffset ?? 0) + deltaY
        if !isMomentum {
            manualHoldUntil = now.addingTimeInterval(Self.userScrollHoldSec)
        } else if manualHoldUntil < now.addingTimeInterval(0.8) {
            manualHoldUntil = now.addingTimeInterval(0.8)
        }
        syncFlags(animating: true, manual: true)
        wake()
    }

    func cancelManualScroll() {
        guard manualOffset != nil else { return }
        manualOffset = nil
        manualHoldUntil = .distantPast
        syncFlags(animating: true, manual: false)
        wake()
    }

    private func wake() {
        wakeRevision &+= 1
    }

    private func syncFlags(animating: Bool, manual: Bool) {
        if isAnimating != animating { isAnimating = animating }
        if isManualScrolling != manual { isManualScrolling = manual }
    }

    private func estimatedHeight(for entry: StageTimelineEntry, showRomaji: Bool, showTranslation: Bool) -> Double {
        if let exact = measuredHeights[entry.id] {
            return exact
        }
        switch entry {
        case .interlude:
            return Self.interludeHeightPx
        case .footer:
            return 34.0
        case .line(let item):
            let l = item.line
            var h = l.isBackground ? 20.0 : 26.0
            if l.hasFurigana { h += 8.0 }
            if showRomaji {
                if !l.romanizationWords.isEmpty {
                    h += 13.0
                } else if l.romanization?.isEmpty == false {
                    h += 15.0
                }
            }
            if showTranslation {
                if l.translation?.isEmpty == false { h += 15.0 }
                if l.secondaryTranslation?.isEmpty == false { h += 14.0 }
            }
            return h
        }
    }

    func stepLayout(
        entries: [StageTimelineEntry],
        lines: [LyricLinePayload],
        stageHeight: Double,
        showRomaji: Bool,
        showTranslation: Bool,
        date: Date,
        nowMs: Double,
        tState: (active: [Int], focus: Int?, interlude: TimeIntervalRange?),
        spot: (line: Int, level: Double)?,
        motion: String? = nil
    ) -> [PlacedStageEntry] {
        guard !entries.isEmpty, stageHeight > 10 else {
            syncFlags(animating: false, manual: false)
            return []
        }

        let sig = "\(entries.first?.id ?? "")|\(entries.count)"
        var jump = forceTeleportNext
        if sig != lastEntriesSignature {
            lastEntriesSignature = sig
            nodes.removeAll()
            measuredHeights.removeAll()
            lastFocusEntryIndex = nil
            manualOffset = nil
            jump = true
        }
        if let prevMs = lastTimeMs, abs(nowMs - prevMs) >= Self.seekThresholdMs {
            jump = true
        }
        lastTimeMs = nowMs
        forceTeleportNext = false

        let dt: Double = {
            guard let prev = lastStepDate else { return 1.0 / 60.0 }
            let raw = date.timeIntervalSince(prev)
            return min(LyricSpecs.maxFrameSec, max(1.0 / 240.0, raw))
        }()
        lastStepDate = date

        let activeLineSet = Set(tState.active)

        // 1. 解析当前焦点条目下标（间奏 -> 主唱行 -> 曲末底栏）
        let focusEntryIdx: Int = {
            if let inter = tState.interlude {
                if let idx = entries.firstIndex(where: {
                    if case .interlude(_, let r, _) = $0 { return r == inter }
                    return false
                }) {
                    return idx
                }
            }
            if let fLine = tState.focus {
                if let idx = entries.firstIndex(where: {
                    if case .line(let item) = $0 { return item.index == fLine }
                    return false
                }) {
                    return idx
                }
            }
            return max(0, entries.count - 1)
        }()

        let focusChanged = (lastFocusEntryIndex != nil && lastFocusEntryIndex != focusEntryIdx)
        lastFocusEntryIndex = focusEntryIdx

        if jump {
            currentStepIntervalMs = nil
            lastFocusChangeMs = nowMs
        } else if focusChanged {
            if let prevChange = lastFocusChangeMs, nowMs > prevChange {
                currentStepIntervalMs = nowMs - prevChange
            } else {
                currentStepIntervalMs = nil
            }
            lastFocusChangeMs = nowMs
        }
        let motionSprings = LyricSpecs.resolveMotionSprings(motion: motion, stepIntervalMs: currentStepIntervalMs)

        // 待唱主唱行（供开唱前或间奏期间提前预显歌手胶囊）
        let upcomingMainLineIdx: Int? = {
            guard activeLineSet.isEmpty else { return nil }
            if let inter = tState.interlude {
                return lines.enumerated().first(where: { !$0.element.isBackground && $0.element.start >= inter.end - 50 })?.offset
            }
            return tState.focus
        }()

        // 确保每个条目拥有持久化弹簧节点
        var entryNodes: [ItemNode] = []
        entryNodes.reserveCapacity(entries.count)
        for e in entries {
            if let existing = nodes[e.id] {
                existing.y.setParams(motionSprings.position)
                existing.x.setParams(motionSprings.position)
                existing.rot.setParams(motionSprings.position)
                existing.scale.setParams(motionSprings.scale)
                existing.pillExpand?.setParams(motionSprings.position)
                entryNodes.append(existing)
            } else {
                let created = ItemNode(entry: e)
                created.y.setParams(motionSprings.position)
                created.x.setParams(motionSprings.position)
                created.rot.setParams(motionSprings.position)
                created.scale.setParams(motionSprings.scale)
                created.pillExpand?.setParams(motionSprings.position)
                nodes[e.id] = created
                entryNodes.append(created)
            }
        }

        var anySpringMoving = false

        // 2. 推进间奏/背景和声展开弹簧与歌手胶囊高度弹簧
        var pillVisibleFlags = Array(repeating: false, count: entries.count)
        var lineRenderActiveFlags = Array(repeating: false, count: entries.count)

        for (i, e) in entries.enumerated() {
            let node = entryNodes[i]
            switch e {
            case .interlude(_, let range, _):
                let isInterActive = (tState.interlude == range)
                let target = isInterActive ? 1.0 : 0.0
                if let exp = node.expand {
                    if jump { exp.jump(target) } else { exp.setTarget(target) }
                    exp.step(dt: dt)
                    if !exp.resting { anySpringMoving = true }
                }

            case .line(let item):
                let idx = item.index
                let line = item.line
                if line.isBackground {
                    let bgOpen = activeLineSet.contains(idx) || (line.owner >= 0 && activeLineSet.contains(line.owner))
                    lineRenderActiveFlags[i] = bgOpen
                    let target = bgOpen ? 1.0 : 0.0
                    if let exp = node.expand {
                        if jump { exp.jump(target) } else { exp.setTarget(target) }
                        exp.step(dt: dt)
                        if !exp.resting { anySpringMoving = true }
                    }
                } else {
                    let isFocusLine = (i == focusEntryIdx && tState.interlude == nil)
                    lineRenderActiveFlags[i] = activeLineSet.contains(idx) || isFocusLine

                    let pillVis: Bool = {
                        guard node.pillExpand != nil else { return false }
                        if !activeLineSet.isEmpty {
                            return activeLineSet.contains(idx)
                        }
                        return idx == upcomingMainLineIdx
                    }()
                    pillVisibleFlags[i] = pillVis
                    if let pExp = node.pillExpand {
                        let pTarget = pillVis ? 1.0 : 0.0
                        if jump { pExp.jump(pTarget) } else { pExp.setTarget(pTarget) }
                        pExp.step(dt: dt)
                        if !pExp.resting { anySpringMoving = true }
                    }
                }

            case .footer:
                lineRenderActiveFlags[i] = (i == focusEntryIdx)
            }
        }

        // 3. 计算各条目实时高度与累积纵向起点 tops（对齐 computeTops）
        let paraGap = 0.35 * Self.mainFontSizePx
        var heights = Array(repeating: 0.0, count: entries.count)
        var tops = Array(repeating: 0.0, count: entries.count)
        var total = 0.0

        for (i, e) in entries.enumerated() {
            let node = entryNodes[i]
            let rawH = estimatedHeight(for: e, showRomaji: showRomaji, showTranslation: showTranslation)
            let openRatio = node.expand?.position ?? 1.0
            let effectiveH = rawH * openRatio
            heights[i] = effectiveH

            let pillOpen = node.pillExpand?.position ?? 0
            if case .line(let item) = e, item.line.paragraphStart, i > 0 {
                let prevInterRatio: Double = {
                    if case .interlude = entries[i - 1] {
                        return 1.0 - (entryNodes[i - 1].expand?.position ?? 0)
                    }
                    return 1.0
                }()
                let pillScale = 1.0 - 0.65 * pillOpen
                total += paraGap * prevInterRatio * pillScale
            }
            total += Self.pillSlotHeightPx * pillOpen
            tops[i] = total
            total += effectiveH + (effectiveH > 0.5 ? Self.itemGapPx * openRatio : 0)
        }
        lastComputedTops = tops

        // 4. 自动滚动锚点与多行同唱水平同步线折中（严格 1:1 对齐 web lyric-player.ts 紧凑小窗算法）
        let focusNaturalH: Double = {
            if case .interlude = entries[focusEntryIdx] {
                return Self.interludeHeightPx
            }
            return heights[focusEntryIdx]
        }()
        let focusTop = tops[focusEntryIdx]
        let focusCenter = focusTop + focusNaturalH * 0.5
        let singleScroll = focusCenter - stageHeight * LyricSpecs.compactAlignPosition
        var effectiveAlignRatio = LyricSpecs.compactAlignPosition
        var autoScroll = singleScroll

        if tState.interlude == nil, case .line = entries[focusEntryIdx], stageHeight > 0 {
            var groupTop = focusTop
            var groupBottom = focusTop + focusNaturalH
            var firstIdx = focusEntryIdx
            let lo = max(0, focusEntryIdx - 4)
            let hi = min(entries.count - 1, focusEntryIdx + 4)
            for i in lo...hi {
                if i != focusEntryIdx {
                    guard case .line = entries[i], lineRenderActiveFlags[i], heights[i] > 1.0 else {
                        continue
                    }
                }
                if tops[i] < groupTop {
                    groupTop = tops[i]
                    firstIdx = i
                }
                if tops[i] + heights[i] > groupBottom {
                    groupBottom = tops[i] + heights[i]
                }
            }
            let extraSpan = max(0.0, (groupBottom - groupTop) - focusNaturalH)
            if extraSpan > 0.5 {
                let extraRatio = min(1.0, extraSpan / (stageHeight * Self.compactMultiSpanRefRatio))
                effectiveAlignRatio = LyricSpecs.compactAlignPosition
                    + (Self.compactMultiSyncTarget - LyricSpecs.compactAlignPosition) * extraRatio
                let groupCenter = (groupTop + groupBottom) * 0.5
                let anchorDocY = focusCenter + (groupCenter - focusCenter) * Self.compactMultiGroupBlend
                let rawScroll = anchorDocY - stageHeight * effectiveAlignRatio
                let firstPill = Self.pillSlotHeightPx * (entryNodes[firstIdx].pillExpand?.position ?? 0)
                let firstVisualTop = tops[firstIdx] - firstPill
                let maxAllowedScroll = max(singleScroll, firstVisualTop - stageHeight * Self.compactMinTopSafeRatio)
                autoScroll = min(rawScroll, maxAllowedScroll)
            }
        }

        var returnFromManual = false
        if manualOffset != nil && date >= manualHoldUntil {
            manualOffset = nil
            returnFromManual = true
        }
        if let mOff = manualOffset {
            let minScroll = -stageHeight * 0.35
            let maxScroll = max(minScroll, total - stageHeight * 0.65)
            manualOffset = max(minScroll, min(maxScroll, mOff))
        }
        let scroll = manualOffset ?? autoScroll

        // 5. 聚光灯居中偏移与上下邻行让开（对齐 SPOTLIGHT_SCALE_COMPACT = 1.1 & SPOTLIGHT_SPREAD_COMPACT_EM = 0.35）
        let spotLevel = (manualOffset == nil) ? (spot?.level ?? 0) : 0
        let spotEntryIdx: Int? = {
            guard spotLevel > 0, let sLine = spot?.line else { return nil }
            return entries.firstIndex {
                if case .line(let item) = $0 { return item.index == sLine }
                return false
            }
        }()

        var spotShift = 0.0
        var spotSpread = 0.0
        let spotScale = 1.10
        if spotEntryIdx != nil {
            spotShift = (0.5 - effectiveAlignRatio) * stageHeight * spotLevel
            spotSpread = 0.35 * Self.mainFontSizePx * spotLevel
        }

        // 6. 推进每条目的独立位移弹簧、空间扇面/微倾弹簧与缩放弹簧（1:1 对齐 web lyric-player.ts 紧凑模式）
        let useStagger = (focusChanged || returnFromManual) && !jump && manualOffset == nil
        let fastCut = (currentStepIntervalMs ?? .infinity) > 0 && (currentStepIntervalMs ?? .infinity) < 420
        let focusDelay = motionSprings.staggerBaseSec * motionSprings.focusDelayMul
        var delay = focusDelay
        var delayStep = motionSprings.staggerBaseSec
        let spatialActive = manualOffset == nil && motion != nil
        let arcScale = spatialActive ? 0.5 : 0.0
        let tiltScale = spatialActive ? 0.65 : 0.0

        for (i, e) in entries.enumerated() {
            let node = entryNodes[i]
            let spreadSign: Double = {
                guard let sIdx = spotEntryIdx, i != sIdx else { return 0 }
                return i < sIdx ? -1.0 : 1.0
            }()
            let targetY = tops[i] - scroll + spotShift + spreadSign * spotSpread
            let rel = i - focusEntryIdx
            let alignSign: Double = {
                if case .line(let item) = e {
                    if item.line.align == "right" { return -1.0 }
                    if item.line.align == "center" { return 0.0 }
                }
                return 1.0
            }()
            let highlighted = lineRenderActiveFlags[i]
            let targetX: Double = (arcScale == 0.0 || highlighted)
                ? 0.0
                : (rel > 0 ? min(3.0, Double(rel)) * motionSprings.arcPx : (rel < 0 ? -motionSprings.arcPx * 0.25 : 0.0)) * arcScale * alignSign
            let targetRot: Double = (tiltScale == 0.0 || highlighted)
                ? 0.0
                : (rel > 0 ? min(2.5, Double(rel) * 0.8) * motionSprings.tiltDeg : 0.0) * tiltScale * alignSign

            let inStaggerViewport = (targetY + heights[i] > 4 && targetY < stageHeight - 4)
                || (node.y.position + heights[i] > 4 && node.y.position < stageHeight - 4)

            if jump {
                node.y.jump(targetY)
                node.x.jump(targetX)
                node.rot.jump(targetRot)
            } else if useStagger && inStaggerViewport {
                var itemDelay = 0.0
                if rel == 0 {
                    itemDelay = focusDelay
                } else if rel > 0 {
                    delay += delayStep
                    delayStep /= Self.staggerDecay
                    itemDelay = delay
                }
                if fastCut && itemDelay > 0 && abs(node.y.velocity) > 120 && (targetY - node.y.position) * node.y.velocity > 0 {
                    itemDelay = min(itemDelay * 0.35, 0.018)
                }
                node.y.setTarget(targetY, delay: itemDelay)
                node.x.setTarget(targetX, delay: itemDelay)
                node.rot.setTarget(targetRot, delay: itemDelay)
            } else {
                node.y.setTarget(targetY, delay: 0)
                node.x.setTarget(targetX, delay: 0)
                node.rot.setTarget(targetRot, delay: 0)
            }
            node.y.step(dt: dt)
            node.x.step(dt: dt)
            node.rot.step(dt: dt)
            if !node.y.resting || !node.x.resting || !node.rot.resting { anySpringMoving = true }

            let baseScale: Double = {
                switch e {
                case .line(let item):
                    if item.line.isBackground {
                        return lineRenderActiveFlags[i] ? 1.0 : LyricSpecs.bgCollapsedScale
                    }
                    return lineRenderActiveFlags[i] ? 1.0 : motionSprings.inactiveScale
                case .interlude, .footer:
                    return 1.0
                }
            }()
            let targetScale = (spotEntryIdx == i) ? (baseScale + (spotScale - baseScale) * spotLevel) : baseScale
            if jump {
                node.scale.jump(targetScale)
            } else {
                node.scale.setTarget(targetScale, delay: (useStagger && inStaggerViewport && rel == 0) ? (focusDelay * 0.5) : 0)
            }
            node.scale.step(dt: dt)
            if !node.scale.resting { anySpringMoving = true }
        }

        if entries.indices.contains(focusEntryIdx) {
            lastFocusCurrentY = entryNodes[focusEntryIdx].y.position
        }

        // 7. 计算可见条目与视觉行距（已折叠背景行不计入模糊距离，对齐 lyric-player.ts visualIndex）
        var visualIndices = Array(repeating: 0, count: entries.count)
        var runningVis = 0
        for (i, e) in entries.enumerated() {
            visualIndices[i] = runningVis
            let collapsed: Bool = {
                switch e {
                case .interlude:
                    return (entryNodes[i].expand?.position ?? 0) < 0.05
                case .line(let item) where item.line.isBackground:
                    return (entryNodes[i].expand?.position ?? 0) < 0.05
                default:
                    return false
                }
            }()
            if !collapsed {
                runningVis += 1
            }
        }
        let focusVisual = visualIndices[focusEntryIdx]

        var visibleOut: [PlacedStageEntry] = []
        visibleOut.reserveCapacity(16)

        for (i, e) in entries.enumerated() {
            let node = entryNodes[i]
            let isAct = lineRenderActiveFlags[i]
            if jump {
                node.wasActive = isAct
                node.exitLinear = isAct ? 1.0 : 0.0
            } else {
                if isAct {
                    node.exitLinear = 1.0
                } else if node.wasActive || node.exitLinear > 0 {
                    node.exitLinear = max(0.0, node.exitLinear - dt / 0.42)
                    if node.exitLinear > 0.001 {
                        anySpringMoving = true
                    } else {
                        node.exitLinear = 0.0
                    }
                }
                node.wasActive = isAct
            }

            let visDelta = visualIndices[i] - focusVisual
            let targetBlur: Double = (isAct || visDelta == 0 || manualOffset != nil) ? 0.0 : 1.0
            if jump {
                node.blurProgress = targetBlur
            } else {
                let tau = targetBlur < node.blurProgress ? motionSprings.blurInTau : motionSprings.blurOutTau
                let stepBlend = 1.0 - exp(-dt / tau)
                node.blurProgress += (targetBlur - node.blurProgress) * stepBlend
                if abs(node.blurProgress - targetBlur) > 0.008 {
                    anySpringMoving = true
                } else {
                    node.blurProgress = targetBlur
                }
            }

            let expPos = node.expand?.position ?? 1.0
            if node.expand != nil && expPos < 0.012 && (node.expand?.target ?? 0) == 0 {
                continue
            }
            let curY = node.y.position
            let estH = max(heights[i], 24.0)
            guard curY + estH > -Self.overscanPx && curY < stageHeight + Self.overscanPx else {
                continue
            }

            let activeBlend = isAct ? 1.0 : (node.exitLinear * node.exitLinear)
            let pillOpen = min(1.0, max(0.0, node.pillExpand?.position ?? 0.0))

            visibleOut.append(
                PlacedStageEntry(
                    id: e.id,
                    entryIndex: i,
                    entry: e,
                    x: CGFloat(node.x.position),
                    y: CGFloat(curY),
                    rotDeg: node.rot.position,
                    scale: CGFloat(node.scale.position),
                    expand: expPos,
                    isActive: isAct,
                    activeBlend: activeBlend,
                    isFocus: i == focusEntryIdx,
                    isSingerPillVisible: pillVisibleFlags[i],
                    pillOpen: pillOpen,
                    blurProgress: node.blurProgress,
                    visualDistance: abs(visDelta),
                    isPast: visDelta < 0,
                    rowSpotLevel: spotEntryIdx == i ? spotLevel : 0,
                    globalSpotLevel: spotLevel
                )
            )
        }

        syncFlags(animating: anySpringMoving, manual: manualOffset != nil)
        return visibleOut
    }
}

// MARK: - macOS 原生触控板双指无级滚动与鼠标滚轮捕获层（不拦截左键点击，点击穿透给下方歌词行）

struct StageScrollWheelCatcher: NSViewRepresentable {
    let onScrollDeltaY: (Double, Bool) -> Void

    func makeNSView(context: Context) -> ScrollCatcherNSView {
        let view = ScrollCatcherNSView()
        view.onScrollDeltaY = onScrollDeltaY
        return view
    }

    func updateNSView(_ nsView: ScrollCatcherNSView, context: Context) {
        nsView.onScrollDeltaY = onScrollDeltaY
    }

    static func dismantleNSView(_ nsView: ScrollCatcherNSView, coordinator: ()) {
        nsView.cleanupMonitor()
    }

    final class ScrollCatcherNSView: NSView {
        var onScrollDeltaY: ((Double, Bool) -> Void)?
        private var localMonitor: Any?

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            if window != nil && localMonitor == nil {
                localMonitor = NSEvent.addLocalMonitorForEvents(matching: [.scrollWheel]) { [weak self] event in
                    guard let self, let win = self.window, event.window === win else { return event }
                    let pt = self.convert(event.locationInWindow, from: nil)
                    guard self.bounds.contains(pt) else { return event }
                    let raw = Double(event.scrollingDeltaY)
                    let dy = event.hasPreciseScrollingDeltas ? -raw : (-raw * 18.0)
                    let isMomentum = !event.momentumPhase.isEmpty
                    self.onScrollDeltaY?(dy, isMomentum)
                    return nil
                }
            } else if window == nil {
                cleanupMonitor()
            }
        }

        func cleanupMonitor() {
            if let mon = localMonitor {
                NSEvent.removeMonitor(mon)
                localMonitor = nil
            }
        }

        override func hitTest(_ point: NSPoint) -> NSView? {
            nil
        }
    }
}
