/**
 * 消散特效的颗粒层（见 word-effects.ts）：叠在歌词之上的 canvas，第一次有字消散时才创建。
 * 字开始消散时，从字所在的位置生成细沙般的颗粒，被风吹向右上方并淡出；颗粒按自己的时间飘散，不跟随歌词行滚动
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

// 每个字的颗粒数（按字号缩放的基准，字号 26px 时）、颗粒寿命、上限
const GRAINS_PER_CHAR = 40
const GRAIN_LIFE_S = [1.6, 2.2] as const
const MAX_GRAINS = 1200

export class DissolveGrains {
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private grains: Grain[] = []
  private width = 0
  private height = 0
  private dpr = 1
  // 上一帧画过颗粒：颗粒都消失后还要再清一次画布
  private drawn = false

  constructor(private readonly container: HTMLElement) {}

  get active() {
    return this.grains.length > 0
  }

  /** 从一个字生成颗粒（颜色取字当前的文字颜色） */
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

  /** 推进并绘制一帧；返回是否还有颗粒 */
  step(dt: number): boolean {
    const ctx = this.ctx
    if (!ctx || (this.grains.length === 0 && !this.drawn))
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
    return this.grains.length > 0
  }

  clear() {
    this.grains = []
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

  private ensureCanvas(width: number, height: number) {
    if (width <= 0 || height <= 0)
      return false
    if (!this.canvas) {
      this.canvas = this.container.ownerDocument.createElement('canvas')
      this.canvas.className = 'lyric-grains'
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
