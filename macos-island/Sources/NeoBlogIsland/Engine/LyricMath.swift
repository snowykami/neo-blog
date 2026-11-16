import Foundation

// MARK: - 1:1 对应 web/src/lib/lyrics/config.ts 的物理与视觉常量

enum LyricSpecs {
    static let alignPosition: Double = 0.35
    static let compactAlignPosition: Double = 0.40
    static let compactBlurFactor: Double = 0.50

    static let positionSpring = SpringParams(mass: 1, stiffness: 100, damping: 18)
    static let scaleSpring = SpringParams(mass: 1, stiffness: 100, damping: 20)
    static let bgExpandSpring = SpringParams(mass: 1, stiffness: 170, damping: 26)

    static let inactiveScale: Double = 0.97
    static let bgCollapsedScale: Double = 0.88
    static let inactiveAlpha: Double = 0.35
    static let inactiveAlphaLineTimed: Double = 0.25

    static let featherEm: Double = 0.5
    static let animationHeadstartMs: Double = 100
    static let wordFloatEm: Double = 0.05
    static let emphasisMinMs: Double = 1000
    static let maxFrameSec: Double = 0.1

    // 单行条分层（对齐 lyric-player.ts STRIP_TIER_*）
    static let stripTierMinHeightPx: Double = 32
    static let stripTierTop: Double = -0.21
    static let stripTierBottom: Double = 0.24
    static let stripTierScale: Double = 0.90

    // 强调错开与上浮（对齐 lyric-player.ts EMPHASIS_*）
    static let emphasisStaggerRatio: Double = 1.0 / 2.5
    static let emphasisFloatLeadMs: Double = 400
    static let emphasisFloatStretch: Double = 1.4
    static let emphasisFocusClearRatio: Double = 0.6
    static let emphasisTintPeak: Double = 0.85
    static let emphasisTintHold: Double = 0.60
}

// MARK: - 1:1 对应 web/src/lib/lyrics/easing.ts（三次贝塞尔牛顿迭代 + 二分求解）

struct CubicBezier {
    private let ax: Double
    private let bx: Double
    private let cx: Double
    private let ay: Double
    private let by: Double
    private let cy: Double

    init(_ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double) {
        cx = 3.0 * x1
        bx = 3.0 * (x2 - x1) - cx
        ax = 1.0 - cx - bx
        cy = 3.0 * y1
        by = 3.0 * (y2 - y1) - cy
        ay = 1.0 - cy - by
    }

    private func sampleX(_ t: Double) -> Double { ((ax * t + bx) * t + cx) * t }
    private func sampleY(_ t: Double) -> Double { ((ay * t + by) * t + cy) * t }
    private func slopeX(_ t: Double) -> Double { (3.0 * ax * t + 2.0 * bx) * t + cx }

    private func solve(_ x: Double) -> Double {
        var t = x
        for _ in 0..<8 {
            let err = sampleX(t) - x
            if abs(err) < 1e-5 { return t }
            let d = slopeX(t)
            if abs(d) < 1e-6 { break }
            t -= err / d
        }
        var lo = 0.0
        var hi = 1.0
        t = x
        for _ in 0..<20 {
            if sampleX(t) < x { lo = t } else { hi = t }
            t = (lo + hi) * 0.5
        }
        return t
    }

    func eval(_ x: Double) -> Double {
        if x <= 0 { return 0 }
        if x >= 1 { return 1 }
        return sampleY(solve(x))
    }

    static let swellIn = CubicBezier(0.2, 0.4, 0.58, 1.0)
    static let swellOut = CubicBezier(0.3, 0.0, 0.58, 1.0)
    static let easeOut = CubicBezier(0.0, 0.0, 0.58, 1.0)
    static let easeIn = CubicBezier(0.42, 0.0, 1.0, 1.0)
    static let swellEase = CubicBezier(0.25, 0.1, 0.25, 1.0)

    /// 强调起落曲线：前半程快升，后半程缓落，中点为 1
    static func swellCurve(_ x: Double) -> Double {
        if x <= 0 || x >= 1 { return 0 }
        return x < 0.5 ? swellIn.eval(x / 0.5) : (1.0 - swellOut.eval((x - 0.5) / 0.5))
    }
}

// MARK: - 1:1 对应 web/src/lib/lyrics/spring.ts（1/120s 半隐式欧拉阻尼弹簧）

struct SpringParams: Equatable {
    let mass: Double
    let stiffness: Double
    let damping: Double
}

final class DampedSpring {
    private(set) var position: Double
    private var velocity: Double = 0
    private(set) var target: Double
    private var delay: Double = 0
    private let params: SpringParams

    private static let subStep: Double = 1.0 / 120.0
    private static let restDistance: Double = 0.01
    private static let restVelocity: Double = 0.01

    init(initial: Double, params: SpringParams) {
        self.position = initial
        self.target = initial
        self.params = params
    }

    func setTarget(_ newTarget: Double, delay newDelay: Double? = nil) {
        target = newTarget
        if let newDelay { delay = newDelay }
    }

    func jump(_ newTarget: Double) {
        target = newTarget
        position = newTarget
        velocity = 0
        delay = 0
    }

    var resting: Bool {
        delay <= 0 && abs(position - target) < Self.restDistance && abs(velocity) < Self.restVelocity
    }

    func step(dt rawDt: Double) {
        var dt = min(LyricSpecs.maxFrameSec, max(0, rawDt))
        if delay > 0 {
            delay -= dt
            if delay > 0 { return }
            dt = -delay
            delay = 0
        }
        var remaining = dt
        while remaining > 0 {
            let h = min(Self.subStep, remaining)
            let accel = (-params.stiffness * (position - target) - params.damping * velocity) / params.mass
            velocity += accel * h
            position += velocity * h
            remaining -= Self.subStep
        }
        if resting {
            position = target
            velocity = 0
        }
    }
}

// MARK: - 1:1 对应 web/src/lib/lyrics/pace.ts & vibrato.ts & word-effects.ts

enum FixedLyricPace: String {
    case slow
    case medium
    case fast

    var basePeriodMs: Double {
        switch self {
        case .slow: return 1000
        case .medium: return 750
        case .fast: return 520
        }
    }

    var vibratoHz: Double {
        switch self {
        case .slow: return 4.8
        case .medium: return 5.5
        case .fast: return 6.5
        }
    }

    var vibratoDelayRatio: Double {
        switch self {
        case .slow: return 0.28
        case .medium: return 0.20
        case .fast: return 0.14
        }
    }
}

struct HoldVibratoState {
    let onset: Double
    let release: Double
    let amount: Double
}

enum LyricWordEffects {
    private static let vibratoDelayMinMs: Double = 250
    private static let vibratoDelayMaxMs: Double = 700
    private static let vibratoRampMs: Double = 360
    private static let vibratoReleaseMs: Double = 300

    private static let dissolveDelayMs: Double = 150
    private static let dissolveHoldMs: Double = 12000
    private static let dissolveRestoreMs: Double = 1500
    private static let shatterDelayMs: Double = 60
    private static let shatterCrackMs: Double = 140
    private static let shatterFlashDecayMs: Double = 220

    static func holdVibrato(start: Double, end: Double, timeMs: Double, pace: FixedLyricPace) -> HoldVibratoState {
        let delay = min(vibratoDelayMaxMs, max(vibratoDelayMinMs, (end - start) * pace.vibratoDelayRatio))
        let onset = start + delay
        let release = timeMs < end ? 1.0 : max(0, 1.0 - (timeMs - end) / vibratoReleaseMs)
        let amount = min(1.0, max(0, (timeMs - onset) / vibratoRampMs)) * release
        return HoldVibratoState(onset: onset, release: release, amount: amount)
    }

    static func vibratoWave(timeMs: Double, onset: Double, charIndex: Int, pace: FixedLyricPace) -> Double {
        sin(2.0 * .pi * pace.vibratoHz * (timeMs - onset) / 1000.0 - Double(charIndex) * 0.35)
    }

    static func dissolveState(
        start: Double,
        end: Double,
        charIndex: Int,
        count: Int,
        timeMs: Double,
        seekAt: Double,
        fadeMs: Double
    ) -> (at: Double, amount: Double) {
        let charEnd = start + (end - start) * Double(charIndex + 1) / Double(max(1, count))
        let at = charEnd + dissolveDelayMs
        if at < seekAt { return (at, 0) }
        let out = min(1, max(0, (timeMs - at) / max(1, fadeMs)))
        let back = min(1, max(0, (timeMs - at - dissolveHoldMs) / dissolveRestoreMs))
        return (at, out * (1.0 - back))
    }

    static func shatterState(
        end: Double,
        timeMs: Double,
        seekAt: Double
    ) -> (at: Double, crack: Double, amount: Double) {
        let at = end + shatterDelayMs
        if at < seekAt { return (at, 0, 0) }
        if timeMs < at {
            let crack = min(1, max(0, (timeMs - at + shatterCrackMs) / shatterCrackMs))
            return (at, crack, 0)
        }
        let back = min(1, max(0, (timeMs - at - dissolveHoldMs) / dissolveRestoreMs))
        return (at, 0, 1.0 - back)
    }

    static func shatterFlash(end: Double, timeMs: Double) -> Double {
        let t = timeMs - end - shatterDelayMs
        if t < 0 || t > shatterFlashDecayMs * 5 { return 0 }
        return exp(-t / shatterFlashDecayMs)
    }
}
