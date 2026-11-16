import Foundation
import Observation
import SwiftUI

// MARK: - 1:1 对应 web/src/lib/lyrics/colors.ts、stage-effects.ts 与 stage-particles.ts
// 【双端同步维护约定】小窗与胶囊的背景呼吸、副歌爆发、短语/多声部方向性染色、聚光灯暖光及 18 种内置场景 + 自定义 SVG 粒子均与前端对齐。

enum LyricColorPalette {
    static let map: [String: String] = [
        "crimson": "#ff5c6c",
        "rose": "#ff6f91",
        "flame": "#ff6a3d",
        "sunset": "#ff8a65",
        "coral": "#ff9f80",
        "maple": "#ff7f3f",
        "amber": "#ffb347",
        "peach": "#ffa8a0",
        "cherry-blossom": "#ffb3c8",
        "bauhinia": "#e86fb0",
        "sunshine": "#ffd54f",
        "gold": "#f5c542",
        "lemon": "#fff176",
        "candlelight": "#ffe0a3",
        "spring-green": "#a5e887",
        "forest": "#5fd38d",
        "mint": "#8ef0c8",
        "jade": "#3fcf9e",
        "aurora": "#6effd0",
        "lake": "#4fd1d9",
        "sky": "#74c0fc",
        "ocean": "#3d9df5",
        "starry-blue": "#6c8cff",
        "midnight": "#7b83eb",
        "ice": "#b5e8ff",
        "rain": "#9bb7d4",
        "lavender": "#c3a6ff",
        "violet": "#a77bff",
        "twilight": "#b388eb",
        "wisteria": "#d4a5f5",
        "moonlight": "#f0f4ff",
        "silver": "#d7dde8"
    ]

    static let festive: [String] = [
        "crimson", "amber", "sunshine", "spring-green",
        "lake", "starry-blue", "lavender", "cherry-blossom"
    ]

    static func resolveHex(_ nameOrHex: String) -> String {
        if nameOrHex.hasPrefix("#") {
            return nameOrHex
        }
        return map[nameOrHex] ?? "#ffffff"
    }

    static func resolveRGB(_ nameOrHex: String) -> (r: Double, g: Double, b: Double) {
        Color.parseRGBComponents(resolveHex(nameOrHex))
    }

    static func mixWhite(_ rgb: (r: Double, g: Double, b: Double), t: Double) -> (r: Double, g: Double, b: Double) {
        let clamped = max(0, min(1, t))
        return (
            rgb.r + (1.0 - rgb.r) * clamped,
            rgb.g + (1.0 - rgb.g) * clamped,
            rgb.b + (1.0 - rgb.b) * clamped
        )
    }
}

// MARK: - 舞台信号求解器（1:1 对应 stage-effects.ts getStageSignals & spotlightAt）

struct ResolvedStageScene: Equatable {
    let name: String
    let colorHex: String?
    let sprite: LyricSpritePayload?

    var cacheKey: String {
        "\(name):\(colorHex ?? "")"
    }
}

struct StageSignalsSnapshot: Equatable {
    var pulse: Double = 0
    var burst: Double = 0
    var spotlightLine: Int? = nil
    var spotlightLevel: Double = 0
    var tintColorHex: String? = nil
    var tintStrength: Double = 0
    var vocalShiftRatio: Double = 0
    var scene: ResolvedStageScene? = nil

    static let zero = StageSignalsSnapshot()
}

enum StageSignalsSolver {
    private static let pulseMinMs: Double = 1000
    private static let tintAttackMs: Double = 300
    private static let tintReleaseMs: Double = 1500
    private static let burstAttackMs: Double = 200
    private static let burstReleaseMs: Double = 1800
    private static let spotlightLeadMs: Double = 200
    private static let spotlightAttackMs: Double = 500
    private static let spotlightReleaseMs: Double = 600
    private static let sceneDefaultMaxLines: Int = 8
    private static let vocalTintFactor: Double = 0.42
    private static let shatterWindowMs: Double = 60 + 220 * 5

    static func spotlightAt(lyrics: LyricsBundlePayload, timeMs: Double) -> (line: Int, level: Double)? {
        guard !lyrics.spotlights.isEmpty else { return nil }
        var best: (line: Int, level: Double)? = nil
        for idx in lyrics.spotlights where lyrics.lines.indices.contains(idx) {
            let line = lyrics.lines[idx]
            let lv = spotlightEnvelope(start: line.start, end: line.end, timeMs: timeMs)
            if lv > 0, best == nil || lv > best!.level {
                best = (idx, lv)
            }
        }
        return best
    }

    static func compute(
        lyrics: LyricsBundlePayload,
        chorusRanges: [TimeIntervalRange],
        rhythm: RhythmEngineContext,
        timeMs: Double
    ) -> StageSignalsSnapshot {
        guard !lyrics.lines.isEmpty else { return .zero }

        var pulse = 0.0
        var burst = 0.0
        var bestPhraseTint: (hex: String, strength: Double)? = nil
        var bestVocalTint: (align: String, hex: String, strength: Double, start: Double)? = nil

        // 副歌爆发：支持行级 chorusStart 与曲目副歌区间起点
        var chorusStarts: [Double] = lyrics.lines.compactMap { $0.chorusStart ? $0.start : nil }
        if chorusStarts.isEmpty {
            chorusStarts = chorusRanges.map(\.start)
        }
        let burstWindow = burstAttackMs + burstReleaseMs
        for cStart in chorusStarts where timeMs >= cStart && timeMs <= cStart + burstWindow {
            burst = max(burst, burstEnvelope(start: cStart, timeMs: timeMs))
        }

        let envScale = rhythm.envelopeScale
        for line in lyrics.lines {
            for group in line.emphasis {
                switch group.effect {
                case "swell", "shake":
                    let baseDur = max(pulseMinMs, group.end - group.start)
                    if timeMs >= group.start && timeMs <= group.start + baseDur * 2.5 {
                        let dur = baseDur * envScale
                        pulse = max(pulse, CubicBezier.swellCurve((timeMs - group.start) / dur) * group.factor)
                    }
                case "heartbeat":
                    if timeMs >= group.start && timeMs <= group.end + 50 {
                        pulse = max(pulse, rhythm.heartbeatLevel(start: group.start, end: group.end, timeMs: timeMs) * group.factor)
                    }
                case "shatter":
                    if timeMs >= group.end && timeMs <= group.end + shatterWindowMs {
                        pulse = max(pulse, LyricWordEffects.shatterFlash(end: group.end, timeMs: timeMs) * group.factor)
                    }
                default:
                    break
                }

                if let cHex = group.colorHex, timeMs >= group.start && timeMs <= group.end + tintReleaseMs {
                    let s = tintEnvelope(start: group.start, end: group.end, timeMs: timeMs)
                    if s > 0, bestPhraseTint == nil || s > bestPhraseTint!.strength {
                        bestPhraseTint = (cHex, s)
                    }
                }
            }

            if !line.isBackground,
               let firstEdge = line.edgeColors?.first,
               timeMs >= line.start && timeMs <= line.end + tintReleaseMs {
                let s = tintEnvelope(start: line.start, end: line.end, timeMs: timeMs) * vocalTintFactor
                if s > 0,
                   bestVocalTint == nil || s > bestVocalTint!.strength || (s == bestVocalTint!.strength && line.start > bestVocalTint!.start) {
                    bestVocalTint = (line.align, firstEdge, s, line.start)
                }
            }
        }

        let chosenTint: (hex: String?, strength: Double) = {
            if let p = bestPhraseTint, bestVocalTint == nil || p.strength >= bestVocalTint!.strength {
                return (p.hex, p.strength)
            }
            if let v = bestVocalTint {
                return (v.hex, v.strength)
            }
            return (nil, 0)
        }()

        let vocalShift: Double = {
            guard let v = bestVocalTint else { return 0 }
            if v.align == "left" { return -0.07 }
            if v.align == "right" { return 0.07 }
            return 0
        }()

        let spot = spotlightAt(lyrics: lyrics, timeMs: timeMs)
        let activeScene = resolveActiveScene(lyrics: lyrics, timeMs: timeMs)

        return StageSignalsSnapshot(
            pulse: pulse,
            burst: burst,
            spotlightLine: spot?.line,
            spotlightLevel: spot?.level ?? 0,
            tintColorHex: chosenTint.hex,
            tintStrength: chosenTint.strength,
            vocalShiftRatio: vocalShift,
            scene: activeScene
        )
    }

    private static func resolveActiveScene(lyrics: LyricsBundlePayload, timeMs: Double) -> ResolvedStageScene? {
        let mainLines = lyrics.lines.filter { !$0.isBackground }
        guard !mainLines.isEmpty else { return nil }

        var currentMainIdx = -1
        for (i, line) in mainLines.enumerated() {
            if line.start <= timeMs {
                currentMainIdx = i
            } else {
                break
            }
        }
        guard currentMainIdx >= 0 else { return nil }

        for i in stride(from: currentMainIdx, through: 0, by: -1) {
            let candidate = mainLines[i]
            guard let rawName = candidate.scene, !rawName.isEmpty else { continue }

            var resolvedSprite: LyricSpritePayload? = nil
            if rawName.hasPrefix("custom:") {
                let spriteKey = String(rawName.dropFirst("custom:".count))
                guard let sp = lyrics.sprites[spriteKey] else { continue }
                resolvedSprite = sp
            }

            let span = (candidate.sceneLines ?? 0) > 0 ? candidate.sceneLines! : sceneDefaultMaxLines
            let lastIdx = min(mainLines.count - 1, i + span - 1)
            if currentMainIdx - i < span && timeMs <= mainLines[lastIdx].end {
                return ResolvedStageScene(
                    name: rawName,
                    colorHex: candidate.sceneColorHex,
                    sprite: resolvedSprite
                )
            }
            return nil
        }
        return nil
    }

    private static func spotlightEnvelope(start: Double, end: Double, timeMs: Double) -> Double {
        let t = timeMs - (start - spotlightLeadMs)
        if t < 0 || timeMs >= end + spotlightReleaseMs {
            return 0
        }
        let level = timeMs <= end
            ? min(1.0, t / spotlightAttackMs)
            : (1.0 - (timeMs - end) / spotlightReleaseMs)
        return level * level * (3.0 - 2.0 * level)
    }

    private static func burstEnvelope(start: Double, timeMs: Double) -> Double {
        let t = timeMs - start
        if t < 0 || t > burstAttackMs + burstReleaseMs { return 0 }
        if t <= burstAttackMs { return t / burstAttackMs }
        let decay = 1.0 - (t - burstAttackMs) / burstReleaseMs
        return decay * decay
    }

    private static func tintEnvelope(start: Double, end: Double, timeMs: Double) -> Double {
        if timeMs < start { return 0 }
        if timeMs <= end { return min(1.0, (timeMs - start) / tintAttackMs) }
        return max(0.0, 1.0 - (timeMs - end) / tintReleaseMs)
    }
}

// MARK: - 18 种内置场景 + 自定义 SVG 精灵粒子引擎（1:1 对应 stage-particles.ts）

@Observable
@MainActor
final class StageParticlesEngine {
    private struct StageParticle {
        let sceneName: String
        let key: String
        let sprite: LyricSpritePayload?
        let rgb: (r: Double, g: Double, b: Double)
        var x: Double
        var y: Double
        let vx: Double
        let vy: Double
        let size: Double
        var rotation: Double
        let spin: Double
        var age: Double
        let life: Double
        let seed: Double
        var leave: Double
        let onBeat: Bool
    }

    private static let baseArea: Double = 1280.0 * 800.0
    private static let densityIn: Double = 0.6
    private static let densityOut: Double = 0.8
    private static let leaveSeconds: Double = 1.2
    private static let marginBase: Double = 60.0
    private static let spriteMaxCount: Int = 40
    private static let spriteMaxAlpha: Double = 0.75
    private static let noteGlyphs: [String] = ["♪", "♫", "♬", "♩"]

    let particleScale: Double
    let maxParticles: Int

    /// 遵循 swiftui-expert-skill：热路径粒子状态全部标记 @ObservationIgnored，仅在活跃状态切换瞬间通知外层开闭画布帧循环
    private(set) var hasActiveParticles: Bool = false

    @ObservationIgnored private var particles: [StageParticle] = []
    @ObservationIgnored private var density: Double = 0
    @ObservationIgnored private var currentScene: ResolvedStageScene? = nil
    @ObservationIgnored private var pending: Double = 0
    @ObservationIgnored private var lastStepDate: Date? = nil
    @ObservationIgnored private var lastTimeMs: Double? = nil
    @ObservationIgnored private var compiledSprites: [String: [(paint: String, path: Path)]] = [:]

    init(scale: Double = 0.7, maxParticles: Int = 80) {
        self.particleScale = scale
        self.maxParticles = maxParticles
    }

    func reset() {
        particles.removeAll()
        density = 0
        currentScene = nil
        pending = 0
        lastStepDate = nil
        lastTimeMs = nil
        compiledSprites.removeAll()
        syncActiveFlag()
    }

    private func syncActiveFlag() {
        let active = !particles.isEmpty || density > 0.001
        if hasActiveParticles != active {
            hasActiveParticles = active
        }
    }

    func stepAndDraw(
        in context: inout GraphicsContext,
        size: CGSize,
        date: Date,
        timeMs: Double,
        scene: ResolvedStageScene?,
        isPlaying: Bool,
        rhythm: RhythmEngineContext
    ) {
        let w = Double(size.width)
        let h = Double(size.height)
        guard w > 4, h > 4 else { return }

        let dt: Double
        if let prev = lastStepDate {
            dt = min(0.05, max(0, date.timeIntervalSince(prev)))
        } else {
            dt = 1.0 / 60.0
        }
        lastStepDate = date

        let incomingKey = scene?.cacheKey ?? ""
        if incomingKey != (currentScene?.cacheKey ?? "") && density <= 0.0001 {
            currentScene = scene
        }

        let cur = currentScene
        let curKey = cur?.cacheKey ?? ""
        let targetDensity: Double = (isPlaying && cur != nil && incomingKey == curKey) ? 1.0 : 0.0
        if targetDensity > density {
            density = min(targetDensity, density + Self.densityIn * dt)
        } else {
            density = max(targetDensity, density - Self.densityOut * dt)
        }

        let prevMs = lastTimeMs
        lastTimeMs = timeMs
        let validBeatWindow = (prevMs != nil && timeMs > prevMs! && (timeMs - prevMs!) <= 500)
        let heartBeat: Double? = rhythm.reliable
            ? rhythm.heartbeatLevel(start: 0, end: timeMs + 2000, timeMs: timeMs)
            : nil

        if let cur, density > 0, isPlaying {
            let meta = sceneMeta(for: cur)
            let area = min(2.0, max(0.22, (w * h) / Self.baseArea))

            let spawnOne = { [weak self] (onBeat: Bool) in
                guard let self else { return }
                if self.particles.count >= self.maxParticles { return }
                if let maxCap = meta.maxCount {
                    let sameCount = self.particles.reduce(0) { $0 + ($1.sceneName == cur.name ? 1 : 0) }
                    if sameCount >= maxCap { return }
                }
                let rgb: (r: Double, g: Double, b: Double)
                if let themeHex = cur.colorHex {
                    rgb = LyricColorPalette.mixWhite(LyricColorPalette.resolveRGB(themeHex), t: Double.random(in: 0...0.25))
                } else {
                    let picked = meta.defaultColors.randomElement() ?? "#ffffff"
                    rgb = LyricColorPalette.resolveRGB(picked)
                }
                let m = self.spawnMotion(for: cur, w: w, h: h, onBeat: onBeat)
                self.particles.append(
                    StageParticle(
                        sceneName: cur.name,
                        key: curKey,
                        sprite: cur.sprite,
                        rgb: rgb,
                        x: m.x,
                        y: m.y,
                        vx: m.vx,
                        vy: m.vy,
                        size: m.size * self.particleScale,
                        rotation: m.rotation,
                        spin: m.spin,
                        age: 0,
                        life: m.life,
                        seed: Double.random(in: 0...10),
                        leave: 0,
                        onBeat: onBeat
                    )
                )
            }

            if let beatOct = meta.beatOctave, rhythm.reliable, validBeatWindow, let since = prevMs {
                let pulses = rhythm.pulsesIn(octave: beatOct, origin: 0, t0: since, t1: timeMs)
                let periodSec = rhythm.period(octave: beatOct) / 1000.0
                for p in pulses {
                    pending += meta.rate * periodSec * area * density * p.a
                    let count = max(1, Int(floor(pending)))
                    pending = max(0, pending - Double(count))
                    for _ in 0..<count {
                        spawnOne(true)
                    }
                }
            } else {
                pending += meta.rate * area * density * dt
                while pending >= 1.0 {
                    pending -= 1.0
                    spawnOne(false)
                }
            }
        } else {
            pending = 0
        }

        var nextParticles: [StageParticle] = []
        nextParticles.reserveCapacity(particles.count)

        for var p in particles {
            p.age += dt
            p.x += p.vx * dt
            p.y += p.vy * dt
            p.rotation += p.spin * dt
            if !isPlaying || p.key != incomingKey {
                p.leave += dt / Self.leaveSeconds
            }
            let margin = Self.marginBase + p.size
            if p.leave >= 1.0
                || p.age >= p.life
                || p.y > h + margin
                || p.y < -margin * 2
                || p.x > w + margin * 2
                || p.x < -margin * 2 {
                continue
            }
            let fadeIn = min(1.0, p.age / (p.onBeat ? 0.25 : 0.60))
            let fadeOut = p.life.isFinite ? min(1.0, max(0, p.life - p.age)) : 1.0
            let alpha = max(0, min(1.0, min(fadeIn, fadeOut) * (1.0 - p.leave)))
            if alpha > 0.005 {
                drawParticle(p, alpha: alpha, heartBeat: heartBeat, in: &context)
            }
            nextParticles.append(p)
        }
        particles = nextParticles
        syncActiveFlag()
    }

    // MARK: - 场景配置与初始运动学

    private struct SceneMeta {
        let rate: Double
        let defaultColors: [String]
        var maxCount: Int? = nil
        var beatOctave: Int? = nil
    }

    private struct SpawnedMotion {
        var x: Double
        var y: Double
        var vx: Double
        var vy: Double
        var size: Double
        var rotation: Double = 0
        var spin: Double = 0
        var life: Double = .infinity
    }

    private func sceneMeta(for scene: ResolvedStageScene) -> SceneMeta {
        if let sp = scene.sprite {
            let rate: Double = {
                switch sp.motion {
                case "fall": return 2.2
                case "float": return 2.0
                case "drift": return 1.6
                case "sway": return 1.2
                case "swirl": return 1.8
                case "burst": return 2.5
                default: return 2.2
                }
            }()
            return SceneMeta(rate: rate, defaultColors: [sp.colorHex], maxCount: Self.spriteMaxCount)
        }
        switch scene.name {
        case "petals": return SceneMeta(rate: 5, defaultColors: ["#f9a8d4"])
        case "sparks": return SceneMeta(rate: 9, defaultColors: ["#ffd977"])
        case "snow": return SceneMeta(rate: 14, defaultColors: ["#ffffff"])
        case "stars": return SceneMeta(rate: 7, defaultColors: ["#ffffff"])
        case "bubbles": return SceneMeta(rate: 4, defaultColors: ["#c8ebff"])
        case "rain": return SceneMeta(rate: 45, defaultColors: ["#d2e1ff"])
        case "leaves": return SceneMeta(rate: 4, defaultColors: ["maple", "amber", "sunset"])
        case "fireflies": return SceneMeta(rate: 3, defaultColors: ["#d4f56a"])
        case "feathers": return SceneMeta(rate: 1.5, defaultColors: ["#f5f5f5"])
        case "hearts": return SceneMeta(rate: 3, defaultColors: ["rose", "cherry-blossom", "peach"], beatOctave: 0)
        case "confetti": return SceneMeta(rate: 14, defaultColors: LyricColorPalette.festive)
        case "fireworks": return SceneMeta(rate: 0.8, defaultColors: LyricColorPalette.festive, beatOctave: 1)
        case "dandelion": return SceneMeta(rate: 2, defaultColors: ["#ffffff"])
        case "butterflies": return SceneMeta(rate: 1.2, defaultColors: ["lavender", "sky", "sunshine", "cherry-blossom"])
        case "meteors": return SceneMeta(rate: 0.6, defaultColors: ["#e6f0ff"])
        case "clouds": return SceneMeta(rate: 0.35, defaultColors: ["#ffffff"])
        case "ripples": return SceneMeta(rate: 2.5, defaultColors: ["#c8ebff"], beatOctave: 0)
        case "notes": return SceneMeta(rate: 2.5, defaultColors: ["#ffffff"], beatOctave: 0)
        default: return SceneMeta(rate: 4, defaultColors: ["#ffffff"])
        }
    }

    private func spawnMotion(for scene: ResolvedStageScene, w: Double, h: Double, onBeat: Bool) -> SpawnedMotion {
        let tau = 2.0 * Double.pi
        if let sp = scene.sprite {
            let baseSize: Double = sp.size == "s" ? 14 : (sp.size == "l" ? 26 : 20)
            let sz = baseSize * Double.random(in: 0.8...1.2)
            switch sp.motion {
            case "float":
                return SpawnedMotion(x: .random(in: 0...w), y: h + 16, vx: 0, vy: .random(in: -55 ... -30), size: sz, rotation: .random(in: -0.3...0.3), spin: sp.spin ? .random(in: -0.4...0.4) : 0)
            case "drift":
                return SpawnedMotion(x: -20, y: .random(in: (h * 0.08)...(h * 0.78)), vx: .random(in: 45...75), vy: .random(in: -6...6), size: sz, spin: sp.spin ? .random(in: -0.3...0.3) : 0)
            case "sway":
                return SpawnedMotion(x: .random(in: (w * 0.08)...(w * 0.92)), y: .random(in: (h * 0.1)...(h * 0.75)), vx: 0, vy: 6, size: sz, life: .random(in: 4...6))
            case "swirl":
                return SpawnedMotion(x: .random(in: 0...w), y: -16, vx: 0, vy: .random(in: 30...45), size: sz, spin: sp.spin ? .random(in: 1.5...3.0) : 0)
            case "burst":
                return SpawnedMotion(x: w * 0.5 + .random(in: (-w * 0.15)...(w * 0.15)), y: h * 0.45 + .random(in: (-h * 0.1)...(h * 0.1)), vx: 0, vy: 0, size: sz, rotation: .random(in: 0...tau), spin: sp.spin ? .random(in: -3...3) : 0, life: .random(in: 1.6...2.2))
            default:
                return SpawnedMotion(x: .random(in: 0...w), y: -16, vx: .random(in: -12...12), vy: .random(in: 38...62), size: sz, rotation: .random(in: 0...tau), spin: sp.spin ? .random(in: -1.4...1.4) : 0)
            }
        }

        switch scene.name {
        case "petals":
            return SpawnedMotion(x: .random(in: -30...w), y: -16, vx: .random(in: 10...40), vy: .random(in: 35...70), size: .random(in: 6...11), rotation: .random(in: 0...tau), spin: .random(in: -1.5...1.5))
        case "sparks":
            return SpawnedMotion(x: .random(in: 0...w), y: h + 8, vx: .random(in: -8...8), vy: .random(in: -55 ... -20), size: .random(in: 1.2...2.8), life: .random(in: 4...9))
        case "snow":
            return SpawnedMotion(x: .random(in: -16...(w + 16)), y: -10, vx: .random(in: -6...10), vy: .random(in: 22...55), size: .random(in: 1.2...3.8))
        case "stars":
            return SpawnedMotion(x: .random(in: 0...w), y: .random(in: 0...(h * 0.78)), vx: .random(in: -3...3), vy: .random(in: -2...2), size: .random(in: 0.8...2.4), life: .random(in: 3...6))
        case "bubbles":
            return SpawnedMotion(x: .random(in: 0...w), y: h + 16, vx: 0, vy: .random(in: -45 ... -20), size: .random(in: 4...14))
        case "rain":
            return SpawnedMotion(x: .random(in: -80...w), y: -24, vx: 120, vy: .random(in: 650...900), size: .random(in: 12...24))
        case "leaves":
            return SpawnedMotion(x: .random(in: -30...w), y: -16, vx: .random(in: 15...50), vy: .random(in: 40...80), size: .random(in: 7...12), rotation: .random(in: 0...tau), spin: .random(in: -2...2))
        case "fireflies":
            return SpawnedMotion(x: .random(in: 0...w), y: .random(in: (h * 0.3)...h), vx: .random(in: -6...6), vy: .random(in: -8...2), size: .random(in: 1.4...2.6), life: .random(in: 5...9))
        case "feathers":
            return SpawnedMotion(x: .random(in: 0...w), y: -24, vx: .random(in: -5...15), vy: .random(in: 18...35), size: .random(in: 10...18))
        case "hearts":
            let y0 = onBeat ? Double.random(in: (h * 0.55)...(h * 0.95)) : (h + 16)
            return SpawnedMotion(x: .random(in: 0...w), y: y0, vx: 0, vy: .random(in: -60 ... -30), size: .random(in: 6...12), rotation: .random(in: -0.3...0.3))
        case "confetti":
            return SpawnedMotion(x: .random(in: 0...w), y: -14, vx: .random(in: -30...30), vy: .random(in: 60...120), size: .random(in: 4...8), rotation: .random(in: 0...tau), spin: .random(in: -6...6))
        case "fireworks":
            return SpawnedMotion(x: .random(in: (w * 0.15)...(w * 0.85)), y: .random(in: (h * 0.12)...(h * 0.52)), vx: 0, vy: 0, size: .random(in: 55...95), rotation: .random(in: 0...tau), life: .random(in: 1.8...2.4))
        case "dandelion":
            return SpawnedMotion(x: -16, y: .random(in: (h * 0.2)...h), vx: .random(in: 25...55), vy: .random(in: -20 ... -5), size: .random(in: 5...8), rotation: .random(in: -0.4...0.4), spin: .random(in: -0.3...0.3))
        case "butterflies":
            return SpawnedMotion(x: .random(in: 0...w), y: h + 16, vx: .random(in: -30...30), vy: .random(in: -45 ... -25), size: .random(in: 6...10))
        case "meteors":
            return SpawnedMotion(x: .random(in: (w * 0.3)...(w + 80)), y: .random(in: -30...(h * 0.3)), vx: .random(in: -700 ... -500), vy: .random(in: 250...350), size: .random(in: 110...190), life: .random(in: 1.2...2.0))
        case "clouds":
            let sz = Double.random(in: 100...210)
            return SpawnedMotion(x: -sz, y: .random(in: 0...(h * 0.7)), vx: .random(in: 8...20), vy: 0, size: sz)
        case "ripples":
            return SpawnedMotion(x: .random(in: 0...w), y: .random(in: (h * 0.4)...h), vx: 0, vy: 0, size: .random(in: 28...64), life: .random(in: 2...3))
        case "notes":
            let y0 = onBeat ? Double.random(in: (h * 0.55)...(h * 0.95)) : (h + 16)
            return SpawnedMotion(x: .random(in: 0...w), y: y0, vx: 0, vy: .random(in: -45 ... -25), size: .random(in: 13...20), rotation: .random(in: -0.3...0.3), spin: .random(in: -0.3...0.3))
        default:
            return SpawnedMotion(x: .random(in: 0...w), y: -12, vx: 0, vy: 35, size: 3)
        }
    }

    // MARK: - 场景矢量绘制（SwiftUI GraphicsContext）

    private func color(_ rgb: (r: Double, g: Double, b: Double), alpha: Double) -> Color {
        Color(.sRGB, red: rgb.r, green: rgb.g, blue: rgb.b, opacity: max(0, min(1, alpha)))
    }

    private func drawGlowDot(in ctx: inout GraphicsContext, x: Double, y: Double, size: Double, rgb: (r: Double, g: Double, b: Double), alpha: Double) {
        let outer = size * 3.5
        ctx.fill(
            Path(ellipseIn: CGRect(x: x - outer, y: y - outer, width: outer * 2, height: outer * 2)),
            with: .color(color(rgb, alpha: 0.18 * alpha))
        )
        let bright = LyricColorPalette.mixWhite(rgb, t: 0.5)
        ctx.fill(
            Path(ellipseIn: CGRect(x: x - size, y: y - size, width: size * 2, height: size * 2)),
            with: .color(color(bright, alpha: 0.90 * alpha))
        )
    }

    private func drawParticle(
        _ p: StageParticle,
        alpha: Double,
        heartBeat: Double?,
        in ctx: inout GraphicsContext
    ) {
        if let sp = p.sprite {
            drawCustomSprite(p, sprite: sp, alpha: alpha, in: &ctx)
            return
        }

        switch p.sceneName {
        case "petals":
            var sub = ctx
            sub.translateBy(x: p.x + sin(p.age * 1.3 + p.seed) * 12, y: p.y)
            sub.rotate(by: .radians(p.rotation))
            let sx = (abs(cos(p.age * 1.7 + p.seed)) * 0.7 + 0.3) * p.size
            let sy = p.size
            sub.scaleBy(x: sx, y: sy)
            sub.fill(Path(ellipseIn: CGRect(x: -0.55, y: -1.0, width: 1.10, height: 2.0)), with: .color(color(p.rgb, alpha: 0.75 * alpha)))

        case "sparks":
            let flicker = 0.6 + 0.4 * sin(p.age * 6 + p.seed * 10)
            drawGlowDot(in: &ctx, x: p.x + sin(p.age * 0.8 + p.seed) * 10, y: p.y, size: p.size, rgb: p.rgb, alpha: alpha * flicker)

        case "snow":
            let x = p.x + sin(p.age + p.seed) * 8
            ctx.fill(
                Path(ellipseIn: CGRect(x: x - p.size, y: p.y - p.size, width: p.size * 2, height: p.size * 2)),
                with: .color(color(p.rgb, alpha: 0.80 * alpha))
            )

        case "stars":
            let lifeFrac = p.life.isFinite ? (p.age / max(0.01, p.life)) : 0.5
            let a = alpha * sin(.pi * lifeFrac) * (0.75 + 0.25 * sin(p.age * 5 + p.seed * 7))
            ctx.fill(
                Path(ellipseIn: CGRect(x: p.x - p.size, y: p.y - p.size, width: p.size * 2, height: p.size * 2)),
                with: .color(color(p.rgb, alpha: 0.90 * a))
            )
            if p.size > 1.25 {
                var rays = Path()
                rays.move(to: CGPoint(x: p.x - p.size * 4, y: p.y))
                rays.addLine(to: CGPoint(x: p.x + p.size * 4, y: p.y))
                rays.move(to: CGPoint(x: p.x, y: p.y - p.size * 4))
                rays.addLine(to: CGPoint(x: p.x, y: p.y + p.size * 4))
                ctx.stroke(rays, with: .color(color(p.rgb, alpha: 0.40 * a)), lineWidth: 1)
            }

        case "bubbles":
            let x = p.x + sin(p.age * 1.6 + p.seed) * 10
            let circle = Path(ellipseIn: CGRect(x: x - p.size, y: p.y - p.size, width: p.size * 2, height: p.size * 2))
            ctx.stroke(circle, with: .color(color(p.rgb, alpha: 0.55 * alpha)), lineWidth: 1.1)
            let hi = p.size * 0.22
            let hx = x - p.size * 0.35
            let hy = p.y - p.size * 0.35
            ctx.fill(
                Path(ellipseIn: CGRect(x: hx - hi, y: hy - hi, width: hi * 2, height: hi * 2)),
                with: .color(color(LyricColorPalette.mixWhite(p.rgb, t: 0.7), alpha: 0.35 * alpha))
            )

        case "rain":
            let k = p.size / max(1, hypot(p.vx, p.vy))
            var line = Path()
            line.move(to: CGPoint(x: p.x, y: p.y))
            line.addLine(to: CGPoint(x: p.x - p.vx * k, y: p.y - p.vy * k))
            ctx.stroke(line, with: .color(color(p.rgb, alpha: 0.30 * alpha)), lineWidth: 1)

        case "leaves":
            var sub = ctx
            sub.translateBy(x: p.x + sin(p.age * 1.1 + p.seed) * 18, y: p.y)
            sub.rotate(by: .radians(p.rotation))
            let s = max(1, p.size)
            sub.scaleBy(x: (abs(cos(p.age * 1.4 + p.seed)) * 0.8 + 0.2) * s, y: s)
            var body = Path()
            body.move(to: CGPoint(x: 0, y: -1))
            body.addQuadCurve(to: CGPoint(x: 0, y: 1), control: CGPoint(x: 0.75, y: 0))
            body.addQuadCurve(to: CGPoint(x: 0, y: -1), control: CGPoint(x: -0.75, y: 0))
            sub.fill(body, with: .color(color(p.rgb, alpha: 0.80 * alpha)))
            var stem = Path()
            stem.move(to: CGPoint(x: 0, y: -0.8))
            stem.addLine(to: CGPoint(x: 0, y: 1.3))
            sub.stroke(stem, with: .color(color(LyricColorPalette.mixWhite(p.rgb, t: 0.4), alpha: 0.60 * alpha)), lineWidth: 0.8 / s)

        case "fireflies":
            let x = p.x + sin(p.age * 0.7 + p.seed) * 24
            let y = p.y + cos(p.age * 0.9 + p.seed * 2) * 16
            let s = (sin(p.age * 2.5 + p.seed * 5) + 1.0) * 0.5
            drawGlowDot(in: &ctx, x: x, y: y, size: p.size, rgb: p.rgb, alpha: alpha * (0.15 + 0.85 * s * s))

        case "feathers":
            let swing = sin(p.age * 1.2 + p.seed)
            var sub = ctx
            sub.translateBy(x: p.x + swing * 24, y: p.y)
            sub.rotate(by: .radians(swing * 0.6 + 0.3))
            let s = p.size
            sub.fill(Path(ellipseIn: CGRect(x: -s * 0.3, y: -s, width: s * 0.6, height: s * 2)), with: .color(color(p.rgb, alpha: 0.55 * alpha)))
            var quill = Path()
            quill.move(to: CGPoint(x: 0, y: -s))
            quill.addLine(to: CGPoint(x: 0, y: s * 1.35))
            sub.stroke(quill, with: .color(color(p.rgb, alpha: 0.85 * alpha)), lineWidth: 1)

        case "hearts":
            var sub = ctx
            sub.translateBy(x: p.x + sin(p.age * 1.4 + p.seed) * 14, y: p.y)
            sub.rotate(by: .radians(p.rotation))
            let beatScale = ((heartBeat == nil) ? (1.0 + 0.08 * sin(p.age * 4 + p.seed)) : (1.0 + 0.12 * heartBeat!)) * p.size
            sub.scaleBy(x: beatScale, y: beatScale)
            var heart = Path()
            heart.move(to: CGPoint(x: 0, y: 0.35))
            heart.addCurve(to: CGPoint(x: 0, y: -0.45), control1: CGPoint(x: -1.1, y: -0.35), control2: CGPoint(x: -0.5, y: -1.1))
            heart.addCurve(to: CGPoint(x: 0, y: 0.35), control1: CGPoint(x: 0.5, y: -1.1), control2: CGPoint(x: 1.1, y: -0.35))
            heart.closeSubpath()
            sub.fill(heart, with: .color(color(p.rgb, alpha: 0.70 * alpha)))

        case "confetti":
            var sub = ctx
            sub.translateBy(x: p.x + sin(p.age * 2 + p.seed) * 10, y: p.y)
            sub.rotate(by: .radians(p.rotation))
            let flip = cos(p.age * 6 + p.seed)
            sub.scaleBy(x: abs(flip) < 0.05 ? 0.05 : flip, y: 1)
            sub.fill(Path(CGRect(x: -p.size * 0.5, y: -p.size * 0.3, width: p.size, height: p.size * 0.6)), with: .color(color(p.rgb, alpha: 0.85 * alpha)))

        case "fireworks":
            let t = min(1.0, p.age / max(0.01, p.life))
            let radius = p.size * (1.0 - pow(1.0 - t, 3))
            let fade = alpha * pow(max(0, 1.0 - t), 1.5)
            let count = 24
            let drop = 24.0 * t * t
            let sparkCol = color(LyricColorPalette.mixWhite(p.rgb, t: 0.3), alpha: 0.90 * fade)
            let trailCol = color(p.rgb, alpha: 0.45 * fade)
            for i in 0..<count {
                let angle = p.rotation + (Double(i) / Double(count)) * 2.0 * .pi
                let cs = cos(angle)
                let sn = sin(angle)
                let x = p.x + cs * radius
                let y = p.y + sn * radius + drop
                var seg = Path()
                seg.move(to: CGPoint(x: p.x + cs * radius * 0.82, y: p.y + sn * radius * 0.82 + drop * 0.8))
                seg.addLine(to: CGPoint(x: x, y: y))
                ctx.stroke(seg, with: .color(trailCol), lineWidth: 1.1)
                let r = 1.6 * (1.0 - t * 0.5)
                ctx.fill(Path(ellipseIn: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2)), with: .color(sparkCol))
            }
            if t < 0.12 {
                let flashAlpha = (1.0 - t / 0.12) * 0.6 * alpha
                ctx.fill(
                    Path(ellipseIn: CGRect(x: p.x - 8, y: p.y - 8, width: 16, height: 16)),
                    with: .color(color(LyricColorPalette.mixWhite(p.rgb, t: 0.7), alpha: flashAlpha))
                )
            }

        case "dandelion":
            var sub = ctx
            sub.translateBy(x: p.x, y: p.y + sin(p.age * 1.5 + p.seed) * 10)
            sub.rotate(by: .radians(p.rotation))
            let s = p.size
            var pappus = Path()
            pappus.move(to: .zero)
            pappus.addLine(to: CGPoint(x: 0, y: s * 1.6))
            for i in 0..<9 {
                let angle = -.pi + (Double(i) / 8.0) * .pi
                pappus.move(to: .zero)
                pappus.addLine(to: CGPoint(x: cos(angle) * s, y: sin(angle) * s))
            }
            sub.stroke(pappus, with: .color(color(p.rgb, alpha: 0.60 * alpha)), lineWidth: 0.8)

        case "butterflies":
            var sub = ctx
            sub.translateBy(x: p.x + sin(p.age * 0.9 + p.seed) * 32, y: p.y)
            sub.rotate(by: .radians(cos(p.age * 0.9 + p.seed) * 0.4 + p.vx / 120.0))
            let s = p.size
            let flap = 0.25 + 0.75 * abs(sin(p.age * 8 + p.seed))
            let wingCol = color(p.rgb, alpha: 0.75 * alpha)
            for side in [-1.0, 1.0] {
                var wCtx = sub
                wCtx.scaleBy(x: side * flap, y: 1)
                wCtx.fill(Path(ellipseIn: CGRect(x: s * 0.05, y: -s * 0.75, width: s * 1.1, height: s * 0.85)), with: .color(wingCol))
                wCtx.fill(Path(ellipseIn: CGRect(x: s * 0.05, y: s * 0.05, width: s * 0.75, height: s * 0.60)), with: .color(wingCol))
            }
            var antenna = Path()
            antenna.move(to: CGPoint(x: 0, y: -s * 0.6))
            antenna.addLine(to: CGPoint(x: 0, y: s * 0.6))
            sub.stroke(antenna, with: .color(color(LyricColorPalette.mixWhite(p.rgb, t: 0.5), alpha: 0.80 * alpha)), lineWidth: 1.1)

        case "meteors":
            let k = p.size / max(1, hypot(p.vx, p.vy))
            let tail = CGPoint(x: p.x - p.vx * k, y: p.y - p.vy * k)
            let head = CGPoint(x: p.x, y: p.y)
            var streak = Path()
            streak.move(to: head)
            streak.addLine(to: tail)
            ctx.stroke(
                streak,
                with: .linearGradient(
                    Gradient(colors: [
                        color(LyricColorPalette.mixWhite(p.rgb, t: 0.5), alpha: 0.90 * alpha),
                        color(p.rgb, alpha: 0)
                    ]),
                    startPoint: head,
                    endPoint: tail
                ),
                style: StrokeStyle(lineWidth: 1.8, lineCap: .round)
            )
            drawGlowDot(in: &ctx, x: p.x, y: p.y, size: 1.4, rgb: p.rgb, alpha: alpha)

        case "clouds":
            let blobs: [(Double, Double, Double)] = [(0, 0, 1.0), (-0.45, 0.12, 0.7), (0.5, 0.1, 0.75)]
            for (dx, dy, r) in blobs {
                let cx = p.x + dx * p.size
                let cy = p.y + dy * p.size
                let rad = p.size * r * 0.6
                let center = CGPoint(x: cx, y: cy)
                ctx.fill(
                    Path(ellipseIn: CGRect(x: cx - rad, y: cy - rad, width: rad * 2, height: rad * 2)),
                    with: .radialGradient(
                        Gradient(colors: [color(p.rgb, alpha: 0.10 * alpha), color(p.rgb, alpha: 0)]),
                        center: center,
                        startRadius: 0,
                        endRadius: rad
                    )
                )
            }

        case "ripples":
            let t = min(1.0, p.age / max(0.01, p.life))
            for (sc, baseA) in [(1.0, 0.50), (0.6, 0.35)] {
                let rad = p.size * sc * t
                guard rad > 0.5 else { continue }
                let rect = CGRect(x: p.x - rad, y: p.y - rad * 0.4, width: rad * 2, height: rad * 0.8)
                ctx.stroke(Path(ellipseIn: rect), with: .color(color(p.rgb, alpha: baseA * (1.0 - t) * alpha)), lineWidth: 1.1)
            }

        case "notes":
            var sub = ctx
            sub.translateBy(x: p.x + sin(p.age * 1.3 + p.seed) * 14, y: p.y)
            sub.rotate(by: .radians(p.rotation))
            let glyph = Self.noteGlyphs[Int(floor(p.seed)) % Self.noteGlyphs.count]
            let txt = Text(glyph)
                .font(.system(size: max(9, p.size)))
                .foregroundStyle(color(p.rgb, alpha: 0.60 * alpha))
            sub.draw(txt, at: .zero, anchor: .center)

        default:
            break
        }
    }

    private func drawCustomSprite(
        _ p: StageParticle,
        sprite: LyricSpritePayload,
        alpha: Double,
        in ctx: inout GraphicsContext
    ) {
        let compiled: [(paint: String, path: Path)] = {
            if let hit = compiledSprites[sprite.name] { return hit }
            let built = sprite.paths.map { (paint: $0.paint, path: SVGPathParser.parse($0.d)) }
            compiledSprites[sprite.name] = built
            return built
        }()
        guard !compiled.isEmpty else { return }

        var ox = 0.0
        var oy = 0.0
        var rot = p.rotation
        switch sprite.motion {
        case "fall":
            ox = sin(p.age * 1.3 + p.seed) * 14
        case "float":
            ox = sin(p.age * 1.1 + p.seed) * 16
        case "drift":
            oy = sin(p.age * 2.0 + p.seed) * 10
        case "sway":
            rot = sin(p.age * 2.2 + p.seed) * 0.35
        case "swirl":
            let frac = p.seed - floor(p.seed)
            ox = sin(p.age * 1.6 + p.seed) * (18 + frac * 22)
        case "burst":
            let angle = (p.seed / 10.0) * 2.0 * .pi
            let rem = (p.seed * 37.0).truncatingRemainder(dividingBy: 60.0)
            let dist = (70.0 + rem) * (1.0 - exp(-1.5 * p.age)) / 1.5
            ox = cos(angle) * dist
            oy = sin(angle) * dist + 10.0 * p.age * p.age
        default:
            break
        }

        let a = alpha * Self.spriteMaxAlpha
        var sub = ctx
        sub.translateBy(x: p.x + ox, y: p.y + oy)
        sub.rotate(by: .radians(rot))
        let scale = max(0.05, p.size / 24.0)
        sub.scaleBy(x: scale, y: scale)
        sub.translateBy(x: -12, y: -12)

        for item in compiled {
            if item.paint == "fill" || item.paint == "light" {
                let col = item.paint == "light" ? LyricColorPalette.mixWhite(p.rgb, t: 0.55) : p.rgb
                sub.fill(item.path, with: .color(color(col, alpha: a)))
            } else {
                let lw: CGFloat = item.paint == "line" ? 2.5 : 1.5
                sub.stroke(
                    item.path,
                    with: .color(color(p.rgb, alpha: a)),
                    style: StrokeStyle(lineWidth: lw, lineCap: .round, lineJoin: .round)
                )
            }
        }
    }
}

// MARK: - 轻量 SVG Path d 解析器（支持 24×24 图标库与 AI 自定义剪影全部常见指令 M/L/H/V/C/S/Q/T/A/Z）

enum SVGPathParser {
    static func parse(_ d: String) -> Path {
        var path = Path()
        let tokens = tokenize(d)
        var i = 0
        var cur = CGPoint.zero
        var start = CGPoint.zero
        var lastCtrl: CGPoint? = nil
        var lastCmd: Character = " "

        func hasNumber() -> Bool {
            guard i < tokens.count else { return false }
            if case .number = tokens[i] { return true }
            return false
        }

        func nextNum() -> CGFloat {
            guard i < tokens.count, case .number(let v) = tokens[i] else { return 0 }
            i += 1
            return CGFloat(v)
        }

        while i < tokens.count {
            let cmd: Character
            if case .command(let c) = tokens[i] {
                cmd = c
                i += 1
            } else {
                cmd = (lastCmd == "M") ? "L" : ((lastCmd == "m") ? "l" : lastCmd)
            }
            let rel = cmd.isLowercase
            let upper = Character(cmd.uppercased())

            switch upper {
            case "M":
                let x = nextNum() + (rel ? cur.x : 0)
                let y = nextNum() + (rel ? cur.y : 0)
                cur = CGPoint(x: x, y: y)
                start = cur
                path.move(to: cur)
                lastCtrl = nil

            case "L":
                let x = nextNum() + (rel ? cur.x : 0)
                let y = nextNum() + (rel ? cur.y : 0)
                cur = CGPoint(x: x, y: y)
                path.addLine(to: cur)
                lastCtrl = nil

            case "H":
                let x = nextNum() + (rel ? cur.x : 0)
                cur = CGPoint(x: x, y: cur.y)
                path.addLine(to: cur)
                lastCtrl = nil

            case "V":
                let y = nextNum() + (rel ? cur.y : 0)
                cur = CGPoint(x: cur.x, y: y)
                path.addLine(to: cur)
                lastCtrl = nil

            case "C":
                let c1 = CGPoint(x: nextNum() + (rel ? cur.x : 0), y: nextNum() + (rel ? cur.y : 0))
                let c2 = CGPoint(x: nextNum() + (rel ? cur.x : 0), y: nextNum() + (rel ? cur.y : 0))
                let end = CGPoint(x: nextNum() + (rel ? cur.x : 0), y: nextNum() + (rel ? cur.y : 0))
                path.addCurve(to: end, control1: c1, control2: c2)
                lastCtrl = c2
                cur = end

            case "S":
                let c1: CGPoint
                if let lc = lastCtrl, "CS".contains(lastCmd.uppercased()) {
                    c1 = CGPoint(x: 2 * cur.x - lc.x, y: 2 * cur.y - lc.y)
                } else {
                    c1 = cur
                }
                let c2 = CGPoint(x: nextNum() + (rel ? cur.x : 0), y: nextNum() + (rel ? cur.y : 0))
                let end = CGPoint(x: nextNum() + (rel ? cur.x : 0), y: nextNum() + (rel ? cur.y : 0))
                path.addCurve(to: end, control1: c1, control2: c2)
                lastCtrl = c2
                cur = end

            case "Q":
                let c1 = CGPoint(x: nextNum() + (rel ? cur.x : 0), y: nextNum() + (rel ? cur.y : 0))
                let end = CGPoint(x: nextNum() + (rel ? cur.x : 0), y: nextNum() + (rel ? cur.y : 0))
                path.addQuadCurve(to: end, control: c1)
                lastCtrl = c1
                cur = end

            case "T":
                let c1: CGPoint
                if let lc = lastCtrl, "QT".contains(lastCmd.uppercased()) {
                    c1 = CGPoint(x: 2 * cur.x - lc.x, y: 2 * cur.y - lc.y)
                } else {
                    c1 = cur
                }
                let end = CGPoint(x: nextNum() + (rel ? cur.x : 0), y: nextNum() + (rel ? cur.y : 0))
                path.addQuadCurve(to: end, control: c1)
                lastCtrl = c1
                cur = end

            case "A":
                let rx = abs(nextNum())
                let ry = abs(nextNum())
                _ = nextNum() // x-axis-rotation
                _ = nextNum() // large-arc-flag
                _ = nextNum() // sweep-flag
                let end = CGPoint(x: nextNum() + (rel ? cur.x : 0), y: nextNum() + (rel ? cur.y : 0))
                if rx > 0.01 && ry > 0.01 {
                    let mid = CGPoint(x: (cur.x + end.x) * 0.5, y: (cur.y + end.y) * 0.5)
                    path.addQuadCurve(to: end, control: mid)
                } else {
                    path.addLine(to: end)
                }
                cur = end
                lastCtrl = nil

            case "Z":
                path.closeSubpath()
                cur = start
                lastCtrl = nil

            default:
                if hasNumber() { _ = nextNum() } else { i += 1 }
            }
            lastCmd = cmd
        }
        return path
    }

    private enum Token {
        case command(Character)
        case number(Double)
    }

    private static func tokenize(_ d: String) -> [Token] {
        var out: [Token] = []
        let chars = Array(d)
        var idx = 0
        let n = chars.count

        while idx < n {
            let ch = chars[idx]
            if ch.isWhitespace || ch == "," {
                idx += 1
                continue
            }
            if ch.isLetter && ch != "e" && ch != "E" {
                out.append(.command(ch))
                idx += 1
                continue
            }
            let start = idx
            if chars[idx] == "+" || chars[idx] == "-" {
                idx += 1
            }
            var seenDot = false
            while idx < n {
                let c = chars[idx]
                if c.isNumber {
                    idx += 1
                } else if c == "." && !seenDot {
                    seenDot = true
                    idx += 1
                } else if (c == "e" || c == "E") && idx + 1 < n {
                    idx += 1
                    if chars[idx] == "+" || chars[idx] == "-" { idx += 1 }
                } else {
                    break
                }
            }
            if idx > start, let val = Double(String(chars[start..<idx])) {
                out.append(.number(val))
            } else {
                idx += 1
            }
        }
        return out
    }
}
