import Foundation

// MARK: - 1:1 对应 web/src/lib/lyrics/rhythm/effects.ts & params.ts & interlude.ts

struct RhythmPulsePoint: Equatable {
    let t: Double
    let a: Double
}

struct RhythmEngineContext: Equatable {
    let reliable: Bool
    let basePeriodMs: Double
    /// octave (-1, 0, 1, 2) -> 脉冲序列（按 t 升序）
    let trains: [Int: [RhythmPulsePoint]]

    static let fallback = RhythmEngineContext(reliable: false, basePeriodMs: 750, trains: [:])

    // DEFAULT_RHYTHM_PARAMS
    static let leadMs: Double = 20
    static let heartbeatAttackMs: Double = 55
    static let heartbeatBeta: Double = 0.65
    static let heartbeatDelayRatio: Double = 0.3
    static let heartbeatDelayMinMs: Double = 140
    static let heartbeatDelayMaxMs: Double = 300
    static let swellTauMs: Double = 70
    static let swellGain: Double = 0.6
    static let waveWidthRatio: Double = 0.5
    static let shakeDecayMs: Double = 120
    static let shakeCarrierDivisor: Double = 16
    static let shimmerSweeps: Int = 2
    static let bgAttackMs: Double = 30
    static let bgDecayMs: Double = 150
    static let interludeTargetMs: Double = 2000
    static let interludeInhale: Double = 1.2
    static let interludeExhale: Double = 0.9

    var envelopeScale: Double {
        basePeriodMs / FixedLyricPace.medium.basePeriodMs
    }

    var nearestFixedPace: FixedLyricPace {
        if !reliable { return .medium }
        let tiers: [FixedLyricPace] = [.slow, .medium, .fast]
        return tiers.min(by: { abs($0.basePeriodMs - basePeriodMs) < abs($1.basePeriodMs - basePeriodMs) }) ?? .medium
    }

    func period(octave: Int) -> Double {
        basePeriodMs * pow(2.0, Double(octave))
    }

    func pulsesIn(octave: Int, origin: Double, t0: Double, t1: Double) -> [RhythmPulsePoint] {
        if reliable, let train = trains[octave], !train.isEmpty {
            var lo = 0
            var hi = train.count
            while lo < hi {
                let mid = (lo + hi) >> 1
                if train[mid].t < t0 { lo = mid + 1 } else { hi = mid }
            }
            var out: [RhythmPulsePoint] = []
            var idx = lo
            while idx < train.count && train[idx].t <= t1 {
                out.append(train[idx])
                idx += 1
            }
            return out
        }
        let T = max(80, period(octave: octave))
        var out: [RhythmPulsePoint] = []
        var k = max(0, Int(ceil((t0 - origin) / T - 1e-9)))
        while origin + Double(k) * T <= t1 {
            out.append(RhythmPulsePoint(t: origin + Double(k) * T, a: 1.0))
            k += 1
        }
        return out
    }

    func windowPulses(octave: Int, origin: Double, a: Double, b: Double) -> [RhythmPulsePoint] {
        let list = pulsesIn(octave: octave, origin: origin, t0: a, t1: b)
        if !list.isEmpty { return list }
        let fallbackList = pulsesIn(octave: octave, origin: origin, t0: a, t1: a + 2.2 * period(octave: octave))
        return fallbackList.first.map { [$0] } ?? []
    }

    private func convolve(_ pulses: [RhythmPulsePoint], at t: Double, kernel: (Double) -> Double) -> Double {
        var sum = 0.0
        for p in pulses {
            sum += p.a * kernel(t - p.t)
        }
        return sum
    }

    /// g_τ(t) = (t/τ)·e^(1 − t/τ)·u(t)
    static func alpha(_ t: Double, tau: Double) -> Double {
        t <= 0 ? 0 : (t / tau) * exp(1.0 - t / tau)
    }

    // MARK: - 各动效卷积响应

    func heartbeatLevel(start: Double, end: Double, timeMs: Double) -> Double {
        let Te = period(octave: 0)
        let list = windowPulses(octave: 0, origin: start, a: start - 60, b: end)
        let delta = min(Self.heartbeatDelayMaxMs, max(Self.heartbeatDelayMinMs, Self.heartbeatDelayRatio * Te))
        let val = convolve(list, at: timeMs + Self.leadMs) { dt in
            Self.alpha(dt, tau: Self.heartbeatAttackMs) + Self.heartbeatBeta * Self.alpha(dt - delta, tau: Self.heartbeatAttackMs)
        }
        return min(1.2, val)
    }

    func swellAccent(start: Double, timeMs: Double) -> Double {
        let at = timeMs + Self.leadMs
        let list = pulsesIn(octave: 0, origin: start, t0: at - 8.0 * Self.swellTauMs, t1: at)
        return convolve(list, at: at) { dt in Self.alpha(dt, tau: Self.swellTauMs) }
    }

    func glowLevel(start: Double, lineEnd: Double, timeMs: Double) -> (gate: Double, y: Double) {
        let gate = clamp01((timeMs - start + 150) / 300) * clamp01(1.0 - (timeMs - lineEnd) / 400)
        if gate <= 0 { return (0, 0) }
        let Te = period(octave: 1)
        let list = windowPulses(octave: 1, origin: start, a: start - 60, b: lineEnd)
        let y = min(1.0, convolve(list, at: timeMs + Self.leadMs) { dt in
            guard abs(dt) < Te * 0.5 else { return 0 }
            let c = cos(.pi * dt / Te)
            return c * c
        })
        return (gate, y)
    }

    func waveLevels(start: Double, end: Double, count: Int, timeMs: Double) -> [Double] {
        let Te = period(octave: 0)
        let delta = count > 1 ? 0.5 * Te / Double(count - 1) : 0
        let w = Self.waveWidthRatio * Te
        let list = windowPulses(octave: 0, origin: start, a: start - 60, b: end)
        let at = timeMs + Self.leadMs
        return (0..<count).map { i in
            min(1.2, convolve(list, at: at - Double(i) * delta) { dt in
                (dt >= 0 && dt < w) ? sin(.pi * dt / w) : 0
            })
        }
    }

    func shakeLevel(start: Double, until: Double, timeMs: Double) -> Double {
        let list = windowPulses(octave: -1, origin: start, a: start - 60, b: until)
        return min(1.0, convolve(list, at: timeMs + Self.leadMs) { dt in
            dt < 0 ? 0 : exp(-dt / Self.shakeDecayMs)
        })
    }

    var shakeCarrierMs: Double {
        basePeriodMs / Self.shakeCarrierDivisor
    }

    func shimmerCenter(start: Double, timeMs: Double, count: Int) -> Double? {
        let at = timeMs + Self.leadMs
        let Te = period(octave: 0)
        let list = pulsesIn(octave: 0, origin: start, t0: start - 120, t1: start + Double(Self.shimmerSweeps + 2) * Te * 1.5)
        for k in 0..<Self.shimmerSweeps where k + 1 < list.count {
            if at >= list[k].t && at < list[k + 1].t {
                return ((at - list[k].t) / max(1, list[k + 1].t - list[k].t)) * Double(count + 2) - 1.0
            }
        }
        return nil
    }

    var dissolveFadeMs: Double {
        0.8 * basePeriodMs
    }

    /// 胶囊背景与律动条随真实拍点的呼吸强度（0 ~ 1）
    func backgroundLevel(timeMs: Double) -> Double {
        guard reliable else { return 0 }
        let at = timeMs + Self.leadMs
        let list = pulsesIn(octave: 0, origin: 0, t0: at - 1000, t1: at)
        return min(1.0, convolve(list, at: at) { dt in
            dt < 0 ? 0 : min(1.0, dt / Self.bgAttackMs) * exp(-dt / Self.bgDecayMs)
        })
    }

    /// 粒子在 (t0, t1] 内经过的拍点（含 20ms 视觉提前量）；不跟随节拍时返回 nil
    func particlePulses(octave: Int, t0: Double, t1: Double) -> [RhythmPulsePoint]? {
        guard reliable else { return nil }
        return pulsesIn(octave: octave, origin: 0, t0: t0 + Self.leadMs + 1e-6, t1: t1 + Self.leadMs)
    }

    /// 摇摆类粒子对齐真实拍点的连续钟摆相位（-1 ~ 1，一拍左一拍右，拍点处速度为零平滑换向）；不跟随节拍时为 nil
    func particleSway(timeMs: Double) -> Double? {
        guard reliable else { return nil }
        let T = max(120, period(octave: 0))
        let at = timeMs + Self.leadMs
        guard let train = trains[0], !train.isEmpty else {
            return -cos(.pi * at / T)
        }
        var lo = 0
        var hi = train.count
        while lo < hi {
            let mid = (lo + hi) >> 1
            if train[mid].t < at { lo = mid + 1 } else { hi = mid }
        }
        let idx = lo
        if idx > 0 && idx < train.count {
            let t0 = train[idx - 1].t
            let span = train[idx].t - t0
            if span > 40 && span <= 2.5 * T {
                let u = (at - t0) / span
                return -cos(.pi * (Double(idx - 1) + u))
            }
        }
        let anchorIdx = idx > 0 ? (idx - 1) : 0
        return -cos(.pi * (Double(anchorIdx) + (at - train[anchorIdx].t) / T))
    }

    /// 粒子动作相对中速（750ms）的曲速缩放倍率（0.65 ~ 1.55）
    var particleTempoScale: Double {
        min(1.55, max(0.65, FixedLyricPace.medium.basePeriodMs / max(120, basePeriodMs)))
    }

    // MARK: - 1:1 对应 interlude.ts（间奏圆点倒计时点亮、呼吸、吸气放大与收拢退场）

    struct InterludeDotState {
        let opacity: Double
        let scale: Double
    }

    func interludeDots(start: Double, end: Double, timeMs: Double, count: Int = 3) -> [InterludeDotState] {
        guard timeMs >= start && timeMs < end else {
            return Array(repeating: InterludeDotState(opacity: 0, scale: 1), count: count)
        }
        let oct = max(0, min(2, Int(round(log2(Self.interludeTargetMs / max(100, basePeriodMs))))))
        let beatMs = period(octave: 0)
        let breathMs = period(octave: oct)
        let origin = reliable ? start : (end - ceil((end - start) / breathMs) * breathMs)
        let beats = pulsesIn(octave: 0, origin: origin, t0: start, t1: end + 80).map(\.t)

        let near = beats.filter { $0 >= end - 0.6 * beatMs && $0 <= end + 80 }
        let onEntry = near.filter { abs($0 - end) <= 80 }
        let entry = max(start, min(end, onEntry.first ?? near.last ?? end))
        let vanishAt = max(start, entry - 500)
        let exitAt = Self.snap(beats: beats, target: entry - 1800, lo: start, hi: vanishAt)
        let lightFrom = min(start + 1000, exitAt)

        var lit: [Double] = []
        for i in 0..<count {
            let prev = i > 0 ? lit[i - 1] : lightFrom
            let targetT = lightFrom + Double(i + 1) * (exitAt - lightFrom) / Double(count)
            lit.append(i == count - 1 ? exitAt : Self.snap(beats: beats, target: targetT, lo: prev, hi: exitAt))
        }

        var scale = breathScale(octave: oct, start: start, until: exitAt, timeMs: timeMs, origin: origin)
        var fade = 1.0
        if timeMs >= exitAt {
            let base = breathScale(octave: oct, start: start, until: exitAt, timeMs: exitAt, origin: origin)
            let swellSpan = max(1, min(1000, vanishAt - exitAt))
            scale = base + (Self.interludeInhale - base) * CubicBezier.swellEase.eval(clamp01((timeMs - exitAt) / swellSpan))
            if timeMs >= vanishAt {
                let shrinkSpan = max(1, entry - vanishAt)
                scale = Self.interludeInhale + (0.2 - Self.interludeInhale) * CubicBezier.easeIn.eval(clamp01((timeMs - vanishAt) / shrinkSpan))
                fade = 1.0 - CubicBezier.easeIn.eval(clamp01((timeMs - vanishAt) / min(300, shrinkSpan)))
            }
        }

        return (0..<count).map { i in
            let appear = clamp01((timeMs - start - Double(i) * 60) / 800)
            let prevLit = i > 0 ? lit[i - 1] : lightFrom
            let litProgress = lit[i] > prevLit ? clamp01((timeMs - prevLit) / (lit[i] - prevLit)) : (timeMs >= lit[i] ? 1 : 0)
            let brightness = 0.1 + 0.9 * litProgress
            return InterludeDotState(opacity: appear * brightness * fade, scale: scale)
        }
    }

    private func breathScale(octave: Int, start: Double, until: Double, timeMs: Double, origin: Double) -> Double {
        let now = min(timeMs, until)
        let list = pulsesIn(octave: octave, origin: origin, t0: start, t1: now)
        let j = list.count
        if j == 0 { return 1.0 }
        let target = (j % 2 == 1) ? Self.interludeInhale : Self.interludeExhale
        let from = (j == 1) ? 1.0 : ((j % 2 == 1) ? Self.interludeExhale : Self.interludeInhale)
        let p = clamp01((now - list[j - 1].t - 30) / (0.8 * period(octave: octave)))
        return from + (target - from) * CubicBezier.easeOut.eval(p)
    }

    private static func snap(beats: [Double], target: Double, lo: Double, hi: Double) -> Double {
        var best = min(hi, max(lo, target))
        var dist = Double.infinity
        for b in beats where b >= lo && b <= hi {
            let d = abs(b - target)
            if d < dist {
                dist = d
                best = b
            }
        }
        return best
    }

    private func clamp01(_ x: Double) -> Double {
        min(1, max(0, x))
    }
}
