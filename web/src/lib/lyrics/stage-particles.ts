import type { Rgb } from './colors'
import type { StageScene } from './stage-effects'
import type { LyricColor, LyricScene } from './types'
import { hexToRgb, LYRIC_COLORS } from './colors'

/**
 * 播放器页的全屏粒子（canvas 2D），共 18 种场景（与后端 lyricAnnotationSceneList 一致）。
 * 当前场景按 density（0 ~ 1，渐入渐出）生成粒子；切换场景或颜色主题、结束场景或暂停后不再生成，已有粒子在 LEAVE_SECONDS 内淡出。
 * 颜色：指定了颜色主题时所有粒子使用该颜色（略微随机提亮以增加层次），否则使用场景的默认色（部分场景为多色）
 */

interface Particle {
  scene: LyricScene
  // 场景 + 颜色主题，与当前不同时淡出
  key: string
  color: Rgb
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

type Motion = Pick<Particle, 'x' | 'y' | 'vx' | 'vy' | 'size' | 'rotation' | 'spin' | 'life'>

interface SceneSpec {
  // 1280×800 画面上每秒生成的数量，按画面面积缩放
  rate: number
  // 默认色：多个时每个粒子随机取一个
  colors: readonly string[]
  spawn: (w: number, h: number) => Motion
  draw: (ctx: CanvasRenderingContext2D, p: Particle, alpha: number) => void
}

const MAX_PARTICLES = 240
const BASE_AREA = 1280 * 800
// 场景渐入 / 渐出的速度（每秒）
const DENSITY_IN = 0.6
const DENSITY_OUT = 0.8
const LEAVE_SECONDS = 1.2
// 离开画面多远后移除（另加粒子自身尺寸）
const MARGIN = 60
const TAU = Math.PI * 2

const rand = (min: number, max: number) => min + Math.random() * (max - min)
const pick = <T>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)]

/** 带透明度的颜色 */
const rgba = ([r, g, b]: Rgb, a: number) => `rgb(${r} ${g} ${b} / ${Math.max(0, a).toFixed(3)})`
/** 与白色混合 t（0 ~ 1） */
const mixWhite = ([r, g, b]: Rgb, t: number): Rgb => [r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t].map(Math.round) as Rgb

const NOTE_GLYPHS = ['♪', '♫', '♬', '♩']
// 多色场景的默认色板
const FESTIVE: LyricColor[] = ['crimson', 'amber', 'sunshine', 'spring-green', 'lake', 'starry-blue', 'lavender', 'cherry-blossom']

/** 心形路径：中心在原点，大小约为 2s */
function heartPath(ctx: CanvasRenderingContext2D, s: number) {
  ctx.beginPath()
  ctx.moveTo(0, s * 0.35)
  ctx.bezierCurveTo(-s * 1.1, -s * 0.35, -s * 0.5, -s * 1.1, 0, -s * 0.45)
  ctx.bezierCurveTo(s * 0.5, -s * 1.1, s * 1.1, -s * 0.35, 0, s * 0.35)
  ctx.closePath()
}

/** 光晕 + 亮核的光点 */
function glowDot(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: Rgb, a: number) {
  ctx.fillStyle = rgba(color, 0.18 * a)
  ctx.beginPath()
  ctx.arc(x, y, size * 3.5, 0, TAU)
  ctx.fill()
  ctx.fillStyle = rgba(mixWhite(color, 0.5), 0.9 * a)
  ctx.beginPath()
  ctx.arc(x, y, size, 0, TAU)
  ctx.fill()
}

const SCENES: Record<LyricScene, SceneSpec> = {
  petals: {
    rate: 5,
    colors: ['#f9a8d4'],
    spawn: w => ({ x: rand(-40, w), y: -20, vx: rand(10, 40), vy: rand(35, 70), size: rand(6, 11), rotation: rand(0, TAU), spin: rand(-1.5, 1.5), life: Infinity }),
    draw: (ctx, p, alpha) => {
      ctx.save()
      ctx.translate(p.x + Math.sin(p.age * 1.3 + p.seed) * 12, p.y)
      ctx.rotate(p.rotation)
      // 翻转：宽度随时间变化
      ctx.scale(Math.abs(Math.cos(p.age * 1.7 + p.seed)) * 0.7 + 0.3, 1)
      ctx.fillStyle = rgba(p.color, 0.75 * alpha)
      ctx.beginPath()
      ctx.ellipse(0, 0, p.size * 0.55, p.size, 0, 0, TAU)
      ctx.fill()
      ctx.restore()
    },
  },
  sparks: {
    rate: 9,
    colors: ['#ffd977'],
    spawn: (w, h) => ({ x: rand(0, w), y: h + 10, vx: rand(-8, 8), vy: rand(-55, -20), size: rand(1.2, 2.8), rotation: 0, spin: 0, life: rand(4, 9) }),
    draw: (ctx, p, alpha) => {
      const flicker = 0.6 + 0.4 * Math.sin(p.age * 6 + p.seed * 10)
      glowDot(ctx, p.x + Math.sin(p.age * 0.8 + p.seed) * 10, p.y, p.size, p.color, alpha * flicker)
    },
  },
  snow: {
    rate: 14,
    colors: ['#ffffff'],
    spawn: w => ({ x: rand(-20, w + 20), y: -10, vx: rand(-6, 10), vy: rand(22, 55), size: rand(1.2, 3.8), rotation: 0, spin: 0, life: Infinity }),
    draw: (ctx, p, alpha) => {
      ctx.fillStyle = rgba(p.color, 0.8 * alpha)
      ctx.beginPath()
      ctx.arc(p.x + Math.sin(p.age + p.seed) * 8, p.y, p.size, 0, TAU)
      ctx.fill()
    },
  },
  stars: {
    rate: 7,
    colors: ['#ffffff'],
    spawn: (w, h) => ({ x: rand(0, w), y: rand(0, h * 0.75), vx: rand(-3, 3), vy: rand(-2, 2), size: rand(0.8, 2.4), rotation: 0, spin: 0, life: rand(3, 6) }),
    draw: (ctx, p, alpha) => {
      // 一生中亮起再熄灭，并带轻微闪烁
      const a = alpha * Math.sin(Math.PI * p.age / p.life) * (0.75 + 0.25 * Math.sin(p.age * 5 + p.seed * 7))
      ctx.fillStyle = rgba(p.color, 0.9 * a)
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size, 0, TAU)
      ctx.fill()
      if (p.size > 1.8) {
        // 较亮的星加十字光芒
        ctx.strokeStyle = rgba(p.color, 0.4 * a)
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
    colors: ['#c8ebff'],
    spawn: (w, h) => ({ x: rand(0, w), y: h + 20, vx: 0, vy: rand(-45, -20), size: rand(4, 14), rotation: 0, spin: 0, life: Infinity }),
    draw: (ctx, p, alpha) => {
      const x = p.x + Math.sin(p.age * 1.6 + p.seed) * 10
      ctx.strokeStyle = rgba(p.color, 0.55 * alpha)
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.arc(x, p.y, p.size, 0, TAU)
      ctx.stroke()
      ctx.fillStyle = rgba(mixWhite(p.color, 0.7), 0.35 * alpha)
      ctx.beginPath()
      ctx.arc(x - p.size * 0.35, p.y - p.size * 0.35, p.size * 0.22, 0, TAU)
      ctx.fill()
    },
  },
  rain: {
    rate: 45,
    colors: ['#d2e1ff'],
    spawn: w => ({ x: rand(-100, w), y: -30, vx: 120, vy: rand(650, 900), size: rand(12, 24), rotation: 0, spin: 0, life: Infinity }),
    draw: (ctx, p, alpha) => {
      const k = p.size / Math.hypot(p.vx, p.vy)
      ctx.strokeStyle = rgba(p.color, 0.3 * alpha)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(p.x - p.vx * k, p.y - p.vy * k)
      ctx.stroke()
    },
  },
  leaves: {
    rate: 4,
    colors: ['maple', 'amber', 'sunset'],
    spawn: w => ({ x: rand(-40, w), y: -20, vx: rand(15, 50), vy: rand(40, 80), size: rand(7, 12), rotation: rand(0, TAU), spin: rand(-2, 2), life: Infinity }),
    draw: (ctx, p, alpha) => {
      ctx.save()
      ctx.translate(p.x + Math.sin(p.age * 1.1 + p.seed) * 18, p.y)
      ctx.rotate(p.rotation)
      ctx.scale(Math.abs(Math.cos(p.age * 1.4 + p.seed)) * 0.8 + 0.2, 1)
      const s = p.size
      ctx.fillStyle = rgba(p.color, 0.8 * alpha)
      ctx.beginPath()
      ctx.moveTo(0, -s)
      ctx.quadraticCurveTo(s * 0.75, 0, 0, s)
      ctx.quadraticCurveTo(-s * 0.75, 0, 0, -s)
      ctx.fill()
      // 叶脉与叶柄
      ctx.strokeStyle = rgba(mixWhite(p.color, 0.4), 0.6 * alpha)
      ctx.lineWidth = 0.8
      ctx.beginPath()
      ctx.moveTo(0, -s * 0.8)
      ctx.lineTo(0, s * 1.3)
      ctx.stroke()
      ctx.restore()
    },
  },
  fireflies: {
    rate: 3,
    colors: ['#d4f56a'],
    spawn: (w, h) => ({ x: rand(0, w), y: rand(h * 0.3, h), vx: rand(-6, 6), vy: rand(-8, 2), size: rand(1.4, 2.6), rotation: 0, spin: 0, life: rand(5, 9) }),
    draw: (ctx, p, alpha) => {
      // 游走 + 呼吸式明灭
      const x = p.x + Math.sin(p.age * 0.7 + p.seed) * 30
      const y = p.y + Math.cos(p.age * 0.9 + p.seed * 2) * 20
      const blink = ((Math.sin(p.age * 2.5 + p.seed * 5) + 1) / 2) ** 2
      glowDot(ctx, x, y, p.size, p.color, alpha * (0.15 + 0.85 * blink))
    },
  },
  feathers: {
    rate: 1.5,
    colors: ['#f5f5f5'],
    spawn: w => ({ x: rand(0, w), y: -30, vx: rand(-5, 15), vy: rand(18, 35), size: rand(10, 18), rotation: 0, spin: 0, life: Infinity }),
    draw: (ctx, p, alpha) => {
      // 像钟摆一样左右荡着落下
      const swing = Math.sin(p.age * 1.2 + p.seed)
      ctx.save()
      ctx.translate(p.x + swing * 30, p.y)
      ctx.rotate(swing * 0.6 + 0.3)
      const s = p.size
      ctx.fillStyle = rgba(p.color, 0.55 * alpha)
      ctx.beginPath()
      ctx.ellipse(0, 0, s * 0.3, s, 0, 0, TAU)
      ctx.fill()
      ctx.strokeStyle = rgba(p.color, 0.85 * alpha)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, -s)
      ctx.lineTo(0, s * 1.35)
      ctx.stroke()
      ctx.restore()
    },
  },
  hearts: {
    rate: 3,
    colors: ['rose', 'cherry-blossom', 'peach'],
    spawn: (w, h) => ({ x: rand(0, w), y: h + 20, vx: 0, vy: rand(-60, -30), size: rand(6, 12), rotation: rand(-0.3, 0.3), spin: 0, life: Infinity }),
    draw: (ctx, p, alpha) => {
      ctx.save()
      ctx.translate(p.x + Math.sin(p.age * 1.4 + p.seed) * 14, p.y)
      ctx.rotate(p.rotation)
      // 心跳一样轻微缩放
      const beat = 1 + 0.08 * Math.sin(p.age * 4 + p.seed)
      ctx.scale(beat, beat)
      ctx.fillStyle = rgba(p.color, 0.7 * alpha)
      heartPath(ctx, p.size)
      ctx.fill()
      ctx.restore()
    },
  },
  confetti: {
    rate: 14,
    colors: FESTIVE,
    spawn: w => ({ x: rand(0, w), y: -15, vx: rand(-30, 30), vy: rand(60, 120), size: rand(4, 8), rotation: rand(0, TAU), spin: rand(-6, 6), life: Infinity }),
    draw: (ctx, p, alpha) => {
      ctx.save()
      ctx.translate(p.x + Math.sin(p.age * 2 + p.seed) * 10, p.y)
      ctx.rotate(p.rotation)
      ctx.scale(Math.cos(p.age * 6 + p.seed), 1)
      ctx.fillStyle = rgba(p.color, 0.85 * alpha)
      ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6)
      ctx.restore()
    },
  },
  fireworks: {
    rate: 0.8,
    colors: FESTIVE,
    // size 为炸开的最大半径
    spawn: (w, h) => ({ x: rand(w * 0.15, w * 0.85), y: rand(h * 0.1, h * 0.5), vx: 0, vy: 0, size: rand(60, 110), rotation: rand(0, TAU), spin: 0, life: rand(1.8, 2.4) }),
    draw: (ctx, p, alpha) => {
      const t = p.age / p.life
      const radius = p.size * (1 - (1 - t) ** 3)
      const fade = alpha * (1 - t) ** 1.5
      const count = 28
      const drop = 30 * t * t
      ctx.fillStyle = rgba(mixWhite(p.color, 0.3), 0.9 * fade)
      ctx.strokeStyle = rgba(p.color, 0.45 * fade)
      ctx.lineWidth = 1.2
      for (let i = 0; i < count; i++) {
        const angle = p.rotation + (i / count) * TAU
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        const x = p.x + cos * radius
        const y = p.y + sin * radius + drop
        // 拖尾 + 火花
        ctx.beginPath()
        ctx.moveTo(p.x + cos * radius * 0.82, p.y + sin * radius * 0.82 + drop * 0.8)
        ctx.lineTo(x, y)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(x, y, 1.8 * (1 - t * 0.5), 0, TAU)
        ctx.fill()
      }
      // 刚炸开时的闪光
      if (t < 0.12) {
        ctx.fillStyle = rgba(mixWhite(p.color, 0.7), (1 - t / 0.12) * 0.6 * alpha)
        ctx.beginPath()
        ctx.arc(p.x, p.y, 10, 0, TAU)
        ctx.fill()
      }
    },
  },
  dandelion: {
    rate: 2,
    colors: ['#ffffff'],
    spawn: (w, h) => ({ x: -20, y: rand(h * 0.2, h), vx: rand(25, 55), vy: rand(-20, -5), size: rand(5, 8), rotation: rand(-0.4, 0.4), spin: rand(-0.3, 0.3), life: Infinity }),
    draw: (ctx, p, alpha) => {
      ctx.save()
      ctx.translate(p.x, p.y + Math.sin(p.age * 1.5 + p.seed) * 10)
      ctx.rotate(p.rotation)
      const s = p.size
      ctx.strokeStyle = rgba(p.color, 0.6 * alpha)
      ctx.lineWidth = 0.8
      // 种子与茎
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(0, s * 1.6)
      ctx.stroke()
      // 冠毛：顶端放射状的细丝
      ctx.beginPath()
      for (let i = 0; i < 9; i++) {
        const angle = -Math.PI + (i / 8) * Math.PI
        ctx.moveTo(0, 0)
        ctx.lineTo(Math.cos(angle) * s, Math.sin(angle) * s)
      }
      ctx.stroke()
      ctx.restore()
    },
  },
  butterflies: {
    rate: 1.2,
    colors: ['lavender', 'sky', 'sunshine', 'cherry-blossom'],
    spawn: (w, h) => ({ x: rand(0, w), y: h + 20, vx: rand(-30, 30), vy: rand(-45, -25), size: rand(6, 10), rotation: 0, spin: 0, life: Infinity }),
    draw: (ctx, p, alpha) => {
      const x = p.x + Math.sin(p.age * 0.9 + p.seed) * 40
      ctx.save()
      ctx.translate(x, p.y)
      // 朝飞行方向略微倾斜
      ctx.rotate(Math.cos(p.age * 0.9 + p.seed) * 0.4 + p.vx / 120)
      const s = p.size
      const flap = 0.25 + 0.75 * Math.abs(Math.sin(p.age * 8 + p.seed))
      ctx.fillStyle = rgba(p.color, 0.75 * alpha)
      for (const side of [-1, 1]) {
        ctx.save()
        ctx.scale(side * flap, 1)
        ctx.beginPath()
        ctx.ellipse(s * 0.55, -s * 0.3, s * 0.6, s * 0.45, -0.4, 0, TAU)
        ctx.ellipse(s * 0.4, s * 0.35, s * 0.4, s * 0.3, 0.4, 0, TAU)
        ctx.fill()
        ctx.restore()
      }
      ctx.strokeStyle = rgba(mixWhite(p.color, 0.5), 0.8 * alpha)
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(0, -s * 0.6)
      ctx.lineTo(0, s * 0.6)
      ctx.stroke()
      ctx.restore()
    },
  },
  meteors: {
    rate: 0.6,
    colors: ['#e6f0ff'],
    // size 为拖尾长度
    spawn: (w, h) => ({ x: rand(w * 0.3, w + 100), y: rand(-40, h * 0.3), vx: rand(-700, -500), vy: rand(250, 350), size: rand(120, 220), rotation: 0, spin: 0, life: rand(1.2, 2) }),
    draw: (ctx, p, alpha) => {
      const k = p.size / Math.hypot(p.vx, p.vy)
      const tailX = p.x - p.vx * k
      const tailY = p.y - p.vy * k
      const gradient = ctx.createLinearGradient(p.x, p.y, tailX, tailY)
      gradient.addColorStop(0, rgba(mixWhite(p.color, 0.5), 0.9 * alpha))
      gradient.addColorStop(1, rgba(p.color, 0))
      ctx.strokeStyle = gradient
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(tailX, tailY)
      ctx.stroke()
      glowDot(ctx, p.x, p.y, 1.6, p.color, alpha)
    },
  },
  clouds: {
    rate: 0.35,
    colors: ['#ffffff'],
    spawn: (w, h) => {
      const size = rand(120, 260)
      return { x: -size, y: rand(0, h * 0.7), vx: rand(8, 20), vy: 0, size, rotation: 0, spin: 0, life: Infinity }
    },
    draw: (ctx, p, alpha) => {
      // 三团柔和的径向渐变叠成一朵云
      for (const [dx, dy, r] of [[0, 0, 1], [-0.45, 0.12, 0.7], [0.5, 0.1, 0.75]] as const) {
        const cx = p.x + dx * p.size
        const cy = p.y + dy * p.size
        const radius = p.size * r * 0.6
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
        gradient.addColorStop(0, rgba(p.color, 0.1 * alpha))
        gradient.addColorStop(1, rgba(p.color, 0))
        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.arc(cx, cy, radius, 0, TAU)
        ctx.fill()
      }
    },
  },
  ripples: {
    rate: 2.5,
    colors: ['#c8ebff'],
    // size 为扩散的最大半径
    spawn: (w, h) => ({ x: rand(0, w), y: rand(h * 0.4, h), vx: 0, vy: 0, size: rand(30, 70), rotation: 0, spin: 0, life: rand(2, 3) }),
    draw: (ctx, p, alpha) => {
      const t = p.age / p.life
      ctx.lineWidth = 1.2
      // 两圈同心椭圆（俯视的水面），外圈先扩散
      for (const [scale, a] of [[1, 0.5], [0.6, 0.35]] as const) {
        const radius = p.size * scale * t
        if (radius <= 0)
          continue
        ctx.strokeStyle = rgba(p.color, a * (1 - t) * alpha)
        ctx.beginPath()
        ctx.ellipse(p.x, p.y, radius, radius * 0.4, 0, 0, TAU)
        ctx.stroke()
      }
    },
  },
  notes: {
    rate: 2.5,
    colors: ['#ffffff'],
    spawn: (w, h) => ({ x: rand(0, w), y: h + 20, vx: 0, vy: rand(-45, -25), size: rand(14, 22), rotation: rand(-0.3, 0.3), spin: rand(-0.3, 0.3), life: Infinity }),
    draw: (ctx, p, alpha) => {
      ctx.save()
      ctx.translate(p.x + Math.sin(p.age * 1.3 + p.seed) * 16, p.y)
      ctx.rotate(p.rotation)
      ctx.fillStyle = rgba(p.color, 0.6 * alpha)
      ctx.font = `${Math.round(p.size)}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(NOTE_GLYPHS[Math.floor(p.seed) % NOTE_GLYPHS.length], 0, 0)
      ctx.restore()
    },
  },
}

/** 解析颜色：色板名称或 #rrggbb */
function resolveColor(color: string): Rgb {
  return hexToRgb(color.startsWith('#') ? color : LYRIC_COLORS[color as LyricColor])
}

const sceneKey = (scene: StageScene | null) => (scene ? `${scene.name}:${scene.color ?? ''}` : '')

export class StageParticles {
  private ctx: CanvasRenderingContext2D | null
  private particles: Particle[] = []
  private density = 0
  private scene: StageScene | null = null
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

  /** 推进 dt 秒并绘制；scene 为当前场景与颜色主题（null 为无），active 为 false 时（暂停）不再生成 */
  update(dt: number, scene: StageScene | null, active: boolean) {
    const ctx = this.ctx
    if (!ctx)
      return
    const key = sceneKey(scene)
    // 换场景（或颜色主题）时先渐出旧场景，渐出完再渐入新场景
    if (key !== sceneKey(this.scene) && this.density === 0)
      this.scene = scene
    const current = this.scene
    const currentKey = sceneKey(current)
    const target = active && current != null && key === currentKey ? 1 : 0
    this.density = target > this.density
      ? Math.min(target, this.density + DENSITY_IN * dt)
      : Math.max(target, this.density - DENSITY_OUT * dt)

    if (current && this.density > 0) {
      const spec = SCENES[current.name]
      const area = Math.min(2, Math.max(0.3, (this.width * this.height) / BASE_AREA))
      this.pending += spec.rate * area * this.density * dt
      while (this.pending >= 1) {
        this.pending--
        if (this.particles.length >= MAX_PARTICLES)
          continue
        // 指定颜色主题时略微随机提亮，避免整片同色
        const color = current.color ? mixWhite(resolveColor(current.color), rand(0, 0.25)) : resolveColor(pick(spec.colors))
        this.particles.push({ ...spec.spawn(this.width, this.height), scene: current.name, key: currentKey, color, age: 0, seed: Math.random() * 10, leave: 0 })
      }
    }
    else {
      this.pending = 0
    }

    ctx.clearRect(0, 0, this.width, this.height)
    this.particles = this.particles.filter((p) => {
      p.age += dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.rotation += p.spin * dt
      if (!active || p.key !== key)
        p.leave += dt / LEAVE_SECONDS
      const margin = MARGIN + p.size
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
