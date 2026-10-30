import type { TimelineItem, TimelineState } from './timeline'
import type { LyricEmphasis, LyricWord, ResolvedLyrics } from './types'
import { LYRIC_COLORS, MOOD_GLOW } from './colors'
import {
  LYRIC_ALIGN_POSITION,
  LYRIC_BLUR_MAX_PX,
  LYRIC_BLUR_NARROW_FACTOR,
  LYRIC_FEATHER_EM,
  LYRIC_FOOTER_ALPHA,
  LYRIC_FOOTER_FOCUSED_ALPHA,
  LYRIC_INACTIVE_ALPHA,
  LYRIC_INACTIVE_ALPHA_LINE_TIMED,
  LYRIC_INACTIVE_SCALE,
  LYRIC_INERTIA_DECAY_PER_S,
  LYRIC_MAX_FRAME_S,
  LYRIC_OVERSCAN_PX,
  LYRIC_POSITION_SPRING,
  LYRIC_SCALE_SPRING,
  LYRIC_SEEK_THRESHOLD_MS,
  LYRIC_STAGGER_BASE_S,
  LYRIC_STAGGER_DECAY,
  LYRIC_USER_SCROLL_HOLD_MS,
  LYRIC_WORD_FLOAT_EM,
} from './config'
import { swellCurve } from './easing'
import { interludeDot } from './interlude'
import { LyricDebris } from './lyric-debris'
import { PACE } from './pace'
import { Spring } from './spring'
import { spotlightAt } from './stage-effects'
import { buildTimeline, getTimelineState, getWordProgress } from './timeline'
import { EMPTY_LYRICS } from './types'
import { holdVibrato, vibratoWave } from './vibrato'
import { dissolveState, heartbeatLevel, shatterState, shimmerCenter } from './word-effects'

export interface LyricPlayerOptions {
  // 当前播放进度（秒），每帧读取；没有音频时返回 null
  getTime: () => number | null
  isPlaying: () => boolean
  // 点击某一行：跳转到该行（毫秒）
  onSeek: (timeMs: number) => void
  // 紧凑模式（悬浮播放器）：字号、间距更小（见 lyric-player.css），间奏更矮、模糊更轻，焦点更靠近中间
  compact?: boolean
}

export interface LyricPlayerDisplay {
  showTranslation: boolean
  showRomanization: boolean
  footerText: string
  // 强调特效（放大、辉光、波浪）；减少动态效果时始终关闭
  effects: boolean
}

interface WordView {
  word: LyricWord
  el: HTMLElement
  width: number
  // 强调词四周留出的内边距（px）：放大的字与辉光不被擦除遮罩裁掉
  pad: number
  mask: string
  transform: string
}

interface CharView {
  el: HTMLElement
  transform: string
  shadow: string
  color: string
  filter: string
  // 下划线画出的进度（--lyric-line）
  line: string
  // 这个字的演唱时段：所在音节的时间（一个音节有多个字时平分），下划线据此与逐字擦除同步画出
  start: number
  end: number
  // 流光的背景（光带 + 底色，裁剪到字形）与消散的不透明度
  background: string
  opacity: string
  // 消散 / 破碎：已为这个时刻生成过颗粒或碎片（往回拖动进度后重新生成）
  debrisAt: number | null
}

/** 一组强调的词拆成的单字 */
interface EmphasisView {
  group: LyricEmphasis
  chars: CharView[]
}

interface ItemView {
  item: TimelineItem
  el: HTMLElement
  height: number
  y: Spring
  scale: Spring
  // 间奏展开程度（0 收起，1 展开）
  expand?: Spring
  words: WordView[]
  emphasis: EmphasisView[]
  extras: HTMLElement[]
  dots: HTMLElement[]
  // 上次写入的样式，未变化时不重复写 DOM
  transform: string
  filter: string
  color: string
  opacity: string
  visible: boolean
}

// 强调的演出时长下限（毫秒）、字与字的错开比例、上浮提前开始的时长（参考 AMLL）
const EMPHASIS_MIN_MS = 1000
const EMPHASIS_STAGGER_RATIO = 1 / 2.5
const EMPHASIS_FLOAT_LEAD_MS = 400
const EMPHASIS_FLOAT_STRETCH = 1.4

// focus 在演出时长的多少比例内由模糊变清晰（shake 的抖动周期等随节奏变化的参数见 pace.ts）
const EMPHASIS_FOCUS_CLEAR_RATIO = 0.6
// 上色的峰值与唱过后保留的比例（高亮行内）
const EMPHASIS_TINT_PEAK = 0.85
const EMPHASIS_TINT_HOLD = 0.6

// 间奏条目展开后的高度：默认 / 紧凑模式
const INTERLUDE_HEIGHT_PX = 56
const INTERLUDE_HEIGHT_COMPACT_PX = 28
// 紧凑模式下焦点条目的对齐位置与模糊系数：歌词区很矮，焦点放在中间附近，模糊减半以免远处的行完全糊掉
const COMPACT_ALIGN_POSITION = 0.4
const COMPACT_BLUR_FACTOR = 0.5
// 聚光灯（点题句，可以有多句、每次出现都演出，见 stage-effects.ts 的 spotlightAt）：唱到的这一句移到歌词区垂直中央、放大（不超出右侧，见 spotlightFit），
// 暖光由舞台层（MusicStageEffects）在身后打出；其余行向两侧让开、变淡（不透明度降到 SPOTLIGHT_OTHERS_ALPHA）、略微变虚。紧凑模式放大与让开都更小。
// 点题句通常也带着强调短语，整行放大后字的辉光会连成一片显得发虚，因此聚光灯亮起时收敛这一句的字词特效：
// 辉光降到 SPOTLIGHT_EMPHASIS_GLOW、字的放大幅度降到 SPOTLIGHT_EMPHASIS_SCALE（颜色、字体与字形不变）
const SPOTLIGHT_SCALE = 1.25
const SPOTLIGHT_SCALE_COMPACT = 1.1
const SPOTLIGHT_SPREAD_EM = 0.75
const SPOTLIGHT_SPREAD_COMPACT_EM = 0.35
const SPOTLIGHT_OTHERS_ALPHA = 0.24
const SPOTLIGHT_BLUR_PX = 2.5
const SPOTLIGHT_EMPHASIS_GLOW = 0.3
const SPOTLIGHT_EMPHASIS_SCALE = 0.5
// 拖动超过此距离视为滚动，不再触发点击
const DRAG_CLICK_TOLERANCE_PX = 6
// 惯性速度低于此值（px/s）时停止
const INERTIA_MIN_VELOCITY = 20

/**
 * 聚光灯放大倍数：不超过 max，且放大后文字不超出整行（缩放以行首为原点，对唱行以行尾为原点）。
 * 按各文字节点相对整行的位置计算，与当前缩放无关
 */
function spotlightFit(el: HTMLElement, max: number): number {
  const box = el.getBoundingClientRect()
  if (box.width <= 0 || el.offsetWidth <= 0)
    return max
  const fromRight = el.classList.contains('lyric-line--duet')
  const range = el.ownerDocument.createRange()
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let extent = 0
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    range.selectNodeContents(node)
    const rect = range.getBoundingClientRect()
    if (rect.width > 0)
      extent = Math.max(extent, fromRight ? box.right - rect.left : rect.right - box.left)
  }
  // 留出行尾的内边距
  const pad = (Number.parseFloat(getComputedStyle(el).paddingRight) || 0) * box.width / el.offsetWidth
  return extent > 0 ? Math.max(1, Math.min(max, (box.width - pad) / extent)) : max
}

/**
 * 歌词文字颜色：容器上的 --lyric-color（默认白色，播放器页与悬浮播放器为深色界面）按不透明度混合，
 * 文章内的单曲卡跟随站点亮暗主题时设为前景色
 */
function lyricColor(alpha: number) {
  return alpha >= 1 ? 'var(--lyric-color, #fff)' : `color-mix(in srgb, var(--lyric-color, #fff) ${(alpha * 100).toFixed(1)}%, transparent)`
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 按字形（grapheme）拆分，避免把组合字符、表情拆开 */
function splitGraphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl)
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(part => part.segment)
  return Array.from(text)
}

/** 把词首尾的空格换成不换行空格：词为 inline-block，普通空格会被折叠，拉丁文字的单词会粘连 */
function preserveEdgeSpaces(text: string) {
  return text.replace(/^ +| +$/g, match => '\u00A0'.repeat(match.length))
}

const easeOut = (t: number) => 1 - (1 - t) ** 2

/**
 * 歌词引擎（第二期，见 spec 8.2 ~ 8.7、8.12）：直接操作 DOM，逐帧由 requestAnimationFrame 驱动，不经过 React 渲染。
 * - 每个条目（歌词行 / 间奏 / 底栏）绝对定位，位置与缩放各由一个弹簧驱动；焦点变化时阶梯入场
 * - 逐字歌词用带羽化边缘的遮罩从左到右擦除，演唱中的词轻微上浮；行级歌词只做整行高亮
 * - 按距焦点的行距模糊；视口外（含 overscan）的条目隐藏且不更新样式
 * - 滚轮 / 触摸拖动（带惯性）进入手动滚动，冻结焦点，停手一段时间后回到自动对齐
 * - 进度突变（跳转）时瞬移到位；暂停且动画静止时停止逐帧循环，由 wake() 唤醒
 */
/**
 * 是否允许下载歌词的网页字体：读者开了省流量模式，或网络为 2G 及以下时不下载。
 * 3G 不排除：effectiveType 是按近期往返时间估算的，Wi-Fi 下也常被判为 3G；网页字体加载期间文字先用系统字体显示（font-display: swap）
 */
function allowLyricWebFonts() {
  const connection = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { connection?: { saveData?: boolean, effectiveType?: string } }).connection
  return !connection?.saveData && !['slow-2g', '2g'].includes(connection?.effectiveType ?? '')
}

/** 把强调的词拆成单字放进 wordEl，非空白的字加入 chars 逐字演出；同时带上该组的字体与字形。timing 为这个音节的演唱时段 */
function fillEmphasisChars(wordEl: HTMLElement, text: string, chars: CharView[], group: LyricEmphasis, timing: { start: number, end: number }) {
  const doc = wordEl.ownerDocument
  wordEl.classList.add('lyric-word--emphasis', `lyric-word--fx-${group.effect}`, ...(group.styles ?? []).map(style => `lyric-word--${style}`))
  if (group.font)
    wordEl.dataset.font = group.font
  const graphemes = splitGraphemes(preserveEdgeSpaces(text))
  const visible = Math.max(1, graphemes.filter(char => char.trim()).length)
  const step = (timing.end - timing.start) / visible
  let k = 0
  for (const char of graphemes) {
    const charEl = doc.createElement('span')
    charEl.className = 'lyric-char'
    charEl.textContent = char
    wordEl.append(charEl)
    if (char.trim()) {
      chars.push({ el: charEl, transform: '', shadow: '', color: '', filter: '', line: '', background: '', opacity: '', debrisAt: null, start: timing.start + step * k, end: timing.start + step * (k + 1) })
      k++
    }
    else {
      charEl.classList.add('lyric-char--space')
    }
  }
}

export class LyricPlayer {
  private lyrics: ResolvedLyrics = EMPTY_LYRICS
  private items: TimelineItem[] = []
  private views: ItemView[] = []
  private display: LyricPlayerDisplay = { showTranslation: true, showRomanization: true, footerText: '', effects: true }
  private state: TimelineState = { active: [], focus: 0, interlude: null }
  private activeLines = new Set<number>()
  // 聚光灯：点题句的行号到条目的映射、此刻演出的条目（没有时为 -1）、当前强度与放大倍数上限（开始亮起时按文字宽度测量）
  private spotViews = new Map<number, number>()
  private spotView = -1
  private spot = 0
  private spotScale: number | null = null

  private containerHeight = 0
  private narrow = false
  private fontSize = 16
  private layoutDirty = true
  private teleport = true
  private reducedMotion = prefersReducedMotion()

  private rafId = 0
  private lastFrame = 0
  private lastTimeMs: number | null = null
  // 最近一次跳转（拖动进度、打开页面、换歌）的落点：消散特效在它之前就该消散的字直接显示
  private seekAt = Number.NEGATIVE_INFINITY

  // 手动滚动：offset 为手动设定的滚动位置；touching 为正在拖动
  private manual: { offset: number, velocity: number, until: number, touching: boolean } | null = null
  private drag: { pointerId: number, lastY: number, lastAt: number, moved: number } | null = null
  private suppressClick = false

  private resizeObserver: ResizeObserver | null = null
  // 消散特效的颗粒层（第一次有字消散时才创建 canvas）
  private readonly debris: LyricDebris
  private readonly listeners: [string, EventListener, AddEventListenerOptions?][]

  private readonly interludeHeight: number
  private readonly alignPosition: number

  constructor(private readonly container: HTMLElement, private readonly options: LyricPlayerOptions) {
    container.classList.add('lyric-player')
    // 省流量模式或慢速网络时不下载歌词的网页字体（见 lyric-player.css）
    if (!allowLyricWebFonts())
      container.classList.add('lyric-player--no-webfonts')
    if (options.compact)
      container.classList.add('lyric-player--compact')
    this.debris = new LyricDebris(container)
    this.interludeHeight = options.compact ? INTERLUDE_HEIGHT_COMPACT_PX : INTERLUDE_HEIGHT_PX
    this.alignPosition = options.compact ? COMPACT_ALIGN_POSITION : LYRIC_ALIGN_POSITION
    this.listeners = [
      ['wheel', this.onWheel as EventListener, { passive: false }],
      ['pointerdown', this.onPointerDown as EventListener],
      ['pointermove', this.onPointerMove as EventListener],
      ['pointerup', this.onPointerUp as EventListener],
      ['pointercancel', this.onPointerUp as EventListener],
      ['click', this.onClick as EventListener, { capture: true }],
    ]
    this.listeners.forEach(([type, listener, opts]) => container.addEventListener(type, listener, opts))
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.layoutDirty = true
        this.teleport = true
        this.wake()
      })
      this.resizeObserver.observe(container)
    }
  }

  dispose() {
    cancelAnimationFrame(this.rafId)
    this.rafId = 0
    this.resizeObserver?.disconnect()
    this.listeners.forEach(([type, listener, opts]) => this.container.removeEventListener(type, listener, opts))
    // 只移除引擎自己创建的节点，不碰容器里可能由其他代码（如 React）管理的内容
    this.views.forEach(view => view.el.remove())
    this.views = []
    this.debris.dispose()
    this.container.classList.remove('lyric-player', 'lyric-player--compact', 'lyric-player--no-roman', 'lyric-player--no-webfonts')
    delete this.container.dataset.lyricFont
  }

  setLyrics(lyrics: ResolvedLyrics) {
    if (lyrics === this.lyrics)
      return
    this.lyrics = lyrics
    // 全曲字体（来自歌词标注），字体栈见 lyric-player.css
    if (lyrics.font)
      this.container.dataset.lyricFont = lyrics.font
    else
      delete this.container.dataset.lyricFont
    this.items = buildTimeline(lyrics.lines)
    this.debris.clear()
    this.manual = null
    this.lastTimeMs = null
    this.build()
  }

  setDisplay(display: LyricPlayerDisplay) {
    const { showTranslation, showRomanization, footerText, effects } = this.display
    this.display = display
    if (effects && !display.effects)
      this.views.forEach(view => this.resetEmphasis(view))
    if (display.footerText !== footerText) {
      const footer = this.views.at(-1)
      if (footer?.item.kind === 'footer')
        footer.el.textContent = display.footerText
    }
    // 逐字音译（注音行）随音译开关显示 / 隐藏
    this.container.classList.toggle('lyric-player--no-roman', !display.showRomanization)
    if (display.showTranslation !== showTranslation || display.showRomanization !== showRomanization) {
      this.views.forEach(view => view.extras.forEach((el) => {
        el.hidden = el.dataset.kind === 'translation' ? !display.showTranslation : !display.showRomanization
      }))
    }
    this.layoutDirty = true
    this.wake()
  }

  /** 唤醒逐帧循环：播放状态、进度、尺寸变化时调用 */
  wake() {
    if (this.rafId)
      return
    this.lastFrame = performance.now()
    this.rafId = requestAnimationFrame(this.frame)
  }

  // ---------- 构建 ----------

  private build() {
    const doc = this.container.ownerDocument
    const lineTimed = !this.lyrics.wordTimed
    this.views = this.items.map((item) => {
      const view: ItemView = {
        item,
        el: doc.createElement(item.kind === 'line' ? 'button' : 'div'),
        height: 0,
        y: new Spring(0, LYRIC_POSITION_SPRING),
        scale: new Spring(LYRIC_INACTIVE_SCALE, LYRIC_SCALE_SPRING),
        words: [],
        emphasis: [],
        extras: [],
        dots: [],
        transform: '',
        filter: '',
        color: '',
        opacity: '',
        visible: true,
      }
      const { el } = view
      el.classList.add('lyric-item')
      if (item.kind === 'line') {
        const line = this.lyrics.lines[item.line]
        el.setAttribute('type', 'button')
        el.classList.add('lyric-line')
        if (line.isDuet)
          el.classList.add('lyric-line--duet')
        if (line.isBackground)
          el.classList.add('lyric-line--bg')
        el.dataset.start = String(line.start)
        const main = doc.createElement('span')
        main.className = 'lyric-main'
        if (lineTimed) {
          main.textContent = line.words.map(word => word.text).join('')
        }
        else {
          // 强调的词拆成单字，逐字演出；逐字对齐的音译跟随所注音节的强调，作为同一组的另一份单字单独演出
          const groupOf = (index: number) => line.emphasis?.findIndex(group => index >= group.from && index < group.to) ?? -1
          view.emphasis = (line.emphasis ?? []).map(group => ({ group, chars: [] }))
          const rubyEmphasis: EmphasisView[] = (line.emphasis ?? []).map(group => ({ group, chars: [] }))
          const mainWords: WordView[] = line.words.map((word, index) => {
            const wordEl = doc.createElement('span')
            wordEl.className = 'lyric-word'
            const group = groupOf(index)
            if (group >= 0)
              fillEmphasisChars(wordEl, word.text, view.emphasis[group].chars, view.emphasis[group].group, word)
            else
              wordEl.textContent = preserveEdgeSpaces(word.text)
            return { word, el: wordEl, width: 0, pad: 0, mask: '', transform: '' }
          })
          view.words = [...mainWords, ...this.buildWords(main, line, mainWords, (index) => {
            const group = groupOf(index)
            return group >= 0 ? rubyEmphasis[group] : null
          })]
          view.emphasis.push(...rubyEmphasis.filter(item => item.chars.length > 0))
        }
        if (line.mood)
          el.style.setProperty('--lyric-glow', MOOD_GLOW[line.mood])
        el.append(main)
        // 主次顺序：原文（含注音行）、音译、翻译；已逐字对齐的音译显示在注音行，不再单独成行
        for (const [kind, text] of [['romanization', line.romanizationWords ? undefined : line.romanization], ['translation', line.translation]] as const) {
          if (!text)
            continue
          const extra = doc.createElement('span')
          extra.className = 'lyric-extra'
          extra.dataset.kind = kind
          extra.textContent = text
          extra.hidden = kind === 'translation' ? !this.display.showTranslation : !this.display.showRomanization
          view.extras.push(extra)
          el.append(extra)
        }
      }
      else if (item.kind === 'interlude') {
        el.classList.add('lyric-interlude')
        el.setAttribute('aria-hidden', 'true')
        view.expand = new Spring(0, LYRIC_SCALE_SPRING)
        for (let i = 0; i < 3; i++) {
          const dot = doc.createElement('span')
          view.dots.push(dot)
          el.append(dot)
        }
      }
      else {
        el.classList.add('lyric-footer')
        el.textContent = this.display.footerText
      }
      return view
    })
    const spotlights = new Set(this.lyrics.spotlights)
    this.spotViews = new Map()
    this.views.forEach((view, index) => {
      if (view.item.kind === 'line' && spotlights.has(view.item.line))
        this.spotViews.set(view.item.line, index)
    })
    this.spotView = -1
    this.container.querySelectorAll(':scope > .lyric-item').forEach(el => el.remove())
    this.container.append(...this.views.map(view => view.el))
    this.layoutDirty = true
    this.teleport = true
    this.wake()
  }

  /**
   * 把原文的词放进主行；有逐字音译时，被同一个音译词覆盖的连续音节组成一个注音单元：原文在上、音译在下居中对齐
   * （参考 StarryPlayer 的注音行），音译的每一段也作为可擦除的词返回，按自己的时间逐字擦除。
   * emphasisOf 返回某个音节所在强调组的音译部分（不强调时为 null），注在强调音节下的音译段拆成单字放入其中，并带上该组的字体与字形
   */
  private buildWords(main: HTMLElement, line: ResolvedLyrics['lines'][number], mainWords: WordView[], emphasisOf: (index: number) => EmphasisView | null): WordView[] {
    const doc = this.container.ownerDocument
    const parts = line.romanizationWords ?? []
    if (parts.length === 0) {
      main.append(...mainWords.map(word => word.el))
      return []
    }
    // 音译词（以空格结尾的一段为一个词的结束）覆盖的音节范围，重叠的合并为一个单元
    const units: { from: number, to: number, parts: typeof parts }[] = []
    let current: typeof parts = []
    parts.forEach((part, i) => {
      current.push(part)
      if (!part.text.endsWith(' ') && i < parts.length - 1)
        return
      const from = Math.min(...current.map(item => item.word))
      const to = Math.max(...current.map(item => item.word))
      const last = units.at(-1)
      if (last && from <= last.to) {
        last.to = Math.max(last.to, to)
        last.parts.push(...current)
      }
      else {
        units.push({ from, to, parts: current })
      }
      current = []
    })

    const rubyWords: WordView[] = []
    let unit = 0
    for (let index = 0; index < mainWords.length; index++) {
      const u = units[unit]
      if (!u || index < u.from) {
        main.append(mainWords[index].el)
        continue
      }
      const unitEl = doc.createElement('span')
      unitEl.className = 'lyric-unit'
      const unitMain = doc.createElement('span')
      unitMain.className = 'lyric-unit-main'
      for (let i = u.from; i <= u.to; i++)
        unitMain.append(mainWords[i].el)
      const ruby = doc.createElement('span')
      ruby.className = 'lyric-ruby'
      for (const part of u.parts) {
        const el = doc.createElement('span')
        el.className = 'lyric-word'
        const emphasis = emphasisOf(part.word)
        if (emphasis)
          fillEmphasisChars(el, part.text, emphasis.chars, emphasis.group, part)
        else
          el.textContent = preserveEdgeSpaces(part.text)
        ruby.append(el)
        rubyWords.push({ word: { text: part.text, start: part.start, end: part.end }, el, width: 0, pad: 0, mask: '', transform: '' })
      }
      unitEl.append(unitMain, ruby)
      main.append(unitEl)
      index = u.to
      unit++
    }
    return rubyWords
  }

  private measure() {
    this.containerHeight = this.container.clientHeight
    this.narrow = this.container.ownerDocument.defaultView?.matchMedia('(max-width: 1024px)').matches ?? false
    const firstMain = this.container.querySelector<HTMLElement>('.lyric-main')
    if (firstMain)
      this.fontSize = Number.parseFloat(getComputedStyle(firstMain).fontSize) || 16
    for (const view of this.views) {
      // 缩放不影响 offsetHeight / offsetWidth
      view.height = view.item.kind === 'interlude' ? this.interludeHeight : view.el.offsetHeight
      for (const word of view.words) {
        word.width = word.el.offsetWidth
        word.pad = view.emphasis.length > 0 ? Number.parseFloat(getComputedStyle(word.el).paddingLeft) || 0 : 0
      }
    }
    this.spotScale = null
    this.layoutDirty = false
  }

  // ---------- 逐帧 ----------

  private frame = (now: number) => {
    this.rafId = 0
    const dt = Math.min(LYRIC_MAX_FRAME_S, Math.max(0, (now - this.lastFrame) / 1000))
    this.lastFrame = now
    if (this.layoutDirty)
      this.measure()
    if (this.containerHeight <= 0 || this.views.length === 0)
      return

    const playing = this.options.isPlaying()
    const timeMs = (this.options.getTime() ?? 0) * 1000
    // 跳转检测：进度与按经过时间推算的进度相差过大
    if (this.lastTimeMs != null) {
      const expected = this.lastTimeMs + (playing ? dt * 1000 : 0)
      if (Math.abs(timeMs - expected) > LYRIC_SEEK_THRESHOLD_MS) {
        this.teleport = true
        this.seekAt = timeMs
      }
    }
    else {
      this.seekAt = timeMs
    }
    this.lastTimeMs = timeMs

    const previousFocus = this.state.focus
    this.state = getTimelineState(this.lyrics.lines, this.items, timeMs)
    this.activeLines = new Set(this.state.active)
    const focusChanged = this.state.focus !== previousFocus

    // 跳转后旧的消散颗粒与破碎碎片不再对应当前歌词
    if (this.teleport)
      this.debris.clear()
    // 聚光灯随特效开关；减少动态效果与手动滚动时不演出
    const spotlight = this.spotViews.size > 0 && this.display.effects && !this.reducedMotion && !this.manual ? spotlightAt(this.lyrics, timeMs) : null
    const spotView = spotlight ? this.spotViews.get(spotlight.line) ?? -1 : -1
    this.spot = spotView >= 0 && spotlight ? spotlight.level : 0
    // 换到另一句（或熄灭）时重新测量放大倍数
    if (spotView !== this.spotView)
      this.spotScale = null
    this.spotView = spotView
    const animating = this.layout(dt, now, focusChanged)
    this.paint(timeMs)
    const debris = this.debris.step(playing ? dt : 0)

    const teleported = this.teleport
    this.teleport = false
    if (playing || animating || this.manual || teleported || (debris && playing))
      this.wake()
  }

  /** 计算各条目的目标位置并推进弹簧；返回是否仍有动画在进行 */
  private layout(dt: number, now: number, focusChanged: boolean): boolean {
    const jump = this.teleport || this.reducedMotion
    let animating = false

    // 间奏展开 / 收起（影响后续条目的位置）
    for (let i = 0; i < this.views.length; i++) {
      const { expand } = this.views[i]
      if (!expand)
        continue
      const target = this.state.interlude === i ? 1 : 0
      if (jump)
        expand.jump(target)
      else
        expand.setTarget(target)
      expand.step(dt)
      animating ||= !expand.resting
    }

    const heights = this.views.map(view => view.expand ? view.height * view.expand.position : view.height)
    const tops: number[] = []
    let total = 0
    for (const height of heights) {
      tops.push(total)
      total += height
    }

    // 自动对齐：焦点条目的中心对齐到固定位置；间奏按展开后的高度计算，避免展开过程中目标漂移
    const focus = this.state.focus
    const focusHeight = this.views[focus]?.expand ? this.interludeHeight : heights[focus] ?? 0
    const autoScroll = (tops[focus] ?? 0) + focusHeight / 2 - this.containerHeight * this.alignPosition
    const scroll = this.updateManual(dt, now, autoScroll, total) ?? autoScroll
    const dragging = this.manual?.touching ?? false

    // 聚光灯：整体平移使点题句移到垂直中央，其余行再向两侧让开
    const spot = this.spot
    const spotView = spot > 0 ? this.spotView : -1
    let spotShift = 0
    let spotSpread = 0
    let spotScale = 1
    if (spotView >= 0) {
      spotShift = (this.containerHeight / 2 - heights[spotView] / 2 - (tops[spotView] - scroll)) * spot
      spotSpread = (this.options.compact ? SPOTLIGHT_SPREAD_COMPACT_EM : SPOTLIGHT_SPREAD_EM) * this.fontSize * spot
      this.spotScale ??= spotlightFit(this.views[spotView].el, this.options.compact ? SPOTLIGHT_SCALE_COMPACT : SPOTLIGHT_SCALE)
      spotScale = this.spotScale
    }

    // 阶梯入场：焦点因播放推进而变化时，从视口内第一个条目开始逐个增加延迟
    let delay = 0
    let step = LYRIC_STAGGER_BASE_S
    const stagger = focusChanged && !jump && !this.manual

    for (let i = 0; i < this.views.length; i++) {
      const view = this.views[i]
      const target = tops[i] - scroll + spotShift + (spotView >= 0 && i !== spotView ? Math.sign(i - spotView) * spotSpread : 0)
      const onScreen = target + heights[i] > -LYRIC_OVERSCAN_PX && target < this.containerHeight + LYRIC_OVERSCAN_PX
      if (jump || dragging) {
        view.y.jump(target)
      }
      else if (stagger && onScreen) {
        view.y.setTarget(target, delay)
        delay += step
        step /= LYRIC_STAGGER_DECAY
      }
      else {
        view.y.setTarget(target)
      }
      view.y.step(dt)

      const highlighted = view.item.kind === 'line' ? this.activeLines.has(view.item.line) || i === focus : false
      const baseScale = view.item.kind === 'line' && !highlighted ? LYRIC_INACTIVE_SCALE : 1
      const scaleTarget = i === spotView ? baseScale + (spotScale - baseScale) * spot : baseScale
      if (jump)
        view.scale.jump(scaleTarget)
      else
        view.scale.setTarget(scaleTarget)
      view.scale.step(dt)
      animating ||= !view.y.resting || !view.scale.resting
    }
    return animating
  }

  /** 手动滚动的位置：惯性、边界与超时回到自动对齐；不在手动滚动时返回 null */
  private updateManual(dt: number, now: number, autoScroll: number, total: number): number | null {
    const manual = this.manual
    if (!manual)
      return null
    const min = -this.containerHeight * this.alignPosition
    const max = Math.max(min, total - this.containerHeight * this.alignPosition)
    if (!manual.touching && manual.velocity !== 0) {
      manual.offset += manual.velocity * dt
      manual.velocity *= LYRIC_INERTIA_DECAY_PER_S ** dt
      if (Math.abs(manual.velocity) < INERTIA_MIN_VELOCITY)
        manual.velocity = 0
      manual.until = now + LYRIC_USER_SCROLL_HOLD_MS
    }
    manual.offset = Math.min(max, Math.max(min, manual.offset))
    if (!manual.touching && manual.velocity === 0 && now >= manual.until) {
      this.manual = null
      return autoScroll
    }
    return manual.offset
  }

  private paint(timeMs: number) {
    const focus = this.state.focus
    const spot = this.spot
    const inactiveAlpha = this.lyrics.wordTimed ? LYRIC_INACTIVE_ALPHA : LYRIC_INACTIVE_ALPHA_LINE_TIMED
    const blurFactor = (this.narrow ? LYRIC_BLUR_NARROW_FACTOR : 1) * (this.options.compact ? COMPACT_BLUR_FACTOR : 1)
    const noBlur = this.reducedMotion || this.manual != null
    const feather = LYRIC_FEATHER_EM * this.fontSize

    for (let i = 0; i < this.views.length; i++) {
      const view = this.views[i]
      const y = view.y.position
      const visible = y + view.height > -LYRIC_OVERSCAN_PX && y < this.containerHeight + LYRIC_OVERSCAN_PX
      if (visible !== view.visible) {
        view.visible = visible
        view.el.style.visibility = visible ? '' : 'hidden'
      }
      if (!visible)
        continue

      const transform = `translate3d(0, ${y.toFixed(2)}px, 0) scale(${view.scale.position.toFixed(4)})`
      if (transform !== view.transform) {
        view.transform = transform
        view.el.style.transform = transform
      }

      const item = view.item
      if (item.kind === 'line') {
        const active = this.activeLines.has(item.line)
        const alpha = active ? 1 : inactiveAlpha
        const spotted = i === this.spotView
        // 聚光灯亮起时其余行变淡、变虚
        const dimmed = spot > 0 && !spotted ? alpha + (Math.min(alpha, SPOTLIGHT_OTHERS_ALPHA) - alpha) * spot : alpha
        const color = lyricColor(Math.round(dimmed * 100) / 100)
        if (color !== view.color) {
          view.color = color
          view.el.style.color = color
        }
        const distance = Math.abs(i - focus)
        let blur = noBlur || active || distance === 0 ? 0 : Math.min(LYRIC_BLUR_MAX_PX, 1 + distance) * blurFactor
        if (spot > 0 && !spotted)
          blur = Math.max(blur, SPOTLIGHT_BLUR_PX * spot * blurFactor)
        const filter = blur > 0 ? `blur(${blur.toFixed(1)}px)` : ''
        if (filter !== view.filter) {
          view.filter = filter
          view.el.style.filter = filter
        }
        this.paintWords(view, active, timeMs, feather, inactiveAlpha)
        if (view.emphasis.length > 0) {
          if (this.display.effects && !this.reducedMotion)
            this.paintEmphasis(view, active, timeMs)
          else
            this.resetEmphasis(view)
        }
      }
      else if (item.kind === 'interlude') {
        const expand = view.expand?.position ?? 0
        const opacity = expand.toFixed(3)
        if (opacity !== view.opacity) {
          view.opacity = opacity
          view.el.style.opacity = opacity
        }
        // 间奏圆点：依次淡入、倒计时点亮、呼吸，结束前放大后收拢消失（见 interlude.ts）；减少动态效果时只保留透明度
        view.dots.forEach((dot, index) => {
          const state = interludeDot(item.start, item.end, timeMs, index, view.dots.length)
          const opacity = state.opacity.toFixed(3)
          const transform = this.reducedMotion ? '' : `scale(${state.scale.toFixed(3)})`
          if (dot.style.opacity !== opacity)
            dot.style.opacity = opacity
          if (dot.style.transform !== transform)
            dot.style.transform = transform
        })
      }
      else {
        const color = lyricColor(i === focus ? LYRIC_FOOTER_FOCUSED_ALPHA : LYRIC_FOOTER_ALPHA)
        if (color !== view.color) {
          view.color = color
          view.el.style.color = color
        }
      }
    }
  }

  /** 逐字擦除：高亮行的每个词按演唱进度用带羽化边缘的遮罩揭示，演唱中的词轻微上浮；不高亮时清除 */
  private paintWords(view: ItemView, active: boolean, timeMs: number, feather: number, dimAlpha: number) {
    for (const word of view.words) {
      let mask = ''
      let transform = ''
      const width = word.width - word.pad * 2
      if (active && width > 0) {
        const progress = getWordProgress(word.word.start, word.word.end, timeMs)
        // 遮罩按像素定位：强调词四周有内边距，揭示位置从内边距之后算起
        const x = word.pad + progress * (width + feather)
        mask = progress >= 1 ? '' : `linear-gradient(90deg, #000 ${(x - feather).toFixed(1)}px, rgb(0 0 0 / ${dimAlpha}) ${x.toFixed(1)}px)`
        if (!this.reducedMotion && progress > 0)
          transform = `translateY(${(-LYRIC_WORD_FLOAT_EM * this.fontSize * easeOut(progress)).toFixed(2)}px)`
      }
      if (mask !== word.mask) {
        word.mask = mask
        word.el.style.maskImage = mask
        word.el.style.setProperty('-webkit-mask-image', mask)
      }
      if (transform !== word.transform) {
        word.transform = transform
        word.el.style.transform = transform
      }
    }
  }

  /**
   * 强调特效（参考 AMLL 与 StarryPlayer）：组内的字依次错开，按起落曲线放大、发光并上浮；
   * swell 放大 + 辉光 + 上浮，glow 只发光（几乎不放大），wave 不发光、逐字波浪上浮，
   * shake 演唱时快速细微地抖动（带长音时为颤音：先放大，唱了一会儿后整个词起伏颤动，见 vibrato.ts），
   * focus 在高亮行内先模糊、唱到时变清晰。强度 factor 决定幅度，为 0 时不做动效。
   * 带下划线字形的组：每个字在自己所在音节的演唱时段内从左到右画出下划线（与逐字擦除同步）
   * 指定了颜色的组：字随演出逐渐上色（辉光也用该颜色），唱过后在高亮行内保留部分颜色
   */
  private paintEmphasis(view: ItemView, active: boolean, timeMs: number) {
    const bg = view.item.kind === 'line' && this.lyrics.lines[view.item.line]?.isBackground
    // 聚光灯下的点题句：辉光与字的放大随聚光灯强度收敛（见 SPOTLIGHT_EMPHASIS_GLOW）
    const spot = this.views[this.spotView] === view ? this.spot : 0
    const glowScale = 1 - (1 - SPOTLIGHT_EMPHASIS_GLOW) * spot
    const growScale = 1 - (1 - SPOTLIGHT_EMPHASIS_SCALE) * spot
    for (const { group, chars } of view.emphasis) {
      // 特效节奏：起落曲线的时长、抖动与颤音的快慢、心跳拍长、流光与消散的速度（见 pace.ts）
      const pace = group.pace ?? 'medium'
      const duration = Math.max(EMPHASIS_MIN_MS, group.end - group.start) * PACE.envelope[pace]
      const f = group.factor
      const count = chars.length
      const wave = group.effect === 'wave'
      const tintColor = group.color ? LYRIC_COLORS[group.color] : null
      // 下划线：每个字在自己所在音节的演唱时段内从左到右画出，与逐字擦除同步
      const lined = group.styles?.includes('underline')
      // 波浪的字间错开更明显
      const stagger = (duration * (wave ? 1 / 1.5 : EMPHASIS_STAGGER_RATIO)) / Math.max(1, count)
      // 长音：放大到峰值后保持到长音唱完再收住；颤音从延迟后渐强，随长音结束收住
      const hold = group.effect === 'shake' && group.hold ? holdVibrato(group.hold, timeMs, pace) : null
      // 流光的光带位置、心跳的强度（整个词同步）
      const shine = group.effect === 'shimmer' ? shimmerCenter(group.start, timeMs, count, pace) : null
      const beat = group.effect === 'heartbeat' ? heartbeatLevel(group.start, group.end, timeMs, pace) : 0
      chars.forEach((char, i) => {
        const begin = group.start + stagger * i
        let v = swellCurve((timeMs - begin) / duration)
        if (hold && timeMs >= begin + duration / 2)
          v = Math.max(v, hold.release)
        const vibrato = hold?.amount ?? 0
        const lift = Math.sin(Math.PI * Math.min(1, Math.max(0, (timeMs - begin + EMPHASIS_FLOAT_LEAD_MS) / (duration * EMPHASIS_FLOAT_STRETCH))))
        let transform = ''
        let shadow = ''
        let color = ''
        let filter = ''
        let line = ''
        let background = ''
        let opacity = ''
        let drift = 0
        let crack = 0
        if (group.effect === 'dissolve' && f > 0) {
          // 消散：字唱完后淡出、变虚并向右飘，同时生成颗粒；过一会儿慢慢恢复
          const dissolve = dissolveState(group.start, group.end, i, count, timeMs, this.seekAt, pace)
          if (timeMs < dissolve.at) {
            char.debrisAt = null
          }
          else if (char.debrisAt !== dissolve.at && timeMs - dissolve.at < 300) {
            char.debrisAt = dissolve.at
            this.debris.spawn(char.el)
          }
          if (dissolve.amount > 0.002) {
            opacity = (1 - dissolve.amount).toFixed(3)
            filter = `blur(${(dissolve.amount * 0.08).toFixed(3)}em)`
            drift = dissolve.amount * 0.15
          }
        }
        if (group.effect === 'shatter' && f > 0) {
          // 破碎：整个词唱完的一瞬间一起碎掉，字隐去、由碎屑层画出碎片；碎之前字细微地颤；过一会儿慢慢恢复
          const shatter = shatterState(group.end, timeMs, this.seekAt)
          if (timeMs < shatter.at) {
            char.debrisAt = null
          }
          else if (char.debrisAt !== shatter.at && timeMs - shatter.at < 300) {
            char.debrisAt = shatter.at
            this.debris.shatter(char.el, count > 1 ? (i / (count - 1)) * 2 - 1 : 0)
          }
          if (shatter.amount > 0.002)
            opacity = (1 - shatter.amount).toFixed(3)
          crack = shatter.crack
        }
        if (lined)
          line = Math.min(1, Math.max(0, (timeMs - char.start) / Math.max(1, char.end - char.start))).toFixed(3)
        if (group.effect === 'focus' && active && f > 0) {
          // 唱到之前模糊，唱到后在前 60% 的演出时长内变清晰
          const clear = Math.min(1, Math.max(0, (timeMs - begin) / (duration * EMPHASIS_FOCUS_CLEAR_RATIO)))
          const blur = (1 - clear) * (0.05 + 0.07 * f)
          if (blur > 0.002)
            filter = `blur(${blur.toFixed(3)}em)`
        }
        if (tintColor) {
          const tint = Math.max(v * EMPHASIS_TINT_PEAK, active && timeMs >= begin ? EMPHASIS_TINT_HOLD : 0)
          if (tint > 0.005)
            color = `color-mix(in srgb, ${tintColor} ${(tint * 100).toFixed(1)}%, currentColor)`
        }
        // factor 为 0 的组（唱得太快的标注短语）只保留颜色、字体与字形，不做动效
        if (f > 0 && (v > 0 || lift > 0)) {
          let scale = 1
          let x = 0
          let y = -lift * (bg ? 0.1 : 0.05)
          let glow = 0
          let radius = 0.3
          if (group.effect === 'swell') {
            scale = 1 + v * 0.14 * f
            // 左右两侧的字向外轻推
            x = -v * 0.03 * f * (count / 2 - i - 0.5)
            y -= v * 0.025 * f
            glow = v * (0.25 + 0.45 * f)
          }
          else if (group.effect === 'glow') {
            scale = 1 + v * 0.04 * f
            glow = v * (0.35 + 0.5 * f)
            radius = 0.45
          }
          else if (group.effect === 'shake' && hold) {
            // 长音：同 swell 放大；颤音时整个词同步起伏（字间略有相位差），像音高的起伏
            const wobble = vibratoWave(timeMs, hold.onset, i, pace)
            scale = 1 + v * 0.14 * f + wobble * vibrato * 0.02 * f
            x = -v * 0.03 * f * (count / 2 - i - 0.5) + Math.cos(2 * Math.PI * PACE.vibratoHz[pace] * 2 * (timeMs - hold.onset) / 1000 + i) * vibrato * 0.008 * f
            y -= v * 0.025 * f + wobble * vibrato * 0.035 * f
            glow = v * (0.25 + 0.45 * f) + vibrato * 0.12 * f
          }
          else if (group.effect === 'shake') {
            // 每个字的相位不同，抖动幅度随起落曲线
            const phase = (timeMs - begin) / PACE.shakePeriod[pace]
            x = Math.sin(phase * 2.3 + i * 1.7) * 0.035 * f * v
            y += Math.cos(phase * 1.9 + i * 1.3) * 0.025 * f * v
            scale = 1 + v * 0.06 * f
            glow = v * (0.15 + 0.25 * f)
          }
          else if (group.effect === 'focus') {
            scale = 1 + v * 0.05 * f
            glow = v * (0.2 + 0.3 * f)
            radius = 0.4
          }
          else if (group.effect === 'heartbeat') {
            // 心跳：整个词随双拍放大，左右的字向外轻推，辉光随拍闪
            scale = 1 + v * 0.04 * f + beat * 0.16 * f
            x = (i - (count - 1) / 2) * beat * 0.06 * f
            glow = v * (0.2 + 0.2 * f) + beat * (0.3 + 0.35 * f)
          }
          else if (group.effect === 'shimmer' || group.effect === 'dissolve' || group.effect === 'shatter') {
            scale = 1 + v * 0.04 * f
            glow = shine == null ? v * (0.25 + 0.3 * f) : 0
          }
          else {
            y = -lift * (0.08 + 0.14 * f)
            scale = 1 + lift * 0.05 * f
          }
          scale = 1 + (scale - 1) * growScale
          glow *= glowScale
          transform = `translate(${x.toFixed(3)}em, ${y.toFixed(3)}em) scale(${scale.toFixed(3)})`
          if (glow > 0.005)
            shadow = `0 0 ${radius}em color-mix(in srgb, ${tintColor ?? 'var(--lyric-glow, var(--lyric-accent, var(--lyric-color, #fff)))'} ${(glow * 100).toFixed(1)}%, transparent)`
        }
        if (drift > 0)
          transform = `${transform} translateX(${drift.toFixed(3)}em)`.trim()
        if (crack > 0) {
          // 碎之前的颤：每个字相位不同，越接近碎越明显
          transform = `${transform} translate(${(Math.sin(timeMs * 0.09 + i * 1.7) * 0.03 * crack).toFixed(3)}em, ${(Math.cos(timeMs * 0.11 + i) * 0.02 * crack).toFixed(3)}em)`.trim()
        }
        if (shine != null) {
          // 流光：字的颜色改由背景绘制（裁剪到字形，见 lyric-player.css），叠上一道光带；文字本身透明，辉光会盖住背景所以不用
          const pos = (shine - i) * 100
          const base = color ? color.replace('currentColor', 'var(--lyric-color, #fff)') : 'var(--lyric-color, #fff)'
          background = `linear-gradient(105deg, transparent ${(pos - 40).toFixed(1)}%, rgb(255 250 230 / 0.95) ${pos.toFixed(1)}%, transparent ${(pos + 40).toFixed(1)}%), linear-gradient(${base}, ${base})`
          color = 'transparent'
          shadow = ''
        }
        if (transform !== char.transform) {
          char.transform = transform
          char.el.style.transform = transform
        }
        if (shadow !== char.shadow) {
          char.shadow = shadow
          char.el.style.textShadow = shadow
        }
        if (color !== char.color) {
          char.color = color
          char.el.style.color = color
        }
        if (filter !== char.filter) {
          char.filter = filter
          char.el.style.filter = filter
        }
        if (line !== char.line) {
          char.line = line
          char.el.style.setProperty('--lyric-line', line)
        }
        if (background !== char.background) {
          char.background = background
          char.el.style.backgroundImage = background
        }
        if (opacity !== char.opacity) {
          char.opacity = opacity
          char.el.style.opacity = opacity
        }
      })
    }
  }

  private resetEmphasis(view: ItemView) {
    for (const { chars } of view.emphasis) {
      for (const char of chars) {
        if (char.transform) {
          char.transform = ''
          char.el.style.transform = ''
        }
        if (char.shadow) {
          char.shadow = ''
          char.el.style.textShadow = ''
        }
        if (char.color) {
          char.color = ''
          char.el.style.color = ''
        }
        if (char.filter) {
          char.filter = ''
          char.el.style.filter = ''
        }
        if (char.background) {
          char.background = ''
          char.el.style.backgroundImage = ''
        }
        if (char.opacity) {
          char.opacity = ''
          char.el.style.opacity = ''
        }
        // 不演出时下划线完整显示（CSS 默认值）
        if (char.line) {
          char.line = ''
          char.el.style.removeProperty('--lyric-line')
        }
      }
    }
  }

  // ---------- 交互 ----------

  private startManual() {
    if (!this.manual) {
      const focusView = this.views[this.state.focus]
      // 从当前显示的位置开始，避免进入手动滚动时跳动
      const currentScroll = focusView ? -focusView.y.position + this.topOf(this.state.focus) : 0
      this.manual = { offset: currentScroll, velocity: 0, until: 0, touching: false }
    }
    this.manual.until = performance.now() + LYRIC_USER_SCROLL_HOLD_MS
    return this.manual
  }

  private topOf(index: number) {
    let top = 0
    for (let i = 0; i < index; i++) {
      const view = this.views[i]
      top += view.expand ? view.height * view.expand.position : view.height
    }
    return top
  }

  private onWheel = (event: WheelEvent) => {
    event.preventDefault()
    const manual = this.startManual()
    const delta = event.deltaMode === 1 ? event.deltaY * 32 : event.deltaMode === 2 ? event.deltaY * this.containerHeight : event.deltaY
    manual.offset += delta
    manual.velocity = 0
    this.wake()
  }

  private onPointerDown = (event: PointerEvent) => {
    // 鼠标点击用于选择歌词行；触摸与触控笔拖动滚动
    if (event.pointerType === 'mouse')
      return
    this.drag = { pointerId: event.pointerId, lastY: event.clientY, lastAt: performance.now(), moved: 0 }
    this.suppressClick = false
  }

  private onPointerMove = (event: PointerEvent) => {
    const drag = this.drag
    if (!drag || drag.pointerId !== event.pointerId)
      return
    const now = performance.now()
    const dy = event.clientY - drag.lastY
    drag.moved += Math.abs(dy)
    if (drag.moved < DRAG_CLICK_TOLERANCE_PX)
      return
    if (!this.manual?.touching)
      this.container.setPointerCapture?.(event.pointerId)
    const manual = this.startManual()
    manual.touching = true
    manual.offset -= dy
    const elapsed = Math.max(1, now - drag.lastAt) / 1000
    manual.velocity = -dy / elapsed
    drag.lastY = event.clientY
    drag.lastAt = now
    this.suppressClick = true
    this.wake()
  }

  private onPointerUp = (event: PointerEvent) => {
    const drag = this.drag
    if (!drag || drag.pointerId !== event.pointerId)
      return
    this.drag = null
    if (this.manual?.touching) {
      this.manual.touching = false
      // 停顿后再松手不触发惯性
      if (performance.now() - drag.lastAt > 80)
        this.manual.velocity = 0
      this.manual.until = performance.now() + LYRIC_USER_SCROLL_HOLD_MS
      this.wake()
    }
  }

  private onClick = (event: MouseEvent) => {
    if (this.suppressClick) {
      this.suppressClick = false
      event.stopPropagation()
      event.preventDefault()
      return
    }
    const line = (event.target as Element | null)?.closest<HTMLElement>('.lyric-line')
    if (!line || !this.container.contains(line))
      return
    // 点击跳转后立即回到自动对齐
    this.manual = null
    this.options.onSeek(Number(line.dataset.start))
  }
}
