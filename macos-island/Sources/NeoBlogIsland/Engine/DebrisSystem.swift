import Observation
import SwiftUI

// MARK: - 1:1 对应 web/src/lib/lyrics/lyric-debris.ts（消散微粒与破碎三角切片物理层）

@Observable
@MainActor
final class DebrisEngine {
    struct Grain {
        var x: Double
        var y: Double
        let vx: Double
        let vy: Double
        let size: Double
        let phase: Double
        var age: Double
        let life: Double
        let color: Color
    }

    struct Shard {
        let originX: Double
        let originY: Double
        let p0: CGPoint
        let p1: CGPoint
        let p2: CGPoint
        let cx: Double
        let cy: Double
        let vx: Double
        var vy: Double
        let spin: Double
        var age: Double
        let life: Double
        let color: Color
    }

    /// 遵循 swiftui-expert-skill：粒子数组在 Canvas 绘制热路径每帧推进，标记 @ObservationIgnored 杜绝 60Hz 视图树失效风暴；
    /// 仅在粒子从无到有或全部消亡的边界时刻翻转 hasActiveDebris。
    private(set) var hasActiveDebris: Bool = false

    @ObservationIgnored private var grains: [Grain] = []
    @ObservationIgnored private var shards: [Shard] = []
    @ObservationIgnored private var triggeredKeys: [String: Double] = [:]
    @ObservationIgnored private var lastStepDate: Date? = nil

    private static let grainsPerChar = 14
    private static let maxGrains = 280
    private static let shardGravity = 940.0
    private static let shardPop = 68.0
    private static let maxShards = 90

    private func syncActiveFlag() {
        let active = !grains.isEmpty || !shards.isEmpty
        if hasActiveDebris != active {
            hasActiveDebris = active
        }
    }

    func reset() {
        grains.removeAll()
        shards.removeAll()
        triggeredKeys.removeAll()
        lastStepDate = nil
        syncActiveFlag()
    }

    func triggerDissolveIfNeeded(
        key: String,
        at: Double,
        nowMs: Double,
        rect: CGRect,
        color: Color
    ) {
        if nowMs < at {
            triggeredKeys.removeValue(forKey: key)
            return
        }
        guard triggeredKeys[key] != at, nowMs - at < 300, rect.width > 0 else { return }
        triggeredKeys[key] = at

        let count = max(4, Int(round(Double(Self.grainsPerChar) * min(2.0, Double(rect.height) / 24.0))))
        for _ in 0..<count where grains.count < Self.maxGrains {
            grains.append(Grain(
                x: Double(rect.minX) + Double.random(in: 0...Double(rect.width)),
                y: Double(rect.minY) + Double(rect.height) * Double.random(in: 0.2...0.85),
                vx: Double.random(in: 30...110),
                vy: Double.random(in: -38 ... -8),
                size: Double.random(in: 1.0...2.2),
                phase: Double.random(in: 0...(2 * .pi)),
                age: -Double.random(in: 0...0.18),
                life: Double.random(in: 0.85...1.25),
                color: color
            ))
        }
        syncActiveFlag()
    }

    func triggerShatterIfNeeded(
        key: String,
        at: Double,
        nowMs: Double,
        rect: CGRect,
        push: Double,
        color: Color
    ) {
        if nowMs < at {
            triggeredKeys.removeValue(forKey: key)
            return
        }
        guard triggeredKeys[key] != at, nowMs - at < 300, rect.width > 0 else { return }
        triggeredKeys[key] = at

        let w = Double(rect.width)
        let h = Double(rect.height)
        let crackX = w * Double.random(in: 0.35...0.65)
        let crackY = h * Double.random(in: 0.35...0.65)
        let count = Int.random(in: 3...4)

        let edgePts: [CGPoint] = (0..<count).map { k in
            let angle = (Double(k) + Double.random(in: 0.2...0.8)) / Double(count) * 2.0 * .pi
            return Self.rayToRect(cx: crackX, cy: crackY, angle: angle, w: w, h: h)
        }

        for k in 0..<count where shards.count < Self.maxShards {
            let a = edgePts[k]
            let b = edgePts[(k + 1) % count]
            let cx = (crackX + Double(a.x) + Double(b.x)) / 3.0
            let cy = (crackY + Double(a.y) + Double(b.y)) / 3.0
            let dx = cx - crackX
            let dy = cy - crackY
            let len = max(1e-3, hypot(dx, dy))
            let speed = Double.random(in: 95...215)

            shards.append(Shard(
                originX: Double(rect.minX),
                originY: Double(rect.minY),
                p0: CGPoint(x: crackX, y: crackY),
                p1: a,
                p2: b,
                cx: cx,
                cy: cy,
                vx: dx / len * speed + push * 80.0,
                vy: dy / len * speed - Self.shardPop,
                spin: Double.random(in: -5.0...5.0),
                age: 0,
                life: Double.random(in: 0.5...0.75),
                color: color
            ))
        }
        syncActiveFlag()
    }

    func stepAndDraw(in context: inout GraphicsContext, date: Date) {
        let dt: Double
        if let last = lastStepDate {
            dt = min(0.05, max(0, date.timeIntervalSince(last)))
        } else {
            dt = 1.0 / 60.0
        }
        lastStepDate = date
        guard !grains.isEmpty || !shards.isEmpty else {
            syncActiveFlag()
            return
        }

        var nextGrains: [Grain] = []
        nextGrains.reserveCapacity(grains.count)
        for var g in grains {
            g.age += dt
            if g.age >= g.life { continue }
            if g.age >= 0 {
                let t = g.age
                let px = g.x + g.vx * t
                let py = g.y + g.vy * t + sin(t * 5.0 + g.phase) * 3.5
                let alpha = max(0, 1.0 - t / g.life) * 0.9
                let rect = CGRect(x: px - g.size * 0.5, y: py - g.size * 0.5, width: g.size, height: g.size)
                context.fill(Path(ellipseIn: rect), with: .color(g.color.opacity(alpha)))
            }
            nextGrains.append(g)
        }
        grains = nextGrains

        var nextShards: [Shard] = []
        nextShards.reserveCapacity(shards.count)
        for var s in shards {
            s.age += dt
            if s.age >= s.life { continue }
            let t = s.age
            let px = s.originX + s.cx + s.vx * t
            let py = s.originY + s.cy + s.vy * t + 0.5 * Self.shardGravity * t * t
            let angle = s.spin * t
            let alpha = max(0, 1.0 - pow(t / s.life, 1.6))

            var tri = Path()
            tri.move(to: CGPoint(x: Double(s.p0.x) - s.cx, y: Double(s.p0.y) - s.cy))
            tri.addLine(to: CGPoint(x: Double(s.p1.x) - s.cx, y: Double(s.p1.y) - s.cy))
            tri.addLine(to: CGPoint(x: Double(s.p2.x) - s.cx, y: Double(s.p2.y) - s.cy))
            tri.closeSubpath()

            var sub = context
            sub.translateBy(x: px, y: py)
            sub.rotate(by: .radians(angle))
            sub.fill(tri, with: .color(s.color.opacity(alpha)))
            nextShards.append(s)
        }
        shards = nextShards
        syncActiveFlag()
    }

    private static func rayToRect(cx: Double, cy: Double, angle: Double, w: Double, h: Double) -> CGPoint {
        let dx = cos(angle)
        let dy = sin(angle)
        var tMin = Double.infinity
        if abs(dx) > 1e-6 {
            let tx = dx > 0 ? (w - cx) / dx : (0 - cx) / dx
            if tx > 0 { tMin = min(tMin, tx) }
        }
        if abs(dy) > 1e-6 {
            let ty = dy > 0 ? (h - cy) / dy : (0 - cy) / dy
            if ty > 0 { tMin = min(tMin, ty) }
        }
        if !tMin.isFinite { tMin = 0 }
        return CGPoint(x: cx + dx * tMin, y: cy + dy * tMin)
    }
}
