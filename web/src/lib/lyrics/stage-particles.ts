import type { LyricScene } from './types'

/**
 * 播放器页的全屏粒子（canvas 2D）：花瓣、光点、雪、星空、气泡、雨。
 * 当前场景按 density（0 ~ 1，渐入渐出）生成粒子；切换、结束场景或暂停后不再生成，已有粒子在 LEAVE_SECONDS 内淡出
 */

interface Particle {
  scene: LyricScene
  x: number
  y: number
  vx: number
  vy: number
  size: number
  rotation: number
  spin: number
  // 已存在时长与寿命（秒）；寿命为 Infinity 时离开画面才移除
  age: number
  life: number
  seed: number
  // 离场淡出的进度（0 ~ 1），场景切换、结束或暂停后开始
  leave: number
}

interface SceneSpec {
  // 1280×800 画面上每秒生成的数量，按画面面积缩放
  rate: number
  spawn: (w: number, h: number) => Omit<Particle, 'scene' | 'age' | 'seed' | 'leave'>
  draw: (ctx: CanvasRenderingContext2D, p: Particle, alpha: number) => void
}

const MAX_PARTICLES = 240
const BASE_AREA = 1280 * 800
// 场景渐入 / 渐出的速度（每秒）
const DENSITY_IN = 0.6
const DENSITY_OUT = 0.8
const LEAVE_SECONDS = 1.2

const rand = (min: number, max: number) => min + Math.random() * (max - min)

const SCENES: Record<LyricScene, SceneSpec> = {
  petals: {
    rate: 5,
    spawn: w => ({ x: rand(-40, w), y: -20, vx: rand(10, 40), vy: rand(35, 70), size: rand(6, 11), rotation: rand(0, Math.PI * 2), spin: rand(-1.5, 1.5), life: Infinity }),
    draw: (ctx, p, alpha) => {
      ctx.save()
      ctx.translate(p.x + Math.sin(p.age * 1.3 + p.seed) * 12, p.y)
      ctx.rotate(p.rotation)
      // 翻转：宽度随时间变化
      ctx.scale(Math.abs(Math.cos(p.age * 1.7 + p.seed)) * 0.7 + 0.3, 1)
      ctx.fillStyle = `rgb(249 168 212 / ${(0.75 * alpha).toFixed(3)})`
      ctx.beginPath()
      ctx.ellipse(0, 0, p.size * 0.55, p.size, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    },
  },
  sparks: {
    rate: 9,
    spawn: (w, h) => ({ x: rand(0, w), y: h + 10, vx: rand(-8, 8), vy: rand(-55, -20), size: rand(1.2, 2.8), rotation: 0, spin: 0, life: rand(4, 9) }),
    draw: (ctx, p, alpha) => {
      const flicker = 0.6 + 0.4 * Math.sin(p.age * 6 + p.seed * 10)
      const x = p.x + Math.sin(p.age * 0.8 + p.seed) * 10
      ctx.fillStyle = `rgb(255 217 119 / ${(0.18 * alpha * flicker).toFixed(3)})`
      ctx.beginPath()
      ctx.arc(x, p.y, p.size * 3.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = `rgb(255 236 179 / ${(0.9 * alpha * flicker).toFixed(3)})`
      ctx.beginPath()
      ctx.arc(x, p.y, p.size, 0, Math.PI * 2)
      ctx.fill()
    },
  },
  snow: {
    rate: 14,
    spawn: w => ({ x: rand(-20, w + 20), y: -10, vx: rand(-6, 10), vy: rand(22, 55), size: rand(1.2, 3.8), rotation: 0, spin: 0, life: Infinity }),
    draw: (ctx, p, alpha) => {
      ctx.fillStyle = `rgb(255 255 255 / ${(0.8 * alpha).toFixed(3)})`
      ctx.beginPath()
      ctx.arc(p.x + Math.sin(p.age + p.seed) * 8, p.y, p.size, 0, Math.PI * 2)
      ctx.fill()
    },
  },
  stars: {
    rate: 7,
    spawn: (w, h) => ({ x: rand(0, w), y: rand(0, h * 0.75), vx: rand(-3, 3), vy: rand(-2, 2), size: rand(0.8, 2.4), rotation: 0, spin: 0, life: rand(3, 6) }),
    draw: (ctx, p, alpha) => {
      // 一生中亮起再熄灭，并带轻微闪烁
      const twinkle = Math.sin(Math.PI * p.age / p.life) * (0.75 + 0.25 * Math.sin(p.age * 5 + p.seed * 7))
      const a = alpha * twinkle
      ctx.fillStyle = `rgb(255 255 255 / ${(0.9 * a).toFixed(3)})`
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
      ctx.fill()
      if (p.size > 1.8) {
        // 较亮的星加十字光芒
        ctx.strokeStyle = `rgb(255 255 255 / ${(0.4 * a).toFixed(3)})`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(p.x - p.size * 4, p.y)
        ctx.lineTo(p.x + p.size * 4, p.y)
        ctx.moveTo(p.x, p.y - p.size * 4)
        ctx.lineTo(p.x, p.y + p.size * 4)
        ctx.stroke()
      }
    },
  },
  bubbles: {
    rate: 4,
    spawn: (w, h) => ({ x: rand(0, w), y: h + 20, vx: 0, vy: rand(-45, -20), size: rand(4, 14), rotation: 0, spin: 0, life: Infinity }),
    draw: (ctx, p, alpha) => {
      const x = p.x + Math.sin(p.age * 1.6 + p.seed) * 10
      ctx.strokeStyle = `rgb(200 235 255 / ${(0.55 * alpha).toFixed(3)})`
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.arc(x, p.y, p.size, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = `rgb(255 255 255 / ${(0.35 * alpha).toFixed(3)})`
      ctx.beginPath()
      ctx.arc(x - p.size * 0.35, p.y - p.size * 0.35, p.size * 0.22, 0, Math.PI * 2)
      ctx.fill()
    },
  },
  rain: {
    rate: 45,
    spawn: w => ({ x: rand(-100, w), y: -30, vx: 120, vy: rand(650, 900), size: rand(12, 24), rotation: 0, spin: 0, life: Infinity }),
    draw: (ctx, p, alpha) => {
      const k = p.size / Math.hypot(p.vx, p.vy)
      ctx.strokeStyle = `rgb(210 225 255 / ${(0.3 * alpha).toFixed(3)})`
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(p.x - p.vx * k, p.y - p.vy * k)
      ctx.stroke()
    },
  },
}

export class StageParticles {
  private ctx: CanvasRenderingContext2D | null
  private particles: Particle[] = []
  private density = 0
  private scene: LyricScene | null = null
  // 累积的待生成数量（小数部分留到下一帧）
  private pending = 0
  private width = 0
  private height = 0

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')
  }

  /** 画面尺寸变化时调用（CSS 像素），按设备像素比放大画布，最多 2 倍 */
  resize(width: number, height: number) {
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    this.width = width
    this.height = height
    this.canvas.width = Math.round(width * ratio)
    this.canvas.height = Math.round(height * ratio)
    this.ctx?.setTransform(ratio, 0, 0, ratio, 0, 0)
  }

  /** 是否还有需要绘制的内容（没有时可停止逐帧循环） */
  get idle() {
    return this.particles.length === 0 && this.density === 0
  }

  /** 推进 dt 秒并绘制；scene 为当前场景（null 为无），active 为 false 时（暂停）不再生成 */
  update(dt: number, scene: LyricScene | null, active: boolean) {
    const ctx = this.ctx
    if (!ctx)
      return
    // 换场景时先渐出旧场景，渐出完再渐入新场景
    if (scene !== this.scene && this.density === 0)
      this.scene = scene
    const target = active && scene != null && scene === this.scene ? 1 : 0
    this.density = target > this.density
      ? Math.min(target, this.density + DENSITY_IN * dt)
      : Math.max(target, this.density - DENSITY_OUT * dt)

    if (this.scene && this.density > 0) {
      const spec = SCENES[this.scene]
      const area = Math.min(2, Math.max(0.3, (this.width * this.height) / BASE_AREA))
      this.pending += spec.rate * area * this.density * dt
      while (this.pending >= 1) {
        this.pending--
        if (this.particles.length < MAX_PARTICLES)
          this.particles.push({ ...spec.spawn(this.width, this.height), scene: this.scene, age: 0, seed: Math.random() * 10, leave: 0 })
      }
    }
    else {
      this.pending = 0
    }

    ctx.clearRect(0, 0, this.width, this.height)
    const margin = 60
    this.particles = this.particles.filter((p) => {
      p.age += dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.rotation += p.spin * dt
      if (!active || p.scene !== scene)
        p.leave += dt / LEAVE_SECONDS
      if (p.leave >= 1 || p.age >= p.life || p.y > this.height + margin || p.y < -margin * 2 || p.x > this.width + margin * 2 || p.x < -margin * 2)
        return false
      // 刚生成时淡入，有寿命的在最后一秒淡出
      const alpha = Math.min(1, p.age / 0.6, Number.isFinite(p.life) ? p.life - p.age : 1) * (1 - p.leave)
      SCENES[p.scene].draw(ctx, p, alpha)
      return true
    })
  }

  clear() {
    this.particles = []
    this.density = 0
    this.pending = 0
    this.ctx?.clearRect(0, 0, this.width, this.height)
  }
}
