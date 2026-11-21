import type { Rgb } from './colors'
import type { RhythmPulse } from './rhythm/model'
import type { StageScene } from './stage-effects'
import type { LyricColor, LyricScene, LyricSprite, LyricSpriteMotion } from './types'
import { hdrCanvasColor } from '@/lib/hdr-color'
import { hexToRgb, LYRIC_COLORS } from './colors'

/**
 * 播放器页的全屏粒子（canvas 2D），共 25 种内置场景（与后端 lyricAnnotationSceneList 及 macOS StageEffectsSystem 一致）。
 * 当前场景按 density（0 ~ 1，渐入渐出）生成粒子；切换场景或颜色主题、结束场景或暂停后不再生成，已有粒子在 LEAVE_SECONDS 内淡出。
 * 颜色：指定了颜色主题时所有粒子使用该颜色（略微随机提亮以增加层次），否则使用场景的默认色（部分场景为多色）。
 * 自定义粒子（场景名为 custom:<name>，见 spriteSpec）：按动作预设生成，用 Path2D 画图标库的图标或模型画的剪影，数量与透明度有上限。
 * 节拍联动分三类：
 * 1. 拍点簇发生成（SceneSpec.beat / beatRatio）：烟花、舞台灯、涟漪、音符、爱心、彩纸、流星、像素块、电弧、星芒、余烬、星火及自定义 burst；
 * 2. 周期自适应物理动力学（rawPeriodMs / tempoScale）：瞬态爆发类（烟花、舞台灯、涟漪、星芒、闪电、自定义 burst）的绽放寿命直接对齐真实单拍周期 T_0，
 *    节奏耦合类（像素半拍网格跳步、彩纸翻转、流星划过、音符/爱心/星火/余烬上浮）随曲速无极变速；
 * 3. 已有粒子的姿态/光晕随拍调制：爱心噗通缩放、光点/散景/天灯/余烬/舞台灯随拍呼吸提亮、蝴蝶随曲速振翅、自定义 sway 对齐拍点左右挥摆；
 * 雪、雨、花瓣、落叶、羽毛、蒲公英、云朵、气泡等自然流体场景保持纯自然无节拍运动。
 */

interface Particle {
  spec: SceneSpec
  // 场景 + 颜色主题，与当前不同时淡出
  key: string
  color: Rgb
  x: number
  y: number
  vx: number
  vy: number
  size: number
  // 舞台灯等纵向贯穿画面的光束长度（不随小画幅 scale 缩放，保证填满容器高度）
  len?: number
  baseAngle?: number
  sweepAmp?: number
  sweepDir?: number
  burstExp?: number
  rotation: number
  spin: number
  // 已存在时长与寿命（秒）；寿命为 Infinity 时离开画面才移除
  age: number
  life: number
  seed: number
  // 离场淡出的进度（0 ~ 1），场景切换、结束或暂停后开始
  leave: number
  // 在拍点生成：淡入更快，让出现的瞬间落在拍上
  onBeat?: boolean
}

type Motion = Pick<Particle, 'x' | 'y' | 'vx' | 'vy' | 'size' | 'rotation' | 'spin' | 'life'>
  & Partial<Pick<Particle, 'len' | 'baseAngle' | 'sweepAmp' | 'sweepDir' | 'burstExp'>>

interface SceneSpec {
  // 1280×800 画面上每秒生成的数量，按画面面积缩放
  rate: number
  // 默认色：多个时每个粒子随机取一个
  colors: readonly string[]
  spawn: (w: number, h: number) => Motion
  draw: (ctx: CanvasRenderingContext2D, p: Particle, alpha: number) => void
  // 同屏数量上限（自定义粒子或大尺寸粒子用），未设置时只受总数上限限制
  max?: number
  // 跟随节拍时在拍点成簇生成，值为相对基准脉冲的八度；beatRatio（默认 1）为走拍点簇发的速率占比，其余保持连续底流；
  // beatSpawn 为在拍点生成时的位置（直接出现在画面里，而不是从画面外进入）
  beat?: number
  beatRatio?: number
  beatSpawn?: (w: number, h: number) => Motion
  // 瞬态闪现（如闪电）：省去慢淡入让第一帧即亮起
  instant?: boolean
}

/** 跟随节拍时的输入：本帧经过的拍（按八度）与各类随拍调制信号；不跟随节拍时为 null */
export interface StageParticleRhythm {
  pulses: (octave: number) => { pulses: RhythmPulse[], periodMs: number } | null
  heart: number | null
  breath?: number | null
  sway?: number | null
  tempoScale?: number
  // 未折叠的真实单拍周期（毫秒，60000/BPM）与歌词折叠后的基准周期（毫秒）
  rawPeriodMs?: number | null
  basePeriodMs?: number | null
}

// 这一帧随拍调制的瞬时状态（update 中写入，生成与绘制时读取）；不跟随节拍时为 null，退回粒子自身的柔和自然起伏
let heartBeat: number | null = null
let beatBreath: number | null = null
let beatSway: number | null = null
let beatTempoScale = 1
let rawBeatSec: number | null = null
// 这一帧的 HDR 亮度倍数（update 中写入，rgba 读取）：大于 1 时颜色写成 color(srgb-linear …) 并乘以它，见 StageParticlesOptions.hdrGain
let colorGain = 1

const MAX_PARTICLES = 240
// 没有场景、画面也已清空这么久后释放画布（缩成 0×0），下次有场景时恢复
const RELEASE_IDLE_S = 3
const BASE_AREA = 1280 * 800
// 场景渐入 / 渐出的速度（每秒）
const DENSITY_IN = 0.6
const DENSITY_OUT = 0.8
const LEAVE_SECONDS = 1.2
// 离开画面多远后移除（另加粒子自身尺寸）
const MARGIN = 60
const TAU = Math.PI * 2

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const rand = (min: number, max: number) => min + Math.random() * (max - min)
const pick = <T>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)]

/** 带透明度的颜色；HDR 下亮过 SDR 白（只有 float16 画布存得下，见 lib/hdr-canvas.ts） */
function rgba(color: Rgb, a: number) {
  return hdrCanvasColor(color, colorGain, a)
}

/** 与白色混合 t（0 ~ 1） */
const mixWhite = ([r, g, b]: Rgb, t: number): Rgb => [r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t].map(Math.round) as Rgb

const NOTE_GLYPHS = ['♪', '♫', '♬', '♩']
// 多色场景的默认色板
const FESTIVE: LyricColor[] = ['crimson', 'amber', 'sunshine', 'spring-green', 'lake', 'starry-blue', 'lavender', 'cherry-blossom']

let unitPetalPath: Path2D | null = null
let unitHeartPath: Path2D | null = null
let unitLeafBodyPath: Path2D | null = null
let unitLeafStemPath: Path2D | null = null
let unitLanternPath: Path2D | null = null
let unitEmberPath: Path2D | null = null
let unitSparklePath: Path2D | null = null

function getUnitPetalPath() {
  if (!unitPetalPath && typeof Path2D !== 'undefined') {
    const p = new Path2D()
    p.ellipse(0, 0, 0.55, 1, 0, 0, TAU)
    unitPetalPath = p
  }
  return unitPetalPath
}

function getUnitHeartPath() {
  if (!unitHeartPath && typeof Path2D !== 'undefined') {
    const p = new Path2D()
    p.moveTo(0, 0.35)
    p.bezierCurveTo(-1.1, -0.35, -0.5, -1.1, 0, -0.45)
    p.bezierCurveTo(0.5, -1.1, 1.1, -0.35, 0, 0.35)
    p.closePath()
    unitHeartPath = p
  }
  return unitHeartPath
}

function getUnitLeafPaths() {
  if (!unitLeafBodyPath && typeof Path2D !== 'undefined') {
    const body = new Path2D()
    body.moveTo(0, -1)
    body.quadraticCurveTo(0.75, 0, 0, 1)
    body.quadraticCurveTo(-0.75, 0, 0, -1)
    unitLeafBodyPath = body
    const stem = new Path2D()
    stem.moveTo(0, -0.8)
    stem.lineTo(0, 1.3)
    unitLeafStemPath = stem
  }
  return { body: unitLeafBodyPath!, stem: unitLeafStemPath! }
}

function getUnitLanternPath() {
  if (!unitLanternPath && typeof Path2D !== 'undefined') {
    const p = new Path2D()
    p.moveTo(-0.38, 0.72)
    p.bezierCurveTo(-0.72, 0.15, -0.68, -0.58, -0.32, -0.82)
    p.quadraticCurveTo(0, -0.96, 0.32, -0.82)
    p.bezierCurveTo(0.68, -0.58, 0.72, 0.15, 0.38, 0.72)
    p.closePath()
    unitLanternPath = p
  }
  return unitLanternPath
}

function getUnitEmberPath() {
  if (!unitEmberPath && typeof Path2D !== 'undefined') {
    const p = new Path2D()
    p.moveTo(0, -1)
    p.lineTo(0.72, -0.22)
    p.lineTo(0.34, 0.88)
    p.lineTo(-0.65, 0.42)
    p.lineTo(-0.52, -0.55)
    p.closePath()
    unitEmberPath = p
  }
  return unitEmberPath
}

function getUnitSparklePath() {
  if (!unitSparklePath && typeof Path2D !== 'undefined') {
    const p = new Path2D()
    p.moveTo(0, -1)
    p.quadraticCurveTo(0.12, -0.12, 1, 0)
    p.quadraticCurveTo(0.12, 0.12, 0, 1)
    p.quadraticCurveTo(-0.12, 0.12, -1, 0)
    p.quadraticCurveTo(-0.12, -0.12, 0, -1)
    p.closePath()
    unitSparklePath = p
  }
  return unitSparklePath
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
      // 翻转：宽度随时间变化，复用缓存 Path2D 避免逐帧重建矢量路径
      ctx.scale((Math.abs(Math.cos(p.age * 1.7 + p.seed)) * 0.7 + 0.3) * p.size, p.size)
      ctx.fillStyle = rgba(p.color, 0.75 * alpha)
      ctx.fill(getUnitPetalPath()!)
      ctx.restore()
    },
  },
  sparks: {
    rate: 9,
    colors: ['#ffd977'],
    beat: 1,
    beatRatio: 0.45,
    spawn: (w, h) => ({ x: rand(0, w), y: h + 10, vx: rand(-8, 8), vy: rand(-55, -20) * clamp(beatTempoScale, 0.78, 1.32), size: rand(1.2, 2.8), rotation: 0, spin: 0, life: rand(4, 9) }),
    beatSpawn: (w, h) => ({ x: rand(0, w), y: rand(h * 0.85, h + 10), vx: rand(-14, 14), vy: rand(-80, -35) * clamp(beatTempoScale, 0.78, 1.32), size: rand(1.4, 3), rotation: 0, spin: 0, life: rand(3.5, 7.5) }),
    draw: (ctx, p, alpha) => {
      const flicker = 0.6 + 0.4 * Math.sin(p.age * 6 + p.seed * 10)
      const boost = 1 + 0.32 * (beatBreath ?? 0)
      glowDot(ctx, p.x + Math.sin(p.age * 0.8 + p.seed) * 10, p.y, p.size * (1 + 0.08 * (beatBreath ?? 0)), p.color, Math.min(1, alpha * flicker * boost))
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
      // 一生中亮起再熄灭，带独立闪烁，跟随节拍时轻微呼吸提亮
      const boost = 1 + 0.28 * (beatBreath ?? 0)
      const a = Math.min(1, alpha * Math.sin(Math.PI * p.age / p.life) * (0.75 + 0.25 * Math.sin(p.age * 5 + p.seed * 7)) * boost)
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
    rate: 1.6,
    max: 28,
    colors: ['#c8ebff'],
    spawn: (w, h) => ({ x: rand(0, w), y: h + 20, vx: 0, vy: rand(-45, -22), size: rand(4, 13), rotation: 0, spin: 0, life: rand(8, 15) }),
    draw: (ctx, p, alpha) => {
      const x = p.x + Math.sin(p.age * 1.6 + p.seed) * 10
      ctx.strokeStyle = rgba(p.color, 0.42 * alpha)
      ctx.lineWidth = 1.1
      ctx.beginPath()
      ctx.arc(x, p.y, p.size, 0, TAU)
      ctx.stroke()
      ctx.fillStyle = rgba(mixWhite(p.color, 0.7), 0.28 * alpha)
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
      const { body, stem } = getUnitLeafPaths()
      const s = p.size
      ctx.scale((Math.abs(Math.cos(p.age * 1.4 + p.seed)) * 0.8 + 0.2) * s, s)
      ctx.fillStyle = rgba(p.color, 0.8 * alpha)
      ctx.fill(body)
      // 叶脉与叶柄
      ctx.strokeStyle = rgba(mixWhite(p.color, 0.4), 0.6 * alpha)
      ctx.lineWidth = 0.8 / s
      ctx.stroke(stem)
      ctx.restore()
    },
  },
  fireflies: {
    rate: 3,
    colors: ['#d4f56a'],
    spawn: (w, h) => ({ x: rand(0, w), y: rand(h * 0.3, h), vx: rand(-6, 6), vy: rand(-8, 2), size: rand(1.4, 2.6), rotation: 0, spin: 0, life: rand(5, 9) }),
    draw: (ctx, p, alpha) => {
      // 游走 + 呼吸式明灭，跟随节拍时微提光晕
      const x = p.x + Math.sin(p.age * 0.7 + p.seed) * 30
      const y = p.y + Math.cos(p.age * 0.9 + p.seed * 2) * 20
      const blink = ((Math.sin(p.age * 2.5 + p.seed * 5) + 1) / 2) ** 2
      const boost = 1 + 0.3 * (beatBreath ?? 0)
      glowDot(ctx, x, y, p.size * (1 + 0.1 * (beatBreath ?? 0)), p.color, Math.min(1, alpha * (0.15 + 0.85 * blink) * boost))
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
    beat: 0,
    spawn: (w, h) => ({ x: rand(0, w), y: h + 20, vx: 0, vy: rand(-60, -30) * clamp(beatTempoScale, 0.78, 1.32), size: rand(6, 12), rotation: rand(-0.3, 0.3), spin: 0, life: Infinity }),
    beatSpawn: (w, h) => ({ x: rand(0, w), y: rand(h * 0.55, h * 0.95), vx: 0, vy: rand(-60, -30) * clamp(beatTempoScale, 0.78, 1.32), size: rand(6, 12), rotation: rand(-0.3, 0.3), spin: 0, life: Infinity }),
    draw: (ctx, p, alpha) => {
      ctx.save()
      ctx.translate(p.x + Math.sin(p.age * 1.4 + p.seed) * 14, p.y)
      ctx.rotate(p.rotation)
      // 随拍跳动；不跟随节拍时心跳一样轻微缩放
      const beat = (heartBeat == null ? 1 + 0.08 * Math.sin(p.age * 4 + p.seed) : 1 + 0.12 * heartBeat) * p.size
      ctx.scale(beat, beat)
      ctx.fillStyle = rgba(p.color, 0.7 * alpha)
      ctx.fill(getUnitHeartPath()!)
      ctx.restore()
    },
  },
  confetti: {
    rate: 14,
    colors: FESTIVE,
    beat: 1,
    beatRatio: 0.7,
    spawn: w => ({ x: rand(0, w), y: -15, vx: rand(-30, 30) * beatTempoScale, vy: rand(60, 120) * clamp(beatTempoScale, 0.78, 1.4), size: rand(4, 8), rotation: rand(0, TAU), spin: rand(-6, 6) * beatTempoScale, life: Infinity }),
    beatSpawn: (w, h) => ({ x: rand(w * 0.05, w * 0.95), y: rand(-10, h * 0.28), vx: rand(-65, 65) * beatTempoScale, vy: rand(45, 115) * clamp(beatTempoScale, 0.78, 1.4), size: rand(4, 8), rotation: rand(0, TAU), spin: rand(-8, 8) * beatTempoScale, life: Infinity }),
    draw: (ctx, p, alpha) => {
      ctx.save()
      ctx.translate(p.x + Math.sin(p.age * 2 + p.seed) * 10, p.y)
      ctx.rotate(p.rotation)
      ctx.scale(Math.cos(p.age * 6 * beatTempoScale + p.seed), 1)
      ctx.fillStyle = rgba(p.color, 0.85 * alpha)
      ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6)
      ctx.restore()
    },
  },
  fireworks: {
    rate: 0.8,
    colors: FESTIVE,
    beat: 1,
    // size 为炸开的最大半径；绽放寿命随真实单拍周期 T_0 自适应伸缩（快歌利落瞬爆不糊屏，慢歌宏大持久悬停）
    spawn: (w, h) => {
      const hScale = Math.min(1, Math.max(0.42, h / 140))
      const y = h < 90 ? rand(h * 0.24, h * 0.68) : rand(h * 0.1, h * 0.5)
      const life = rawBeatSec != null ? clamp(2 * rawBeatSec * rand(1.25, 1.62), 0.85, 3.5) : rand(1.8, 2.4)
      const burstExp = rawBeatSec != null ? clamp(2.8 + (beatTempoScale - 1) * 1.1, 2.2, 4.4) : 3
      return { x: rand(w * 0.15, w * 0.85), y, vx: 0, vy: 0, size: rand(60, 110) * hScale, rotation: rand(0, TAU), spin: 0, life, burstExp }
    },
    draw: (ctx, p, alpha) => {
      const t = p.age / p.life
      const radius = p.size * (1 - (1 - t) ** (p.burstExp ?? 3))
      const fade = alpha * (1 - t) ** 1.5
      const count = 28
      const drop = Math.min(30, p.size * 0.32) * t * t
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
        ctx.arc(p.x, p.y, Math.min(10, p.size * 0.22), 0, TAU)
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
      const y = p.y - 3 * (beatBreath ?? 0)
      ctx.save()
      ctx.translate(x, y)
      // 朝飞行方向略微倾斜
      ctx.rotate(Math.cos(p.age * 0.9 + p.seed) * 0.4 + p.vx / 120)
      const s = p.size
      const flap = 0.25 + 0.75 * Math.abs(Math.sin(p.age * 8 * beatTempoScale + p.seed))
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
    beat: 2,
    // size 为拖尾长度；划过速度与寿命随曲速缩放
    spawn: (w, h) => {
      const speedMul = clamp(beatTempoScale, 0.75, 1.5)
      return { x: rand(w * 0.3, w + 100), y: rand(-40, h * 0.3), vx: rand(-700, -500) * speedMul, vy: rand(250, 350) * speedMul, size: rand(120, 220), rotation: 0, spin: 0, life: rand(1.2, 2) / speedMul }
    },
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
    beat: 0,
    // size 为扩散的最大半径；扩散寿命随拍子周期伸缩
    spawn: (w, h) => ({ x: rand(0, w), y: rand(h * 0.4, h), vx: 0, vy: 0, size: rand(30, 70), rotation: 0, spin: 0, life: rawBeatSec != null ? clamp(rawBeatSec * rand(2.2, 3), 0.95, 3.8) : rand(2, 3) }),
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
    beat: 0,
    spawn: (w, h) => ({ x: rand(0, w), y: h + 20, vx: 0, vy: rand(-45, -25) * clamp(beatTempoScale, 0.78, 1.32), size: rand(14, 22), rotation: rand(-0.3, 0.3), spin: rand(-0.3, 0.3), life: Infinity }),
    beatSpawn: (w, h) => ({ x: rand(0, w), y: rand(h * 0.55, h * 0.95), vx: 0, vy: rand(-45, -25) * clamp(beatTempoScale, 0.78, 1.32), size: rand(14, 22), rotation: rand(-0.3, 0.3), spin: rand(-0.3, 0.3), life: Infinity }),
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
  pixels: {
    rate: 8,
    colors: ['aurora', 'sky', 'violet', 'lemon'],
    beat: 0,
    beatRatio: 0.75,
    spawn: (w, h) => ({ x: rand(0, w), y: rand(h * 0.45, h + 12), vx: 0, vy: rand(-75, -35) * beatTempoScale, size: rand(5, 11), rotation: 0, spin: 0, life: rawBeatSec != null ? clamp(rawBeatSec * rand(3.5, 5.8), 1.1, 4.8) : rand(2.2, 3.8) }),
    beatSpawn: (w, h) => ({ x: rand(w * 0.05, w * 0.95), y: rand(h * 0.18, h * 0.88), vx: 0, vy: rand(-65, -28) * beatTempoScale, size: rand(5, 12), rotation: 0, spin: 0, life: rawBeatSec != null ? clamp(rawBeatSec * rand(2.6, 4.2), 0.9, 3.6) : rand(1.6, 2.8) }),
    draw: (ctx, p, alpha) => {
      // 量化阶梯横跳（跟随节拍时锁定半拍 T_0/2 八分音符网格）+ 实心/线框混合数码方块
      const stepHz = rawBeatSec != null ? clamp(1 / (rawBeatSec * 0.5), 2.5, 14) : 8
      const stepAge = Math.floor(p.age * stepHz) / stepHz
      const hop = Math.round(Math.sin(stepAge * 7 + p.seed * 3)) * p.size * 0.9
      const x = Math.round(p.x + hop)
      const y = Math.round(p.y)
      const s = Math.max(3, Math.round(p.size * (1 + 0.12 * (beatBreath ?? 0))))
      const flicker = 0.75 + 0.25 * (Math.sin(stepAge * 19 + p.seed * 11) > -0.4 ? 1 : 0.2)
      const a = Math.min(1, alpha * flicker * (1 + 0.25 * (beatBreath ?? 0)))
      const hollow = Math.floor(p.seed * 10) % 3 === 0
      if (hollow) {
        ctx.strokeStyle = rgba(mixWhite(p.color, 0.35), 0.82 * a)
        ctx.lineWidth = 1.4
        ctx.strokeRect(x - s / 2, y - s / 2, s, s)
      }
      else {
        ctx.fillStyle = rgba(p.color, 0.72 * a)
        ctx.fillRect(x - s / 2, y - s / 2, s, s)
        const hi = Math.max(1.5, s * 0.28)
        ctx.fillStyle = rgba(mixWhite(p.color, 0.65), 0.75 * a)
        ctx.fillRect(x - s / 2 + 1, y - s / 2 + 1, hi, hi)
      }
    },
  },
  lightning: {
    rate: 0.55,
    max: 6,
    colors: ['#dcebff', 'ice', 'violet'],
    beat: 2,
    instant: true,
    // size 为闪电主干长度，rotation 为劈落方向角（约朝下 ±25°），闪烁寿命对齐小节拍长
    spawn: (w, h) => ({ x: rand(w * 0.12, w * 0.88), y: rand(-10, h * 0.18), vx: 0, vy: 0, size: rand(160, 300) * Math.min(1, Math.max(0.32, h / 180)), rotation: rand(Math.PI * 0.36, Math.PI * 0.64), spin: 0, life: rawBeatSec != null ? clamp(4 * rawBeatSec * rand(0.2, 0.3), 0.24, 0.92) : rand(0.42, 0.62) }),
    draw: (ctx, p, alpha) => {
      const t = Math.min(1, p.age / p.life)
      const steps = 7
      const reach = Math.min(steps, Math.max(2, Math.ceil((t / 0.18) * steps)))
      const flicker = t < 0.18 ? 1 : (0.72 + 0.28 * Math.sin(t * 26 * beatTempoScale + p.seed * 3)) * ((1 - t) / 0.82) ** 1.4
      const a = Math.min(1, alpha * flicker)
      if (a <= 0.01)
        return
      const dx = Math.cos(p.rotation)
      const dy = Math.sin(p.rotation)
      const px = -dy
      const py = dx
      const traceBolt = () => {
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        let forkX = p.x
        let forkY = p.y
        for (let i = 1; i <= reach; i++) {
          const frac = i / steps
          const jitter = i === steps ? 0 : Math.sin(p.seed * 13.7 + i * 4.3) * 0.095 * p.size
          const vx = p.x + dx * p.size * frac + px * jitter
          const vy = p.y + dy * p.size * frac + py * jitter
          ctx.lineTo(vx, vy)
          if (i === 3) {
            forkX = vx
            forkY = vy
          }
        }
        if (reach > 3) {
          const forkAngle = p.rotation + (Math.sin(p.seed * 7.1) >= 0 ? 0.52 : -0.52)
          const fdx = Math.cos(forkAngle)
          const fdy = Math.sin(forkAngle)
          const fpx = -fdy
          const fpy = fdx
          const forkLen = p.size * 0.42
          const forkReach = Math.min(3, reach - 3)
          ctx.moveTo(forkX, forkY)
          for (let j = 1; j <= forkReach; j++) {
            const frac = j / 3
            const jitter = Math.sin(p.seed * 9.3 + j * 5.1) * 0.05 * p.size
            ctx.lineTo(forkX + fdx * forkLen * frac + fpx * jitter, forkY + fdy * forkLen * frac + fpy * jitter)
          }
        }
      }
      ctx.save()
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      traceBolt()
      ctx.strokeStyle = rgba(p.color, 0.3 * a)
      ctx.lineWidth = 5
      ctx.stroke()
      ctx.strokeStyle = rgba(mixWhite(p.color, 0.85), 0.95 * a)
      ctx.lineWidth = 1.8
      ctx.stroke()
      ctx.restore()
    },
  },
  lanterns: {
    rate: 1.8,
    max: 32,
    colors: ['amber', 'candlelight', 'sunset'],
    spawn: (w, h) => ({ x: rand(w * 0.05, w * 0.95), y: h + 24, vx: rand(-6, 6), vy: rand(-34, -18), size: rand(9, 16), rotation: 0, spin: 0, life: Infinity }),
    draw: (ctx, p, alpha) => {
      const sway = Math.sin(p.age * 0.8 + p.seed)
      const x = p.x + sway * 16
      const s = p.size
      const wickGlow = (0.88 + 0.12 * Math.sin(p.age * 3.6 + p.seed * 4)) * (1 + 0.28 * (beatBreath ?? 0))
      ctx.save()
      ctx.translate(x, p.y)
      ctx.rotate(Math.cos(p.age * 0.8 + p.seed) * 0.12)
      // 外层暖光晕
      ctx.fillStyle = rgba(p.color, Math.min(1, 0.15 * alpha * wickGlow))
      ctx.beginPath()
      ctx.arc(0, s * 0.15, s * 1.85, 0, TAU)
      ctx.fill()
      // 灯罩轮廓
      ctx.save()
      ctx.scale(s, s)
      ctx.fillStyle = rgba(p.color, 0.72 * alpha)
      const lanternPath = getUnitLanternPath()
      if (lanternPath) {
        ctx.fill(lanternPath)
      }
      else {
        ctx.beginPath()
        ctx.arc(0, 0, 0.65, 0, TAU)
        ctx.fill()
      }
      ctx.restore()
      // 底部灯口与明亮灯芯火苗
      ctx.strokeStyle = rgba(mixWhite(p.color, 0.45), 0.65 * alpha)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.ellipse(0, s * 0.72, s * 0.36, s * 0.1, 0, 0, TAU)
      ctx.stroke()
      ctx.fillStyle = rgba(mixWhite(p.color, 0.82), Math.min(1, 0.92 * alpha * wickGlow))
      ctx.beginPath()
      ctx.arc(0, s * 0.42, s * 0.28, 0, TAU)
      ctx.fill()
      ctx.restore()
    },
  },
  embers: {
    rate: 7,
    colors: ['flame', 'crimson', 'amber'],
    beat: 1,
    beatRatio: 0.5,
    spawn: (w, h) => ({ x: rand(-30, w), y: h + 14, vx: rand(12, 48), vy: rand(-78, -32) * clamp(beatTempoScale, 0.78, 1.32), size: rand(3, 6.5), rotation: rand(0, TAU), spin: rand(-3.5, 3.5), life: rand(3.5, 7) }),
    beatSpawn: (w, h) => ({ x: rand(-10, w), y: rand(h * 0.82, h + 10), vx: rand(16, 58), vy: rand(-105, -50) * clamp(beatTempoScale, 0.78, 1.32), size: rand(3.2, 7), rotation: rand(0, TAU), spin: rand(-4.5, 4.5), life: rand(2.8, 5.5) }),
    draw: (ctx, p, alpha) => {
      const x = p.x + Math.sin(p.age * 1.5 + p.seed) * 14
      const smolder = (0.35 + 0.65 * ((Math.sin(p.age * 4.5 + p.seed * 6) + 1) / 2)) * (1 + 0.35 * (beatBreath ?? 0))
      const a = Math.min(1, alpha * smolder)
      ctx.fillStyle = rgba(p.color, 0.14 * a)
      ctx.beginPath()
      ctx.arc(x, p.y, p.size * 2.2, 0, TAU)
      ctx.fill()
      ctx.save()
      ctx.translate(x, p.y)
      ctx.rotate(p.rotation)
      ctx.scale((0.25 + 0.75 * Math.abs(Math.cos(p.age * 3.2 + p.seed))) * p.size, p.size)
      ctx.fillStyle = rgba(mixWhite(p.color, 0.35 * Math.min(1, smolder)), 0.88 * a)
      const emberPath = getUnitEmberPath()
      if (emberPath) {
        ctx.fill(emberPath)
      }
      else {
        ctx.fillRect(-0.6, -0.6, 1.2, 1.2)
      }
      ctx.restore()
    },
  },
  sparkles: {
    rate: 5.5,
    colors: ['#ffffff', 'moonlight', 'lemon', 'lavender', 'cherry-blossom'],
    beat: 0,
    beatRatio: 0.8,
    spawn: (w, h) => ({ x: rand(w * 0.06, w * 0.94), y: rand(h * 0.08, h * 0.85), vx: 0, vy: rand(-10, -2) * beatTempoScale, size: rand(7, 15), rotation: rand(-0.25, 0.25), spin: rand(-0.6, 0.6) * beatTempoScale, life: rawBeatSec != null ? clamp(rawBeatSec * rand(1.15, 1.85), 0.48, 2.6) : rand(0.9, 1.7) }),
    draw: (ctx, p, alpha) => {
      const bloom = Math.sin(Math.PI * Math.min(1, p.age / p.life))
      const breath = beatBreath ?? 0
      const a = Math.min(1, alpha * bloom * (1 + 0.22 * breath))
      const s = p.size * (0.35 + 0.75 * bloom) * (1 + 0.14 * breath)
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rotation)
      ctx.strokeStyle = rgba(p.color, 0.45 * a)
      ctx.lineWidth = 1
      const diag = s * 0.42
      ctx.beginPath()
      ctx.moveTo(-diag, -diag)
      ctx.lineTo(diag, diag)
      ctx.moveTo(-diag, diag)
      ctx.lineTo(diag, -diag)
      ctx.stroke()
      ctx.scale(s, s)
      ctx.fillStyle = rgba(mixWhite(p.color, 0.55), 0.92 * a)
      const sparklePath = getUnitSparklePath()
      if (sparklePath) {
        ctx.fill(sparklePath)
      }
      else {
        ctx.beginPath()
        ctx.arc(0, 0, 0.35, 0, TAU)
        ctx.fill()
      }
      ctx.restore()
    },
  },
  beams: {
    rate: 1.6,
    max: 4,
    colors: ['rose', 'violet', 'aurora', 'sky', 'gold', 'cherry-blossom'],
    beat: 0,
    instant: true,
    // 演唱会双向摇头光束灯：顶部桁架向下俯射（~55%）与台唇地排灯向上仰射（~45%）交错汇聚，随真实单拍摆角扫掠并在落拍瞬间轻闪速散
    spawn: (w, h) => {
      const fromBottom = Math.random() < 0.45
      const slotCount = w < 380 ? 3 : 5
      const slot = Math.floor(Math.random() * slotCount)
      const slotRatio = slot / (slotCount - 1)
      const x = w * (0.14 + 0.72 * slotRatio) + rand(-w * 0.03, w * 0.03)
      const y = fromBottom ? h + 3 : -3
      const baseAngle = (0.5 - slotRatio) * (fromBottom ? 0.36 : 0.42)
      const size = Math.min(rand(w * 0.08, w * 0.14), rand(h * 0.2, h * 0.34))
      const len = h * rand(0.86, 1.14)
      const life = rawBeatSec != null ? clamp(rawBeatSec * rand(1.35, 2.0), 0.65, 2.1) : rand(0.95, 1.45)
      return { x, y, vx: 0, vy: 0, size, len, baseAngle, sweepAmp: rand(0.16, 0.32), sweepDir: Math.random() < 0.5 ? 1 : -1, rotation: 0, spin: 0, life }
    },
    draw: (ctx, p, alpha) => {
      const fromBottom = p.y > 0
      const swayOmega = rawBeatSec != null ? Math.PI / Math.max(0.24, rawBeatSec) : 2.4
      const angle = (p.baseAngle ?? 0) + (p.sweepDir ?? 1) * Math.sin(p.age * swayOmega + p.seed) * (p.sweepAmp ?? 0.26)
      const strobeTau = rawBeatSec != null ? Math.max(0.07, rawBeatSec * 0.24) : 0.15
      const strobe = Math.exp(-p.age / strobeTau)
      const env = Math.sin(Math.PI * Math.min(1, p.age / p.life))
      const beamAlpha = Math.min(1, alpha * (0.4 * env + 0.6 * strobe) * (1 + 0.28 * (beatBreath ?? 0)))
      if (beamAlpha <= 0.008)
        return
      const len = p.len ?? 240
      const topW = Math.max(1.8, p.size * 0.08)
      const botW = p.size

      ctx.save()
      ctx.translate(p.x, p.y)
      if (fromBottom)
        ctx.scale(1, -1)
      ctx.rotate(-angle)

      // 外层丁达尔雾感柔光锥（减淡不抢歌词）
      const outerGrad = ctx.createLinearGradient(0, 0, 0, len)
      outerGrad.addColorStop(0, rgba(mixWhite(p.color, 0.55), 0.25 * beamAlpha))
      outerGrad.addColorStop(0.38, rgba(p.color, 0.11 * beamAlpha))
      outerGrad.addColorStop(1, rgba(p.color, 0))
      ctx.fillStyle = outerGrad
      ctx.beginPath()
      ctx.moveTo(-topW, 0)
      ctx.lineTo(topW, 0)
      ctx.lineTo(botW, len)
      ctx.lineTo(-botW, len)
      ctx.closePath()
      ctx.fill()

      // 内层准直亮芯
      const coreLen = len * 0.88
      const coreGrad = ctx.createLinearGradient(0, 0, 0, coreLen)
      coreGrad.addColorStop(0, rgba(mixWhite(p.color, 0.85), 0.28 * beamAlpha))
      coreGrad.addColorStop(1, rgba(p.color, 0))
      ctx.fillStyle = coreGrad
      ctx.beginPath()
      ctx.moveTo(-topW * 0.45, 0)
      ctx.lineTo(topW * 0.45, 0)
      ctx.lineTo(botW * 0.32, coreLen)
      ctx.lineTo(-botW * 0.32, coreLen)
      ctx.closePath()
      ctx.fill()

      // 灯口点光源炫光
      const glowSize = clamp(len * 0.012, 1.4, 3.2)
      glowDot(ctx, 0, 2, glowSize, p.color, Math.min(0.72, beamAlpha * 0.68))
      ctx.restore()
    },
  },
}

// 自定义粒子：尺寸（px，再随机 ±20%）、透明度上限、同屏上限；图标库图标的线宽（原样 2 在粒子尺寸下偏细）
const SPRITE_SIZES = { s: 14, m: 20, l: 26 }
const SPRITE_MAX_ALPHA = 0.75
const SPRITE_MAX_COUNT = 40
const SPRITE_LINE_WIDTH = 2.5

/** 各动作预设：生成速率（1280×800 画面上每秒）、出生位置与速度、绘制时的附加位移或旋转（update 只做匀速运动） */
const SPRITE_MOTIONS: Record<LyricSpriteMotion, {
  rate: number
  beat?: number
  spawn: (w: number, h: number, spin: boolean) => Omit<Motion, 'size'>
  offset?: (p: Particle) => { x?: number, y?: number, rotation?: number }
}> = {
  // 从上方翻滚着落下，左右轻摆
  fall: { rate: 2.2, spawn: (w, _h, spin) => ({ x: rand(0, w), y: -20, vx: rand(-12, 12), vy: rand(38, 62), rotation: rand(0, TAU), spin: spin ? rand(-1.4, 1.4) : 0, life: Infinity }), offset: p => ({ x: Math.sin(p.age * 1.3 + p.seed) * 14 }) },
  // 从下方向上飘
  float: { rate: 2, spawn: (w, h, spin) => ({ x: rand(0, w), y: h + 20, vx: 0, vy: rand(-55, -30), rotation: rand(-0.3, 0.3), spin: spin ? rand(-0.4, 0.4) : 0, life: Infinity }), offset: p => ({ x: Math.sin(p.age * 1.1 + p.seed) * 16 }) },
  // 从左侧滑过，轻微起伏
  drift: { rate: 1.6, spawn: (_w, h, spin) => ({ x: -24, y: rand(h * 0.08, h * 0.75), vx: rand(45, 75), vy: rand(-6, 6), rotation: 0, spin: spin ? rand(-0.3, 0.3) : 0, life: Infinity }), offset: p => ({ y: Math.sin(p.age * 2 + p.seed) * 10 }) },
  // 在原地出现，像挥应援棒/挂饰一样左右摇摆（跟随节拍时一拍一摆），几秒后淡出
  sway: {
    rate: 1.2,
    spawn: (w, h) => ({ x: rand(w * 0.08, w * 0.92), y: rand(h * 0.1, h * 0.7), vx: 0, vy: 6, rotation: 0, spin: 0, life: rand(4, 6) }),
    offset: (p) => {
      if (beatSway == null)
        return { rotation: Math.sin(p.age * 2.2 + p.seed) * 0.35 }
      const amp = 0.36 * (0.85 + 0.3 * (p.seed % 1))
      return { rotation: beatSway * amp + Math.sin(p.age * 1.7 + p.seed) * 0.05 }
    },
  },
  // 边旋转边沿弧线落下
  swirl: { rate: 1.8, spawn: (w, _h, spin) => ({ x: rand(0, w), y: -20, vx: 0, vy: rand(30, 45), rotation: 0, spin: spin ? rand(1.5, 3) : 0, life: Infinity }), offset: p => ({ x: Math.sin(p.age * 1.6 + p.seed) * (18 + (p.seed % 1) * 22) }) },
  // 从画面中部踩拍向外爆发散开，减速后淡出（爆发寿命与初速随拍子周期自适应）
  burst: {
    rate: 2.5,
    beat: 1,
    spawn: (w, h, spin) => ({ x: w / 2 + rand(-w * 0.15, w * 0.15), y: h * 0.45 + rand(-h * 0.1, h * 0.1), vx: 0, vy: 0, rotation: rand(0, TAU), spin: spin ? rand(-3, 3) : 0, life: rawBeatSec != null ? clamp(2 * rawBeatSec * rand(1.25, 1.6), 0.9, 3.2) : rand(1.6, 2.2) }),
    offset: (p) => {
      const angle = p.seed / 10 * TAU
      const distance = (70 + (p.seed * 37) % 60) * (1 - Math.exp(-1.5 * beatTempoScale * p.age)) / 1.5
      return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance + 10 * p.age * p.age }
    },
  },
}

const spriteSpecs = new WeakMap<LyricSprite, SceneSpec>()

/** 自定义粒子的场景：路径编译为 Path2D 后缓存，按动作预设生成与绘制 */
function spriteSpec(sprite: LyricSprite): SceneSpec {
  const cached = spriteSpecs.get(sprite)
  if (cached)
    return cached
  const paths = sprite.paths.map(path => ({ paint: path.paint, path: new Path2D(path.d) }))
  const motion = SPRITE_MOTIONS[sprite.motion] ?? SPRITE_MOTIONS.fall
  const size = SPRITE_SIZES[sprite.size] ?? SPRITE_SIZES.m
  const spec: SceneSpec = {
    rate: motion.rate,
    beat: motion.beat,
    colors: [sprite.color],
    max: SPRITE_MAX_COUNT,
    spawn: (w, h) => ({ ...motion.spawn(w, h, !!sprite.spin), size: size * rand(0.8, 1.2) }),
    draw: (ctx, p, alpha) => {
      const offset = motion.offset?.(p) ?? {}
      const a = alpha * SPRITE_MAX_ALPHA
      ctx.save()
      ctx.translate(p.x + (offset.x ?? 0), p.y + (offset.y ?? 0))
      ctx.rotate(offset.rotation ?? p.rotation)
      // 路径画在 24×24 的画布上，缩放到粒子尺寸并以中心为原点
      ctx.scale(p.size / 24, p.size / 24)
      ctx.translate(-12, -12)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (const { paint, path } of paths) {
        if (paint === 'fill' || paint === 'light') {
          ctx.fillStyle = rgba(paint === 'light' ? mixWhite(p.color, 0.55) : p.color, a)
          ctx.fill(path)
        }
        else {
          ctx.strokeStyle = rgba(p.color, a)
          ctx.lineWidth = paint === 'line' ? SPRITE_LINE_WIDTH : 1.5
          ctx.stroke(path)
        }
      }
      ctx.restore()
    },
  }
  spriteSpecs.set(sprite, spec)
  return spec
}

/** 场景的生成与绘制规则：内置场景或自定义粒子 */
function specOf(scene: StageScene): SceneSpec | null {
  if (scene.sprite)
    return spriteSpec(scene.sprite)
  return SCENES[scene.name as LyricScene] ?? null
}

/** 解析颜色：色板名称或 #rrggbb */
function resolveColor(color: string): Rgb {
  return hexToRgb(color.startsWith('#') ? color : LYRIC_COLORS[color as LyricColor])
}

const sceneKey = (scene: StageScene | null) => (scene ? `${scene.name}:${scene.color ?? ''}` : '')

/** 小窗等小画面的精简：粒子尺寸缩放与数量上限（场景种类不变） */
export interface StageParticlesOptions {
  scale?: number
  maxParticles?: number
  // HDR 亮度倍数：大于 1 时画布用 float16、颜色乘以它（画布须由 lib/hdr-canvas.ts 拷到 HDR 输出上才会显示为 HDR）
  hdrGain?: number
  // 画布分辨率相对设备像素比的比例（HDR 的 float16 画布用 0.5 省显存，由 CSS 拉伸铺满）
  resolution?: number
}

export class StageParticles {
  private ctx: CanvasRenderingContext2D | null
  private scale: number
  private maxParticles: number
  private particles: Particle[] = []
  private density = 0
  private scene: StageScene | null = null
  // 累积的待生成数量（底流与拍点簇发分别累积余量）
  private pending = 0
  private beatPending = 0
  // 画布上是否画着东西：空着且没有粒子时不再逐帧清空（每次清空都要重新合成整块画布）
  private painted = false
  private width = 0
  private height = 0
  private hdrGain: number
  private resolution: number
  // 空闲释放：画布已缩成 0×0（见 RELEASE_IDLE_S），以及已空闲的时长
  private released = false
  private idleFor = 0

  constructor(private canvas: HTMLCanvasElement, { scale = 1, maxParticles = MAX_PARTICLES, hdrGain = 1, resolution = 1 }: StageParticlesOptions = {}) {
    // colorType 尚未进入 TypeScript 的 DOM 类型
    this.ctx = canvas.getContext('2d', hdrGain > 1 ? { colorType: 'float16' } as CanvasRenderingContext2DSettings : undefined)
    this.scale = scale
    this.maxParticles = maxParticles
    this.hdrGain = hdrGain
    this.resolution = resolution
  }

  /** 画面尺寸变化时调用（CSS 像素），按设备像素比（最多 2 倍）乘以 resolution 设置画布；释放期间只记下尺寸 */
  resize(width: number, height: number) {
    this.width = width
    this.height = height
    if (!this.released)
      this.applySize()
  }

  private applySize() {
    const ratio = Math.min(2, window.devicePixelRatio || 1) * this.resolution
    this.canvas.width = Math.round(this.width * ratio)
    this.canvas.height = Math.round(this.height * ratio)
    this.ctx?.setTransform(ratio, 0, 0, ratio, 0, 0)
  }

  /** 画布是否已因空闲释放（HDR 输出据此一并释放、恢复） */
  get suspended() {
    return this.released
  }

  /** 是否还有需要绘制的内容（没有时可停止逐帧循环） */
  get idle() {
    return this.particles.length === 0 && this.density === 0
  }

  /**
   * 推进 dt 秒并绘制；scene 为当前场景与颜色主题（null 为无），active 为 false 时（暂停）不再生成；rhythm 为跟随节拍时的输入。
   * 返回这一帧是否重画了画布（HDR 输出据此决定是否拷贝）
   */
  update(dt: number, scene: StageScene | null, active: boolean, rhythm: StageParticleRhythm | null = null): boolean {
    const ctx = this.ctx
    if (!ctx)
      return false
    // 空闲释放后，有场景要演出时恢复画布
    if (this.released) {
      if (!active || !scene)
        return false
      this.released = false
      this.idleFor = 0
      this.applySize()
    }
    heartBeat = rhythm?.heart ?? null
    beatBreath = rhythm?.breath ?? null
    beatSway = rhythm?.sway ?? null
    beatTempoScale = rhythm?.tempoScale ?? 1
    rawBeatSec = rhythm?.rawPeriodMs != null ? clamp(rhythm.rawPeriodMs / 1000, 0.24, 1.25) : null
    colorGain = this.hdrGain
    const key = sceneKey(scene)
    // 换到新场景（或颜色主题）时立即切入并从柔和初密度起爬升，旧粒子各自沿 LEAVE_SECONDS 自然淡出（交叉淡入淡出，消除 1.2s 空档）；
    // 场景结束为 null 时维持 this.scene 直到 density 渐出归零后再清空
    if (key !== sceneKey(this.scene)) {
      if (scene != null) {
        this.scene = scene
        this.pending = 0
        this.beatPending = 0
        this.density = Math.min(this.density, 0.18)
      }
      else if (this.density === 0) {
        this.scene = null
      }
    }
    const current = this.scene
    const currentKey = sceneKey(current)
    const target = active && current != null && key === currentKey ? 1 : 0
    this.density = target > this.density
      ? Math.min(target, this.density + DENSITY_IN * dt)
      : Math.max(target, this.density - DENSITY_OUT * dt)

    const spec = current ? specOf(current) : null
    if (current && spec && this.density > 0) {
      const area = Math.min(2, Math.max(0.3, (this.width * this.height) / BASE_AREA))
      const spawn = (onBeat: boolean) => {
        if (spec.max != null) {
          let sameCount = 0
          let evictSameIdx = -1
          for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i]
            if (p.spec !== spec)
              continue
            sameCount++
            if (evictSameIdx < 0) {
              evictSameIdx = i
            }
            else {
              const best = this.particles[evictSameIdx]
              if ((p.leave > 0) !== (best.leave > 0) ? p.leave > 0 : p.age > best.age)
                evictSameIdx = i
            }
          }
          if (sameCount >= spec.max) {
            if (!onBeat || evictSameIdx < 0)
              return
            this.particles.splice(evictSameIdx, 1)
          }
        }
        if (this.particles.length >= this.maxParticles) {
          if (!onBeat || this.maxParticles <= 0)
            return
          // 拍点粒子绝不因小岛名额满而漏拍：优先淘汰正在离场的旧场景粒子、其次非拍点环境粒子、最后最老粒子
          let evictIdx = 0
          const rank = (p: Particle) => (p.key !== currentKey || p.leave > 0 ? 2 : !p.onBeat ? 1 : 0)
          for (let i = 1; i < this.particles.length; i++) {
            const p = this.particles[i]
            const best = this.particles[evictIdx]
            const rp = rank(p)
            const rb = rank(best)
            if (rp > rb || (rp === rb && p.age > best.age))
              evictIdx = i
          }
          this.particles.splice(evictIdx, 1)
        }
        // 指定颜色主题时略微随机提亮，避免整片同色
        const color = current.color ? mixWhite(resolveColor(current.color), rand(0, 0.25)) : resolveColor(pick(spec.colors))
        const motion = (onBeat && spec.beatSpawn ? spec.beatSpawn : spec.spawn)(this.width, this.height)
        this.particles.push({ ...motion, size: motion.size * this.scale, spec, key: currentKey, color, age: 0, seed: Math.random() * 10, leave: 0, onBeat })
      }
      // 快歌（如 >125 BPM）的歌词基准周期 basePeriodMs 被八度折叠了 2 倍；抵消 foldShift 后使粒子严格对齐真实单拍/双拍/小节
      const foldShift = rhythm?.rawPeriodMs && rhythm?.basePeriodMs
        ? Math.max(0, Math.round(Math.log2(rhythm.basePeriodMs / rhythm.rawPeriodMs)))
        : 0
      const beat = spec.beat != null && active ? rhythm?.pulses(spec.beat - foldShift) ?? null : null
      if (beat) {
        const ratio = spec.beatRatio ?? 1
        if (ratio < 1) {
          this.pending += spec.rate * (1 - ratio) * area * this.density * dt
          while (this.pending >= 1) {
            this.pending--
            spawn(false)
          }
        }
        // 节奏相关粒子绝不漏拍：每到一个拍点保底至少触发 1 个，小画幅仅缩减单拍同时簇发的个数；无节奏场景走下方连续分支自然稀疏
        for (const pulse of beat.pulses) {
          this.beatPending += spec.rate * ratio * (beat.periodMs / 1000) * area * this.density * pulse.a
          const count = Math.max(1, Math.floor(this.beatPending))
          this.beatPending = Math.max(0, this.beatPending - count)
          for (let i = 0; i < count; i++)
            spawn(true)
        }
      }
      else {
        this.pending += spec.rate * area * this.density * dt
        while (this.pending >= 1) {
          this.pending--
          spawn(false)
        }
      }
    }
    else {
      this.pending = 0
      this.beatPending = 0
    }

    if (this.particles.length === 0 && !this.painted) {
      // 没有场景、画面已清空：空闲够久就释放画布（缩成 0×0 即释放显存）
      this.idleFor = this.density === 0 ? this.idleFor + dt : 0
      if (this.idleFor >= RELEASE_IDLE_S) {
        this.released = true
        this.canvas.width = 0
        this.canvas.height = 0
      }
      return false
    }
    this.idleFor = 0
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
      // 刚生成时淡入（瞬态闪电立即点亮），有寿命的在收尾阶段平滑淡出（短寿命粒子按比例压缩淡入淡出窗避免峰值被压低）
      const inDur = p.spec.instant ? 0.02 : Math.min(p.onBeat ? 0.25 : 0.6, p.life * 0.25)
      const outDur = Math.min(1, p.life * 0.4)
      const alpha = Math.min(1, p.age / inDur, Number.isFinite(p.life) ? (p.life - p.age) / outDur : 1) * (1 - p.leave)
      p.spec.draw(ctx, p, alpha)
      return true
    })
    this.painted = this.particles.length > 0
    return true
  }

  clear() {
    this.particles = []
    this.scene = null
    this.density = 0
    this.pending = 0
    this.beatPending = 0
    this.painted = false
    this.ctx?.clearRect(0, 0, this.width, this.height)
  }
}
