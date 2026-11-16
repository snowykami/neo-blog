import Foundation

// MARK: - 1:1 对应 web/src/lib/lyrics/strip-slots.ts（单句 / 上下双行 / 2x2 四宫格分配）

struct StripCandidateLine: Equatable {
    let index: Int
    let duet: Bool
    let background: Bool
    let ownedByFocus: Bool
}

struct StripSlotAssignment: Equatable {
    enum Row { case top, bottom }
    let row: Row
    /// 四宫格时为 true（主唱在左半格、对唱在右半格）
    let half: Bool
}

enum StripSlotSolver {
    private static let gridMinLines = 3

    /// focus 为当前焦点主句，others 为此刻同时在唱的其余行；单句独唱时返回空字典
    static func placeStripLines(
        focus: StripCandidateLine,
        others: [StripCandidateLine]
    ) -> [Int: StripSlotAssignment] {
        guard !others.isEmpty else { return [:] }
        let lines = [focus] + others

        // 三句及以上，且既有主唱也有对唱时分成 2x2 四宫格
        if lines.count >= gridMinLines,
           lines.contains(where: \.duet),
           lines.contains(where: { !$0.duet }) {
            var slots: [Int: StripSlotAssignment] = [:]
            var taken: Set<String> = []
            for line in lines {
                let col = line.duet ? "end" : "start"
                let rows: [StripSlotAssignment.Row] = line.background ? [.bottom, .top] : [.top, .bottom]
                if let chosen = rows.first(where: { !taken.contains("\(col)-\($0 == .top ? "top" : "bottom")") }) {
                    taken.insert("\(col)-\(chosen == .top ? "top" : "bottom")")
                    slots[line.index] = StripSlotAssignment(row: chosen, half: true)
                }
            }
            return slots
        }

        // 两句（或同一侧歌手多句）：上排焦点句，下排优先放附着在焦点句上的背景和声，否则放离焦点最近的那句
        var pair = others.first(where: \.ownedByFocus)
        if pair == nil {
            for candidate in others {
                if let cur = pair {
                    if abs(candidate.index - focus.index) < abs(cur.index - focus.index) {
                        pair = candidate
                    }
                } else {
                    pair = candidate
                }
            }
        }

        var slots: [Int: StripSlotAssignment] = [
            focus.index: StripSlotAssignment(row: .top, half: false)
        ]
        if let pair {
            slots[pair.index] = StripSlotAssignment(row: .bottom, half: false)
        }
        return slots
    }
}

// MARK: - 1:1 对应 web/src/lib/lyrics/marquee.ts（舒适走廊最短拉紧弦 + Simpson 二阶三角核平滑）

struct MarqueeWordBox: Equatable {
    let left: Double
    let width: Double
}

struct MarqueeKnot: Equatable {
    let time: Double
    let offset: Double
}

enum MarqueeSolver {
    static let defaultLineDurationMs: Double = 5000
    static let holdRatio: Double = 0.10
    static let finishRatio: Double = 0.88
    static let corridorMinRatio: Double = 0.35
    static let corridorMaxRatio: Double = 0.72
    static let smoothWindowMs: Double = 500

    private struct CursorPoint {
        let time: Double
        let position: Double
    }

    private struct CorridorGate {
        let time: Double
        var lower: Double
        var upper: Double
    }

    static func computeWordKnots(
        words: [LyricWordPayload],
        boxes: [MarqueeWordBox],
        containerWidth: Double,
        overflow: Double
    ) -> [MarqueeKnot] {
        guard !words.isEmpty, boxes.count == words.count, overflow > 0 else { return [] }
        let anchorMin = containerWidth * corridorMinRatio
        let anchorMax = containerWidth * corridorMaxRatio

        let positions = buildCursorPositions(words: words, boxes: boxes)
        guard !positions.isEmpty else { return [] }

        let sampled = sampleWithCrossings(
            positions: positions,
            edges: [anchorMin, anchorMin + overflow, anchorMax, anchorMax + overflow]
        )

        var gates: [CorridorGate] = sampled.enumerated().map { idx, pt in
            var lo = clamp(pt.position - anchorMax, 0, overflow)
            var hi = clamp(pt.position - anchorMin, 0, overflow)
            if lo > hi {
                let mid = (lo + hi) * 0.5
                lo = mid; hi = mid
            }
            if idx == 0 { hi = lo }
            if idx == sampled.count - 1 { lo = hi }
            return CorridorGate(time: pt.time, lower: lo, upper: hi)
        }
        if gates.isEmpty { return [] }
        return solveTautString(&gates)
    }

    static func evaluateKnots(_ knots: [MarqueeKnot], timeMs: Double, windowMs: Double = smoothWindowMs) -> Double {
        guard !knots.isEmpty else { return 0 }
        if knots.count == 1 { return knots[0].offset }
        let half = max(0, windowMs) * 0.5
        if half <= 0 { return evalPiecewise(knots, t: timeMs) }

        let left = integrateWeighted(knots, from: timeMs - half, to: timeMs, wFrom: 0, wTo: 1.0 / half)
        let right = integrateWeighted(knots, from: timeMs, to: timeMs + half, wFrom: 1.0 / half, wTo: 0)
        return clamp(left + right, knots[0].offset, knots[knots.count - 1].offset)
    }

    static func lineTimedOffset(
        lineStart: Double,
        lineEnd: Double,
        nextLineStart: Double?,
        timeMs: Double,
        overflow: Double
    ) -> Double {
        guard overflow > 0 else { return 0 }
        let duration: Double
        if lineEnd > lineStart {
            duration = lineEnd - lineStart
        } else if let next = nextLineStart, next > lineStart {
            duration = next - lineStart
        } else {
            duration = defaultLineDurationMs
        }
        let progress = (timeMs - lineStart) / max(1, duration)
        let ratio = clamp((progress - holdRatio) / (finishRatio - holdRatio), 0, 1)
        return ratio * overflow
    }

    // MARK: - 内部几何与积分实现

    private static func buildCursorPositions(words: [LyricWordPayload], boxes: [MarqueeWordBox]) -> [CursorPoint] {
        var raw: [CursorPoint] = []
        var lastT = -Double.infinity
        for (i, w) in words.enumerated() {
            let box = boxes[i]
            let s = max(w.start, lastT)
            lastT = max(s, w.end)
            raw.append(CursorPoint(time: s, position: box.left))
            raw.append(CursorPoint(time: lastT, position: box.left + box.width))
        }
        var out: [CursorPoint] = []
        for pt in raw {
            if let prev = out.last {
                if abs(pt.time - prev.time) < 1e-6 && abs(pt.position - prev.position) < 1e-6 {
                    continue
                }
                let t = pt.time <= prev.time ? prev.time + 1e-3 : pt.time
                out.append(CursorPoint(time: t, position: pt.position))
            } else {
                out.append(pt)
            }
        }
        return out
    }

    private static func sampleWithCrossings(positions: [CursorPoint], edges: [Double]) -> [CursorPoint] {
        var out: [CursorPoint] = []
        for i in 0..<positions.count {
            let pt = positions[i]
            if i > 0 {
                let prev = positions[i - 1]
                if pt.time > prev.time + 1e-5 && pt.position != prev.position {
                    var crossings: [Double] = []
                    for edge in edges {
                        if (prev.position - edge) * (pt.position - edge) < 0 {
                            let tc = prev.time + (edge - prev.position) / (pt.position - prev.position) * (pt.time - prev.time)
                            if tc > prev.time + 1e-4 && tc < pt.time - 1e-4 {
                                crossings.append(tc)
                            }
                        }
                    }
                    crossings.sort()
                    var lastT = prev.time
                    for tc in crossings where tc - lastT > 1e-4 {
                        let r = (tc - prev.time) / (pt.time - prev.time)
                        out.append(CursorPoint(time: tc, position: prev.position + (pt.position - prev.position) * r))
                        lastT = tc
                    }
                }
            }
            out.append(pt)
        }
        return out
    }

    private static func solveTautString(_ gates: inout [CorridorGate]) -> [MarqueeKnot] {
        let n = gates.count
        if n == 0 { return [] }
        var knots: [MarqueeKnot] = [MarqueeKnot(time: gates[0].time, offset: gates[0].lower)]
        var i = 0
        var y = gates[0].lower

        while i < n - 1 {
            var lowSlope = -Double.infinity
            var lowIdx = -1
            var highSlope = Double.infinity
            var highIdx = -1
            var bent = false

            for j in (i + 1)..<n {
                let dt = gates[j].time - gates[i].time
                if dt <= 0 { continue }
                let sL = (gates[j].lower - y) / dt
                let sU = (gates[j].upper - y) / dt
                if sL > highSlope + 1e-10 {
                    i = highIdx
                    y = gates[i].upper
                    knots.append(MarqueeKnot(time: gates[i].time, offset: y))
                    bent = true
                    break
                }
                if sU < lowSlope - 1e-10 {
                    i = lowIdx
                    y = gates[i].lower
                    knots.append(MarqueeKnot(time: gates[i].time, offset: y))
                    bent = true
                    break
                }
                if sL >= lowSlope {
                    lowSlope = sL
                    lowIdx = j
                }
                if sU <= highSlope {
                    highSlope = sU
                    highIdx = j
                }
            }
            if !bent {
                knots.append(MarqueeKnot(time: gates[n - 1].time, offset: gates[n - 1].lower))
                break
            }
        }
        return pruneCollinear(knots)
    }

    private static func pruneCollinear(_ knots: [MarqueeKnot]) -> [MarqueeKnot] {
        guard knots.count > 2 else { return knots }
        var pruned: [MarqueeKnot] = [knots[0]]
        for i in 1..<(knots.count - 1) {
            let a = pruned[pruned.count - 1]
            let b = knots[i]
            let c = knots[i + 1]
            let dt1 = b.time - a.time
            let dt2 = c.time - b.time
            if dt1 > 0 && dt2 > 0 {
                let s1 = (b.offset - a.offset) / dt1
                let s2 = (c.offset - b.offset) / dt2
                if abs(s1 - s2) * (c.time - a.time) <= 1e-7 {
                    continue
                }
            }
            pruned.append(b)
        }
        pruned.append(knots[knots.count - 1])
        return pruned
    }

    private static func evalPiecewise(_ knots: [MarqueeKnot], t: Double) -> Double {
        if t <= knots[0].time { return knots[0].offset }
        let last = knots[knots.count - 1]
        if t >= last.time { return last.offset }

        var lo = 0
        var hi = knots.count - 1
        while lo + 1 < hi {
            let mid = (lo + hi) >> 1
            if knots[mid].time <= t { lo = mid } else { hi = mid }
        }
        let a = knots[lo]
        let b = knots[hi]
        let dt = b.time - a.time
        return dt > 0 ? a.offset + (b.offset - a.offset) * (t - a.time) / dt : b.offset
    }

    private static func integrateWeighted(
        _ knots: [MarqueeKnot],
        from: Double,
        to: Double,
        wFrom: Double,
        wTo: Double
    ) -> Double {
        guard !knots.isEmpty, to > from else { return 0 }
        let span = to - from
        func simpson(lo: Double, hi: Double, fLo: Double, fHi: Double) -> Double {
            let len = hi - lo
            if len <= 0 { return 0 }
            let mid = (lo + hi) * 0.5
            let fMid = (fLo + fHi) * 0.5
            let wLo = wFrom + (wTo - wFrom) * (lo - from) / span
            let wMid = wFrom + (wTo - wFrom) * (mid - from) / span
            let wHi = wFrom + (wTo - wFrom) * (hi - from) / span
            return (len / 6.0) * (fLo * wLo + 4.0 * fMid * wMid + fHi * wHi)
        }

        var sum = 0.0
        let first = knots[0]
        let last = knots[knots.count - 1]
        if from < first.time {
            sum += simpson(lo: from, hi: min(to, first.time), fLo: first.offset, fHi: first.offset)
        }
        for i in 1..<knots.count {
            let a = knots[i - 1]
            let b = knots[i]
            let lo = max(from, a.time)
            let hi = min(to, b.time)
            if hi <= lo { continue }
            let dt = b.time - a.time
            let fLo = dt > 0 ? a.offset + (b.offset - a.offset) * (lo - a.time) / dt : b.offset
            let fHi = dt > 0 ? a.offset + (b.offset - a.offset) * (hi - a.time) / dt : b.offset
            sum += simpson(lo: lo, hi: hi, fLo: fLo, fHi: fHi)
        }
        if to > last.time {
            sum += simpson(lo: max(from, last.time), hi: to, fLo: last.offset, fHi: last.offset)
        }
        return sum
    }

    private static func clamp(_ v: Double, _ lo: Double, _ hi: Double) -> Double {
        min(hi, max(lo, v))
    }
}
