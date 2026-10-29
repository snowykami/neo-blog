/**
 * 消散与破碎特效的碎屑层（时间曲线见 word-effects.ts）：叠在歌词之上的 canvas，第一次有字消散或破碎时才创建。
 * - 消散（grains）：字开始消散时，从字所在的位置生成细沙般的颗粒，被风吹向右上方并淡出
 * - 破碎（shards）：字碎的一瞬间，以字内一个裂点为中心切成几块三角形碎片，每块带着原来的字形，
 *   从裂点向外迸开、旋转、受重力坠落并淡出
 * 颗粒与碎片按自己的时间运动，不跟随歌词行滚动
 */

interface Grain {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  phase: number
  age: number
  life: number
  color: string
}

interface Shard {
  // 字形位图（同一个字的碎片共用）与它在容器中的左上角
  glyph: HTMLCanvasElement
  left: number
  top: number
  // 三角形顶点（相对字形左上角）与重心
  points: [number, number][]
  cx: number
  cy: number
  vx: number
  vy: number
  spin: number
  age: number
  life: number
}

// 每个字的颗粒数（按字号缩放的基准，字号 26px 时）、颗粒寿命、上限
const GRAINS_PER_CHAR = 40
const GRAIN_LIFE_S = [1.6, 2.2] as const
const MAX_GRAINS = 1200
// 每个字的碎片数、迸开速度（px/s）、碎之初向上弹起的速度、重力（px/s²）、寿命、上限
const SHARDS_PER_CHAR = [6, 8] as const
const SHARD_SPEED = [90, 220] as const
const SHARD_POP = 70
const SHARD_GRAVITY = 900
const SHARD_LIFE_S = [0.9, 1.3] as const
const MAX_SHARDS = 240

export class LyricDebris {
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private grains: Grain[] = []
  private shards: Shard[] = []
  private width = 0
  private height = 0
  private dpr = 1
  // 上一帧画过东西：都消失后还要再清一次画布
  private drawn = false

  constructor(private readonly container: HTMLElement) {}

  get active() {
    return this.grains.length > 0 || this.shards.length > 0
  }

  /** 消散：从一个字生成颗粒（颜色取字当前的文字颜色） */
  spawn(charEl: HTMLElement) {
    const box = this.container.getBoundingClientRect()
    const rect = charEl.getBoundingClientRect()
    if (rect.width <= 0 || !this.ensureCanvas(box.width, box.height))
      return
    const color = getComputedStyle(charEl).color
    const count = Math.round(GRAINS_PER_CHAR * Math.min(2, rect.height / 26))
    for (let k = 0; k < count && this.grains.length < MAX_GRAINS; k++) {
      this.grains.push({
        x: rect.left - box.left + Math.random() * rect.width,
        y: rect.top - box.top + rect.height * (0.2 + Math.random() * 0.65),
        vx: 30 + Math.random() * 80,
        vy: -8 - Math.random() * 30,
        size: 0.6 + Math.random() * 1.4,
        phase: Math.random() * Math.PI * 2,
        // 同一个字的颗粒先后被吹起，不是同时
        age: -Math.random() * 0.4,
        life: GRAIN_LIFE_S[0] + Math.random() * (GRAIN_LIFE_S[1] - GRAIN_LIFE_S[0]),
        color,
      })
    }
  }

  /**
   * 破碎：把一个字切成碎片。push 为整个词的迸开方向（-1 ~ 1，词左侧的字向左、右侧的向右），
   * 字形按字当前的字体、颜色与缩放画到位图上
   */
  shatter(charEl: HTMLElement, push: number) {
    const box = this.container.getBoundingClientRect()
    const rect = charEl.getBoundingClientRect()
    const text = charEl.textContent ?? ''
    if (rect.width <= 0 || !text.trim() || !this.ensureCanvas(box.width, box.height))
      return
    const glyph = this.renderGlyph(charEl, text, rect)
    if (!glyph)
      return
    const { width: w, height: h } = rect
    // 裂点在字的中部附近，碎片是裂点与边框上相邻两点组成的三角形
    const crackX = w * (0.35 + Math.random() * 0.3)
    const crackY = h * (0.35 + Math.random() * 0.3)
    const count = SHARDS_PER_CHAR[0] + Math.floor(Math.random() * (SHARDS_PER_CHAR[1] - SHARDS_PER_CHAR[0] + 1))
    const edge = Array.from({ length: count }, (_, k) => (k + 0.2 + Math.random() * 0.6) / count * Math.PI * 2)
      .map(angle => rayToRect(crackX, crackY, angle, w, h))
    for (let k = 0; k < count && this.shards.length < MAX_SHARDS; k++) {
      const a = edge[k]
      const b = edge[(k + 1) % count]
      const cx = (crackX + a[0] + b[0]) / 3
      const cy = (crackY + a[1] + b[1]) / 3
      const dx = cx - crackX
      const dy = cy - crackY
      const len = Math.hypot(dx, dy) || 1
      const speed = SHARD_SPEED[0] + Math.random() * (SHARD_SPEED[1] - SHARD_SPEED[0])
      this.shards.push({
        glyph,
        left: rect.left - box.left,
        top: rect.top - box.top,
        points: [[crackX, crackY], a, b],
        cx,
        cy,
        vx: dx / len * speed + push * 80,
        vy: dy / len * speed - SHARD_POP,
        spin: (Math.random() - 0.5) * 10,
        age: 0,
        life: SHARD_LIFE_S[0] + Math.random() * (SHARD_LIFE_S[1] - SHARD_LIFE_S[0]),
      })
    }
  }

  /** 推进并绘制一帧；返回是否还有颗粒或碎片 */
  step(dt: number): boolean {
    const ctx = this.ctx
    if (!ctx || (!this.active && !this.drawn))
      return false
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.width, this.height)
    this.drawn = false
    this.grains = this.grains.filter((grain) => {
      grain.age += dt
      if (grain.age >= grain.life)
        return false
      if (grain.age < 0)
        return true
      const t = grain.age
      ctx.globalAlpha = Math.max(0, 1 - t / grain.life) * 0.9
      ctx.fillStyle = grain.color
      ctx.fillRect(grain.x + grain.vx * t + 8 * Math.sin(t * 3 + grain.phase), grain.y + grain.vy * t - 12 * t * t, grain.size, grain.size)
      this.drawn = true
      return true
    })
    this.shards = this.shards.filter((shard) => {
      shard.age += dt
      if (shard.age >= shard.life)
        return false
      const t = shard.age
      // 后半段淡出
      ctx.globalAlpha = Math.min(1, 2 * (1 - t / shard.life))
      ctx.save()
      ctx.translate(shard.left + shard.cx + shard.vx * t, shard.top + shard.cy + shard.vy * t + SHARD_GRAVITY * t * t / 2)
      ctx.rotate(shard.spin * t)
      ctx.translate(-shard.cx, -shard.cy)
      ctx.beginPath()
      ctx.moveTo(...shard.points[0])
      ctx.lineTo(...shard.points[1])
      ctx.lineTo(...shard.points[2])
      ctx.closePath()
      ctx.clip()
      ctx.drawImage(shard.glyph, 0, 0, shard.glyph.width / this.dpr, shard.glyph.height / this.dpr)
      ctx.restore()
      this.drawn = true
      return true
    })
    ctx.globalAlpha = 1
    return this.active
  }

  clear() {
    this.grains = []
    this.shards = []
    if (this.ctx && this.canvas)
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.drawn = false
  }

  dispose() {
    this.clear()
    this.canvas?.remove()
    this.canvas = null
    this.ctx = null
  }

  /** 把字按当前的字体、颜色与缩放画到位图上（居中），尺寸与字的外框一致 */
  private renderGlyph(charEl: HTMLElement, text: string, rect: DOMRect): HTMLCanvasElement | null {
    const glyph = this.container.ownerDocument.createElement('canvas')
    glyph.width = Math.ceil(rect.width * this.dpr)
    glyph.height = Math.ceil(rect.height * this.dpr)
    const g = glyph.getContext('2d')
    if (!g)
      return null
    const style = getComputedStyle(charEl)
    // 外框含字当前的缩放（如放大强调），字号按同样的比例放大
    const scale = charEl.offsetHeight > 0 ? rect.height / charEl.offsetHeight : 1
    g.scale(this.dpr, this.dpr)
    g.font = `${style.fontStyle} ${style.fontWeight} ${Number.parseFloat(style.fontSize) * scale}px ${style.fontFamily}`
    g.fillStyle = style.color
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(text, rect.width / 2, rect.height / 2)
    return glyph
  }

  private ensureCanvas(width: number, height: number) {
    if (width <= 0 || height <= 0)
      return false
    if (!this.canvas) {
      this.canvas = this.container.ownerDocument.createElement('canvas')
      this.canvas.className = 'lyric-debris'
      this.canvas.setAttribute('aria-hidden', 'true')
      this.container.append(this.canvas)
      this.ctx = this.canvas.getContext('2d')
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (width !== this.width || height !== this.height || dpr !== this.dpr) {
      this.width = width
      this.height = height
      this.dpr = dpr
      this.canvas.width = Math.round(width * dpr)
      this.canvas.height = Math.round(height * dpr)
    }
    return this.ctx != null
  }
}

/** 从 (x, y) 沿 angle 方向的射线与 [0, w] × [0, h] 边框的交点 */
export function rayToRect(x: number, y: number, angle: number, w: number, h: number): [number, number] {
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const tx = dx > 0 ? (w - x) / dx : dx < 0 ? -x / dx : Number.POSITIVE_INFINITY
  const ty = dy > 0 ? (h - y) / dy : dy < 0 ? -y / dy : Number.POSITIVE_INFINITY
  const t = Math.min(tx, ty)
  return [x + dx * t, y + dy * t]
}
