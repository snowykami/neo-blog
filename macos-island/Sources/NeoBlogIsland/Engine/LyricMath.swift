import Foundation

// MARK: - 1:1 对应 web/src/lib/lyrics/config.ts 的物理与视觉常量

enum LyricMotionPreset: String, Sendable, CaseIterable {
    case plush
    case flow
    case bouncy
    case crisp
    case gentle
    case cascade

    var stiffness: Double {
        switch self {
        case .plush: return 90
        case .flow: return 142
        case .bouncy: return 165
        case .crisp: return 360
        case .gentle: return 68
        case .cascade: return 162
        }
    }

    var dampingRatio: Double {
        switch self {
        case .plush: return 0.64
        case .flow: return 0.78
        case .bouncy: return 0.63
        case .crisp: return 0.90
        case .gentle: return 0.96
        case .cascade: return 0.74
        }
    }

    var scaleStiffness: Double {
        switch self {
        case .plush: return 98
        case .flow: return 155
        case .bouncy: return 180
        case .crisp: return 400
        case .gentle: return 76
        case .cascade: return 175
        }
    }

    var scaleDampingRatio: Double {
        switch self {
        case .plush: return 0.68
        case .flow: return 0.82
        case .bouncy: return 0.66
        case .crisp: return 0.92
        case .gentle: return 0.96
        case .cascade: return 0.78
        }
    }

    var staggerBaseSec: Double {
        switch self {
        case .plush: return 0.066
        case .flow: return 0.060
        case .bouncy: return 0.036
        case .crisp: return 0.014
        case .gentle: return 0.085
        case .cascade: return 0.068
        }
    }

    var focusDelayMul: Double {
        switch self {
        case .plush: return 0.45
        case .flow: return 0.45
        case .bouncy: return 0.30
        case .crisp: return 0.0
        case .gentle: return 0.55
        case .cascade: return 0.40
        }
    }

    var inactiveScale: Double {
        switch self {
        case .plush: return 0.895
        case .flow: return 0.905
        case .bouncy: return 0.885
        case .crisp: return 0.885
        case .gentle: return 0.925
        case .cascade: return 0.880
        }
    }

    var wordFloatEm: Double {
        switch self {
        case .plush: return 0.10
        case .flow: return 0.09
        case .bouncy: return 0.12
        case .crisp: return 0.06
        case .gentle: return 0.08
        case .cascade: return 0.10
        }
    }

    var arcPx: Double {
        switch self {
        case .plush: return 5.0
        case .flow: return 8.0
        case .bouncy: return 0.0
        case .crisp: return 0.0
        case .gentle: return 4.0
        case .cascade: return 16.0
        }
    }

    var tiltDeg: Double {
        switch self {
        case .plush: return 0.0
        case .flow: return 0.0
        case .bouncy: return -0.45
        case .crisp: return 0.0
        case .gentle: return 0.0
        case .cascade: return 1.7
        }
    }

    var blurInTau: Double {
        switch self {
        case .plush: return 0.14
        case .flow: return 0.11
        case .bouncy: return 0.055
        case .crisp: return 0.03
        case .gentle: return 0.26
        case .cascade: return 0.12
        }
    }

    var blurOutTau: Double {
        switch self {
        case .plush: return 0.22
        case .flow: return 0.20
        case .bouncy: return 0.13
        case .crisp: return 0.08
        case .gentle: return 0.34
        case .cascade: return 0.22
        }
    }

    var bounceBell: Double {
        switch self {
        case .plush: return 0.18
        case .flow: return 0.0
        case .bouncy: return 0.26
        case .crisp: return 0.0
        case .gentle: return 0.0
        case .cascade: return 0.0
        }
    }
}

struct ResolvedMotionSprings: Equatable, Sendable {
    let position: SpringParams
    let scale: SpringParams
    let staggerBaseSec: Double
    let focusDelayMul: Double
    let inactiveScale: Double
    let wordFloatEm: Double
    let arcPx: Double
    let tiltDeg: Double
    let blurInTau: Double
    let blurOutTau: Double
    let bounceBell: Double
}

enum LyricSpecs {
    static let alignPosition: Double = 0.35
    static let compactAlignPosition: Double = 0.40
    static let compactBlurFactor: Double = 0.50

    /// 1:1 对齐 web/src/lib/lyrics/config.ts resolveMotionSprings：
    /// 连续快句推进间隔 < 420ms 时自动收紧阻尼比至 ≥ 0.85 并提升刚度下限，防止 Q 弹/舒缓档在密集快嘴段乱晃
    static func resolveMotionSprings(motion: String? = nil, stepIntervalMs: Double? = nil) -> ResolvedMotionSprings {
        let preset = motion.flatMap(LyricMotionPreset.init(rawValue:)) ?? .flow
        var k = preset.stiffness
        var zeta = preset.dampingRatio
        var scaleK = preset.scaleStiffness
        var scaleZeta = preset.scaleDampingRatio
        if let stepMs = stepIntervalMs, stepMs > 0, stepMs < 420 {
            let t = 1.0 - max(0.0, stepMs - 160.0) / 260.0
            k = max(k, k + (230.0 - k) * t)
            zeta = max(zeta, zeta + (0.85 - zeta) * t)
            scaleK = max(scaleK, scaleK + (250.0 - scaleK) * t)
            scaleZeta = max(scaleZeta, scaleZeta + (0.88 - scaleZeta) * t)
        }
        return ResolvedMotionSprings(
            position: SpringParams(mass: 1, stiffness: k, damping: 2.0 * zeta * k.squareRoot()),
            scale: SpringParams(mass: 1, stiffness: scaleK, damping: 2.0 * scaleZeta * scaleK.squareRoot()),
            staggerBaseSec: preset.staggerBaseSec,
            focusDelayMul: preset.focusDelayMul,
            inactiveScale: preset.inactiveScale,
            wordFloatEm: preset.wordFloatEm,
            arcPx: preset.arcPx,
            tiltDeg: preset.tiltDeg,
            blurInTau: preset.blurInTau,
            blurOutTau: preset.blurOutTau,
            bounceBell: preset.bounceBell
        )
    }

    private static let defaultMotion = resolveMotionSprings(motion: "flow")

    static let positionSpring = defaultMotion.position
    static let scaleSpring = defaultMotion.scale
    static let bgExpandSpring = SpringParams(mass: 1, stiffness: 170, damping: 26)

    static let inactiveScale: Double = defaultMotion.inactiveScale
    static let bgCollapsedScale: Double = 0.88
    static let inactiveAlpha: Double = 0.35
    static let inactiveAlphaLineTimed: Double = 0.25

    static let featherEm: Double = 0.5
    static let animationHeadstartMs: Double = 100
    static let wordFloatEm: Double = 0.05
    static let emphasisMinMs: Double = 1000
    static let maxFrameSec: Double = 0.1

    // 单行条分层（对齐 lyric-player.ts STRIP_TIER_*）
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

struct SpringParams: Equatable, Sendable {
    let mass: Double
    let stiffness: Double
    let damping: Double
}

final class DampedSpring {
    private(set) var position: Double
    private(set) var velocity: Double = 0
    private(set) var target: Double
    private var delay: Double = 0
    private var params: SpringParams

    private static let subStep: Double = 1.0 / 120.0
    private static let restDistance: Double = 0.01
    private static let restVelocity: Double = 0.01

    init(initial: Double, params: SpringParams) {
        self.position = initial
        self.target = initial
        self.params = params
    }

    func setParams(_ newParams: SpringParams) {
        if params != newParams {
            params = newParams
        }
    }

    func setTarget(_ newTarget: Double, delay newDelay: Double? = nil) {
        let delta = newTarget - position
        if let newDelay {
            if newDelay > 0 && abs(velocity) > 8.0 && delta * velocity > 0 {
                delay = min(newDelay * 0.2, 0.014)
            } else {
                delay = newDelay
            }
        }
        target = newTarget
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
