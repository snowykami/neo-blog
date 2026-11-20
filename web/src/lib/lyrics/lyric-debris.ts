import type { HdrCanvasPresenter } from '@/lib/hdr-canvas'
import { createHdrCanvasPresenter, prewarmHdrDevice } from '@/lib/hdr-canvas'
import { hdrCanvasColor, parseCssColor } from '@/lib/hdr-color'

/**
 * 消散与破碎特效的碎屑层（时间曲线见 word-effects.ts）：叠在歌词之上的 canvas，有字消散或破碎时才创建，碎屑全部消失一会儿后释放。
 * - 消散（grains）：字开始消散时，从字所在的位置生成细沙般的颗粒，被风吹向右上方并淡出
 * - 破碎（shards）：字碎的一瞬间，以字内一个裂点为中心切成几块三角形碎片，每块带着原来的字形，
 *   从裂点向外迸开、旋转、受重力坠落并淡出
 * 颗粒与碎片按自己的时间运动，不跟随歌词行滚动。
 * HDR 高光（setHdr）：碎屑画在不显示的 float16 画布上，经 WebGPU 输出（见 lib/hdr-canvas.ts）；刚出现时亮过 SDR 白，随时间熄灭到 SDR 白再淡出。
 * 浏览器不支持时退回普通 2D canvas
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
  rgb: Rgb
}

type Rgb = readonly [number, number, number]

interface Shard {
  // 出生时一次性预裁切好的单字三角碎片图集（同一个字的碎片共用，消除运行期多档 Canvas 创建与每帧三角形 clip 开销）
  atlas: HTMLCanvasElement
  sx: number
  sw: number
  sh: number
  w: number
  h: number
  left: number
  top: number
  // 三角形重心（相对字形左上角）
  cx: number
  cy: number
  vx: number
  vy: number
  spin: number
  age: number
  life: number
}

// 每个字的颗粒数（按字号缩放的基准，字号 26px 时）、颗粒寿命、上限
const GRAINS_PER_CHAR = 18
const GRAIN_LIFE_S = [0.85, 1.25] as const
const MAX_GRAINS = 500
// 每个字的碎片数、迸开速度（px/s）、碎之初向上弹起的速度、重力（px/s²）、寿命、上限
const SHARDS_PER_CHAR = [3, 4] as const
const SHARD_SPEED = [95, 215] as const
const SHARD_POP = 68
const SHARD_GRAVITY = 940
const SHARD_LIFE_S = [0.5, 0.75] as const
const MAX_SHARDS = 100
// 碎屑全部消失后过这么久释放画布（HDR 下连同 WebGPU 输出），平时不占显存
const RELEASE_DELAY_MS = 1500
const WHITE: Rgb = [255, 255, 255]

export interface DebrisMeasured {
  box: DOMRect
  rect: DOMRect
  offsetHeight: number
  fontStyle: string
  fontWeight: string
  fontSize: string
  fontFamily: string
  colorStr: string
}

/** 字的颜色：流光、HDR 高光下字本身透明（颜色由背景绘制），改取歌词色 */
function glyphColor(charEl: HTMLElement, style: CSSStyleDeclaration) {
  if (style.color !== 'rgba(0, 0, 0, 0)')
    return style.color
  return getComputedStyle(charEl).getPropertyValue('--lyric-color').trim() || '#fff'
}

export class LyricDebris {
  // 页面上的 canvas；HDR 时另有不显示的 float16 绘制画布（drawCanvas），由 presenter 逐帧拷到页面上
  private canvas: HTMLCanvasElement | null = null
  private drawCanvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private presenter: HdrCanvasPresenter | null = null
  private abort: AbortController | null = null
  private releaseTimer: ReturnType<typeof setTimeout> | null = null
  // HDR 亮度倍数（1 为关闭）；hdrFailed：浏览器不支持或设备丢失，本实例退回 2D
  private hdrGain = 1
  private hdrFailed = false
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

  private get hdr() {
    return this.hdrGain > 1 && !this.hdrFailed
  }

  /** HDR 高光的亮度倍数（不大于 1 为关闭）；切换时释放画布，下次有碎屑时按新的方式创建 */
  setHdr(gain: number) {
    if (gain === this.hdrGain)
      return
    this.hdrGain = gain
    if (gain > 1)
      prewarmHdrDevice()
    this.release()
  }

  /** 熄灭曲线：刚出现时为 hdrGain，寿命结束时降到 1（SDR 白），先快后慢 */
  private gainAt(age: number, life: number) {
    if (!this.hdr)
      return 1
    const k = Math.max(0, 1 - age / life)
    return 1 + (this.hdrGain - 1) * k * k
  }

  /** 消散：从一个字生成颗粒（颜色取字当前的文字颜色；传入预测量快照可避免绘制循环读写交错） */
  spawn(charEl: HTMLElement, measured?: DebrisMeasured) {
    const box = measured?.box ?? this.container.getBoundingClientRect()
    const rect = measured?.rect ?? charEl.getBoundingClientRect()
    if (rect.width <= 0 || !this.ensureCanvas(box.width, box.height))
      return
    const colorStr = measured?.colorStr ?? glyphColor(charEl, getComputedStyle(charEl))
    const rgb = parseCssColor(colorStr) ?? WHITE
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
        age: -Math.random() * 0.18,
        life: GRAIN_LIFE_S[0] + Math.random() * (GRAIN_LIFE_S[1] - GRAIN_LIFE_S[0]),
        rgb,
      })
    }
  }

  /**
   * 破碎：把一个字切成碎片。push 为整个词的迸开方向（-1 ~ 1，词左侧的字向左、右侧的向右），
   * 在碎的一瞬间把各块三角切片一次性烘焙到一张紧凑小图集上，运动帧内仅做轻量旋转贴图
   */
  shatter(charEl: HTMLElement, push: number, measured?: DebrisMeasured) {
    const box = measured?.box ?? this.container.getBoundingClientRect()
    const rect = measured?.rect ?? charEl.getBoundingClientRect()
    const text = charEl.textContent ?? ''
    if (rect.width <= 0 || !text.trim() || !this.ensureCanvas(box.width, box.height))
      return
    const { width: w, height: h } = rect
    // 裂点在字的中部附近，碎片是裂点与边框上相邻两点组成的三角形
    const crackX = w * (0.35 + Math.random() * 0.3)
    const crackY = h * (0.35 + Math.random() * 0.3)
    const totalCount = SHARDS_PER_CHAR[0] + Math.floor(Math.random() * (SHARDS_PER_CHAR[1] - SHARDS_PER_CHAR[0] + 1))
    const available = MAX_SHARDS - this.shards.length
    if (available <= 0)
      return
    const spawnCount = Math.min(totalCount, available)
    const edge = Array.from({ length: totalCount }, (_, k) => (k + 0.2 + Math.random() * 0.6) / totalCount * Math.PI * 2)
      .map(angle => rayToRect(crackX, crackY, angle, w, h))
    const triangles: [[number, number], [number, number], [number, number]][] = []
    for (let k = 0; k < spawnCount; k++)
      triangles.push([[crackX, crackY], edge[k], edge[(k + 1) % totalCount]])
    const baked = this.renderShardAtlas(charEl, text, rect, triangles, measured)
    if (!baked)
      return
    const drawW = baked.tileW / this.dpr
    const drawH = baked.tileH / this.dpr
    for (let k = 0; k < spawnCount; k++) {
      const [, a, b] = triangles[k]
      const cx = (crackX + a[0] + b[0]) / 3
      const cy = (crackY + a[1] + b[1]) / 3
      const dx = cx - crackX
      const dy = cy - crackY
      const len = Math.hypot(dx, dy) || 1
      const speed = SHARD_SPEED[0] + Math.random() * (SHARD_SPEED[1] - SHARD_SPEED[0])
      this.shards.push({
        atlas: baked.canvas,
        sx: k * baked.stride,
        sw: baked.tileW,
        sh: baked.tileH,
        w: drawW,
        h: drawH,
        left: rect.left - box.left,
        top: rect.top - box.top,
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
    const drawCanvas = this.drawCanvas
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
      ctx.fillStyle = hdrCanvasColor(grain.rgb, this.gainAt(t, grain.life))
      ctx.fillRect(grain.x + grain.vx * t + 8 * Math.sin(t * 3 + grain.phase), grain.y + grain.vy * t - 12 * t * t, grain.size, grain.size)
      this.drawn = true
      return true
    })
    this.shards = this.shards.filter((shard) => {
      shard.age += dt
      if (shard.age >= shard.life)
        return false
      const t = shard.age
      const p = t / shard.life
      // 平滑加速淡出（预乘 float16 下 HDR 亮度与不透明度同步自然衰减）
      ctx.globalAlpha = Math.max(0, 1 - p * p)
      ctx.save()
      ctx.translate(shard.left + shard.cx + shard.vx * t, shard.top + shard.cy + shard.vy * t + SHARD_GRAVITY * t * t / 2)
      ctx.rotate(shard.spin * t)
      ctx.drawImage(shard.atlas, shard.sx, 0, shard.sw, shard.sh, -shard.cx, -shard.cy, shard.w, shard.h)
      ctx.restore()
      this.drawn = true
      return true
    })
    ctx.globalAlpha = 1
    if (drawCanvas)
      this.presenter?.present(drawCanvas)
    if (!this.active)
      this.scheduleRelease()
    return this.active
  }

  clear() {
    this.grains = []
    this.shards = []
    if (this.ctx && this.drawCanvas) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0)
      this.ctx.clearRect(0, 0, this.drawCanvas.width, this.drawCanvas.height)
      this.presenter?.present(this.drawCanvas)
    }
    this.drawn = false
    this.scheduleRelease()
  }

  dispose() {
    this.release()
  }

  /** 释放画布（HDR 下连同 WebGPU 输出）与所有碎屑；下次有碎屑时重新创建 */
  private release() {
    if (this.releaseTimer != null)
      clearTimeout(this.releaseTimer)
    this.releaseTimer = null
    this.abort?.abort()
    this.abort = null
    this.presenter?.dispose()
    this.presenter = null
    this.canvas?.remove()
    this.canvas = null
    this.drawCanvas = null
    this.ctx = null
    this.grains = []
    this.shards = []
    this.drawn = false
    this.width = 0
    this.height = 0
  }

  private scheduleRelease() {
    if (this.releaseTimer != null || !this.canvas)
      return
    this.releaseTimer = setTimeout(() => {
      this.releaseTimer = null
      if (!this.active)
        this.release()
    }, RELEASE_DELAY_MS)
  }

  /** HDR 输出不可用：页面上的 canvas 还没取过上下文时直接改用 2D（碎屑保留），已是 WebGPU 时整个释放，下次以 2D 重新创建 */
  private fallback() {
    this.hdrFailed = true
    if (this.presenter || !this.canvas) {
      this.release()
      return
    }
    this.abort = null
    this.drawCanvas = this.canvas
    this.ctx = this.canvas.getContext('2d')
    this.canvas.width = Math.round(this.width * this.dpr)
    this.canvas.height = Math.round(this.height * this.dpr)
  }

  /**
   * 在碎的一瞬间把单字各块三角切片一次性画进同一张紧凑横向图集（贴片间留 2px 透明缝防旋转采样串边），
   * 彻底省掉运动帧内的多档 float16 Canvas 动态创建与逐碎片三角形 clip 蒙版开销
   */
  private renderShardAtlas(
    charEl: HTMLElement,
    text: string,
    rect: DOMRect,
    triangles: [[number, number], [number, number], [number, number]][],
    measured?: DebrisMeasured,
  ): { canvas: HTMLCanvasElement, tileW: number, tileH: number, stride: number } | null {
    const doc = this.container.ownerDocument
    let fontStyle: string
    let fontWeight: string
    let fontSize: string
    let fontFamily: string
    let offsetHeight: number
    let colorStr: string
    if (measured) {
      ({ offsetHeight, fontStyle, fontWeight, fontSize, fontFamily, colorStr } = measured)
    }
    else {
      const style = getComputedStyle(charEl)
      fontStyle = style.fontStyle
      fontWeight = style.fontWeight
      fontSize = style.fontSize
      fontFamily = style.fontFamily
      offsetHeight = charEl.offsetHeight
      colorStr = glyphColor(charEl, style)
    }
    // 外框含字当前的缩放（如放大强调），字号按同样的比例放大
    const scale = offsetHeight > 0 ? rect.height / offsetHeight : 1
    const font = `${fontStyle} ${fontWeight} ${Number.parseFloat(fontSize) * scale}px ${fontFamily}`
    const rgb = parseCssColor(colorStr) ?? WHITE
    const dpr = this.dpr
    const hdrGain = this.hdr ? this.hdrGain : 1
    const tileW = Math.max(1, Math.ceil(rect.width * dpr))
    const tileH = Math.max(1, Math.ceil(rect.height * dpr))
    const stride = tileW + 2
    const atlas = doc.createElement('canvas')
    atlas.width = stride * triangles.length
    atlas.height = tileH
    // colorType 尚未进入 TypeScript 的 DOM 类型
    const g = atlas.getContext('2d', hdrGain > 1 ? { colorType: 'float16' } as CanvasRenderingContext2DSettings : undefined)
    if (!g)
      return null
    g.font = font
    g.fillStyle = hdrCanvasColor(rgb, hdrGain)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    triangles.forEach((pts, idx) => {
      g.save()
      g.translate(idx * stride, 0)
      g.scale(dpr, dpr)
      g.beginPath()
      g.moveTo(...pts[0])
      g.lineTo(...pts[1])
      g.lineTo(...pts[2])
      g.closePath()
      g.clip()
      g.fillText(text, rect.width / 2, rect.height / 2)
      g.restore()
    })
    return { canvas: atlas, tileW, tileH, stride }
  }

  private ensureCanvas(width: number, height: number) {
    if (width <= 0 || height <= 0)
      return false
    if (this.releaseTimer != null) {
      clearTimeout(this.releaseTimer)
      this.releaseTimer = null
    }
    if (!this.canvas) {
      const canvas = this.container.ownerDocument.createElement('canvas')
      canvas.className = 'lyric-debris'
      canvas.setAttribute('aria-hidden', 'true')
      this.container.append(canvas)
      this.canvas = canvas
      if (this.hdr) {
        // 画在不显示的 float16 画布上；共用的 GPU 设备提前建好时（setHdr 里预热），输出在下一帧之前就绪
        const drawCanvas = this.container.ownerDocument.createElement('canvas')
        this.drawCanvas = drawCanvas
        // colorType 尚未进入 TypeScript 的 DOM 类型
        this.ctx = drawCanvas.getContext('2d', { colorType: 'float16' } as CanvasRenderingContext2DSettings)
        const abort = new AbortController()
        this.abort = abort
        void createHdrCanvasPresenter(canvas, () => this.fallback(), abort.signal).then((presenter) => {
          if (abort.signal.aborted)
            return
          if (!presenter) {
            this.fallback()
            return
          }
          this.presenter = presenter
          presenter.resize(drawCanvas.width, drawCanvas.height)
        })
      }
      else {
        this.drawCanvas = canvas
        this.ctx = canvas.getContext('2d')
      }
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (width !== this.width || height !== this.height || dpr !== this.dpr) {
      this.width = width
      this.height = height
      this.dpr = dpr
      if (this.drawCanvas) {
        this.drawCanvas.width = Math.round(width * dpr)
        this.drawCanvas.height = Math.round(height * dpr)
        this.presenter?.resize(this.drawCanvas.width, this.drawCanvas.height)
      }
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
