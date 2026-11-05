import type { RhythmModel } from './rhythm/model'
import type { RubyMetrics } from './ruby-layout'
import type { TimelineItem, TimelineState } from './timeline'
import type { LyricEmphasis, LyricWord, ResolvedLyrics } from './types'
import type { LyricMarqueeWordBox, MusicLyricLine } from '@/utils/music-lyric'
import { getLyricMarqueeOffset } from '@/utils/music-lyric'
import { LYRIC_COLORS, MOOD_GLOW } from './colors'
import {
  LYRIC_ALIGN_POSITION,
  LYRIC_BLUR_MAX_PX,
  LYRIC_BLUR_NARROW_FACTOR,
  LYRIC_DETAIL_FRAME_MS,
  LYRIC_EMPHASIS_MIN_MS,
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
import { dissolveFadeMs, envelopeScale, glowLevel, heartbeatLevel, nearestFixedPace, rhythmContext, shakeCarrierMs, shakeLevel, shimmerCenter, swellAccent, waveLevels } from './rhythm/effects'
import { placeRuby, rubyGroups, rubyText } from './ruby-layout'
import { Spring } from './spring'
import { spotlightAt } from './stage-effects'
import { buildTimeline, getTimelineState, getWordProgress } from './timeline'
import { EMPTY_LYRICS } from './types'
import { holdVibrato, vibratoWave } from './vibrato'
import { dissolveState, shatterState } from './word-effects'

export interface LyricPlayerOptions {
  // 当前播放进度（秒），每帧读取；没有音频时返回 null
  getTime: () => number | null
  isPlaying: () => boolean
  // 点击某一行：跳转到该行（毫秒）
  onSeek: (timeMs: number) => void
  // 紧凑模式（悬浮播放器）：字号、间距更小（见 lyric-player.css），间奏更矮、模糊更轻，焦点更靠近中间
  compact?: boolean
  // 单行条（导航栏标题、文章内单曲卡收起时）：容器只有一行高，每个条目铺满容器（字号跟随容器），一次只显示一行；
  // 行不换行，超出宽度时跟随演唱位置横向滚动（见 utils/music-lyric.ts 的 getLyricMarqueeOffset）。
  // 对唱行右对齐；容器足够高时，背景和声或与焦点句同时在唱的另一句放在下层（见 STRIP_TIER_*）。
  // 不显示翻译与音译，没有聚光灯，不响应点击与滚动
  strip?: boolean
  // 这首歌的节拍模型，每帧读取；分析完成前或不可用时返回 null，动效回退到固定快慢（见 rhythm/effects.ts）
  getRhythm?: () => RhythmModel | null
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

/** 注音单元（一个字在上、它的音译在下）：排版见 ruby-layout.ts 的 placeRuby，测量时写入左外边距 */
interface RubyUnitView {
  el: HTMLElement
  ruby: HTMLElement
  word: HTMLElement
  wordText: string
  // 音译各段的元素与显示的文字（一个字有多个音拍时为多段）
  parts: { el: HTMLElement, text: string }[]
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

/** 单行条中一行歌词的横向滚动：时间与各词位置（相对原文左边缘，测量时写入）及上次写入的位移与两侧渐隐 */
interface StripMarquee {
  main: HTMLElement
  line: MusicLyricLine
  nextStart?: number
  boxes: LyricMarqueeWordBox[]
  containerWidth: number
  contentWidth: number
  transform: string
  mask: string
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
  rubyUnits: RubyUnitView[]
  dots: HTMLElement[]
  // 单行条的横向滚动（只有歌词行有）
  marquee: StripMarquee | null
  // 背景和声所附着的主唱行（条目下标），其余条目为 -1
  owner: number
  // 上次写入的样式，未变化时不重复写 DOM
  transform: string
  filter: string
  color: string
  opacity: string
  visible: boolean
}

// 字与字的错开比例、上浮提前开始的时长（参考 AMLL）；演出时长下限见 config.ts 的 LYRIC_EMPHASIS_MIN_MS
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

// 单行条两侧的渐隐宽度：行的内边距之内开始渐隐
const STRIP_FADE = '1.25em'

// 单行条的上下两层：背景和声或与焦点句同时在唱的另一句（重叠的对唱等）放在下层。容器至少这么高才分层（导航栏 36px 可以，单曲卡 20px 不分层）；
// 焦点句上移、缩小，下层句下移（按容器高度的比例）；背景和声的字号见 lyric-player.css（0.72em），重叠的主唱句与焦点句同样缩小
const STRIP_TIER_MIN_HEIGHT_PX = 32
const STRIP_TIER_TOP = -0.21
const STRIP_TIER_BOTTOM = 0.24
const STRIP_TIER_SCALE = 0.9

/** 单行条超出宽度的行两侧的渐隐遮罩：滚动到头 / 尾时去掉对应一侧 */
function stripFadeMask(fadeStart: boolean, fadeEnd: boolean) {
  if (!fadeStart && !fadeEnd)
    return ''
  return `linear-gradient(to right, ${fadeStart ? 'transparent' : 'black'}, black ${STRIP_FADE}, black calc(100% - ${STRIP_FADE}), ${fadeEnd ? 'transparent' : 'black'})`
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
let measureContext: CanvasRenderingContext2D | null | undefined

/** 文字（去掉首尾空白）按元素的字体排出的宽度（px）：用 canvas 测量，不受行的缩放与字的特效变换影响；无法测量时为 null */
function textWidth(el: HTMLElement, text: string): number | null {
  measureContext ??= el.ownerDocument.createElement('canvas').getContext('2d')
  const trimmed = text.trim()
  if (!measureContext || !trimmed)
    return null
  const style = getComputedStyle(el)
  measureContext.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  return measureContext.measureText(trimmed).width
}

// 同一排相邻两段音译的最小间距（音译字号的倍数）
const RUBY_GAP_EM = 0.35

/**
 * 排版一行的注音单元（见 ruby-layout.ts 的 placeRuby）：先清除上次的偏移再测量位置与宽度，然后写入
 * 单元的推移（左外边距）与音译相对字的偏移；隐藏音译时只清除，原文按原样排列
 */
function layoutRubyUnits(units: RubyUnitView[], visible: boolean) {
  for (const unit of units) {
    unit.el.style.marginLeft = ''
    unit.ruby.style.marginLeft = ''
  }
  if (!visible || units.length === 0)
    return
  const metrics: RubyMetrics[] = units.map((unit) => {
    const firstWidth = textWidth(unit.parts[0].el, unit.parts[0].text) ?? 0
    return {
      left: unit.el.offsetLeft,
      top: unit.el.offsetTop,
      charWidth: textWidth(unit.word, unit.wordText) ?? unit.word.offsetWidth,
      firstWidth,
      rubyWidth: unit.parts.reduce((sum, part, i) => sum + (i === 0 ? firstWidth : textWidth(part.el, part.text) ?? 0), 0),
    }
  })
  const gap = RUBY_GAP_EM * (Number.parseFloat(getComputedStyle(units[0].ruby).fontSize) || 10)
  placeRuby(metrics, gap).forEach(({ shift, offset }, i) => {
    if (shift > 0)
      units[i].el.style.marginLeft = `${shift.toFixed(1)}px`
    units[i].ruby.style.marginLeft = `${offset.toFixed(1)}px`
  })
}

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
  // 行号到条目的映射；单行条此刻放在下层的条目（没有时为 -1）
  private lineViews = new Map<number, number>()
  private stripPair = -1

  private containerHeight = 0
  private narrow = false
  private fontSize = 16
  private layoutDirty = true
  private teleport = true
  private reducedMotion = prefersReducedMotion()

  private rafId = 0
  private lastFrame = 0
  // 上一次重绘逐字效果的时间（见 LYRIC_DETAIL_FRAME_MS）
  private lastDetail = Number.NEGATIVE_INFINITY
  private lastTimeMs: number | null = null
  // 最近一次跳转（拖动进度、打开页面、换歌）的落点：消散特效在它之前就该消散的字直接显示
  private seekAt = Number.NEGATIVE_INFINITY
  // 这一帧的节拍模型（见 LyricPlayerOptions.getRhythm）
  private rhythm: RhythmModel | null = null

  // 手动滚动：offset 为手动设定的滚动位置；touching 为正在拖动
  private manual: { offset: number, velocity: number, until: number, touching: boolean } | null = null
  private drag: { pointerId: number, lastY: number, lastAt: number, moved: number } | null = null
  private suppressClick = false

  private resizeObserver: ResizeObserver | null = null
  // 消散特效的颗粒层（第一次有字消散时才创建 canvas）
  private readonly debris: LyricDebris
  private readonly listeners: [string, EventListener, AddEventListenerOptions?][]

  // 间奏展开后的高度；单行条为容器高度，测量时写入
  private interludeHeight: number
  private readonly alignPosition: number

  constructor(private readonly container: HTMLElement, private readonly options: LyricPlayerOptions) {
    container.classList.add('lyric-player')
    // 省流量模式或慢速网络时不下载歌词的网页字体（见 lyric-player.css）
    if (!allowLyricWebFonts())
      container.classList.add('lyric-player--no-webfonts')
    if (options.compact)
      container.classList.add('lyric-player--compact')
    if (options.strip)
      container.classList.add('lyric-player--strip')
    this.debris = new LyricDebris(container)
    this.interludeHeight = options.compact ? INTERLUDE_HEIGHT_COMPACT_PX : INTERLUDE_HEIGHT_PX
    // 单行条：焦点条目与容器重合
    this.alignPosition = options.strip ? 0.5 : options.compact ? COMPACT_ALIGN_POSITION : LYRIC_ALIGN_POSITION
    // 单行条不响应滚动与点击（导航栏标题本身是链接）
    this.listeners = options.strip
      ? []
      : [
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
    // 网页字体加载完成后字宽与行高会变，重新测量（含注音单元的对齐）
    container.ownerDocument.fonts?.addEventListener('loadingdone', this.onFontsLoaded)
  }

  private onFontsLoaded = () => {
    this.layoutDirty = true
    this.wake()
  }

  dispose() {
    cancelAnimationFrame(this.rafId)
    this.rafId = 0
    this.resizeObserver?.disconnect()
    this.container.ownerDocument.fonts?.removeEventListener('loadingdone', this.onFontsLoaded)
    this.listeners.forEach(([type, listener, opts]) => this.container.removeEventListener(type, listener, opts))
    // 只移除引擎自己创建的节点，不碰容器里可能由其他代码（如 React）管理的内容
    this.views.forEach(view => view.el.remove())
    this.views = []
    this.debris.dispose()
    this.container.classList.remove('lyric-player', 'lyric-player--compact', 'lyric-player--strip', 'lyric-player--no-roman', 'lyric-player--no-webfonts')
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
        el: doc.createElement(item.kind === 'line' && !this.options.strip ? 'button' : 'div'),
        height: 0,
        y: new Spring(0, LYRIC_POSITION_SPRING),
        scale: new Spring(LYRIC_INACTIVE_SCALE, LYRIC_SCALE_SPRING),
        words: [],
        emphasis: [],
        extras: [],
        rubyUnits: [],
        dots: [],
        marquee: null,
        owner: -1,
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
        if (!this.options.strip)
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
          view.words = [...mainWords, ...this.buildWords(main, line, mainWords, view.rubyUnits, (index) => {
            const group = groupOf(index)
            return group >= 0 ? rubyEmphasis[group] : null
          })]
          view.emphasis.push(...rubyEmphasis.filter(item => item.chars.length > 0))
        }
        if (line.mood)
          el.style.setProperty('--lyric-glow', MOOD_GLOW[line.mood])
        el.append(main)
        if (this.options.strip)
          view.marquee = this.buildMarquee(main, item.line)
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
    // 行号到条目的映射，背景和声附着到它之前最近的主唱行
    this.lineViews = new Map()
    let lastMain = -1
    this.views.forEach((view, index) => {
      if (view.item.kind !== 'line')
        return
      this.lineViews.set(view.item.line, index)
      if (this.lyrics.lines[view.item.line]?.isBackground)
        view.owner = lastMain
      else
        lastMain = index
    })
    this.stripPair = -1
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
   * 把原文的词放进主行；有逐字音译时，每个有音译的字组成一个注音单元：字在上、它的音译在下
   * （单元记入 units，测量时排版，见 layoutRubyUnits），音译的每一段也作为可擦除的词返回，按自己的时间逐字擦除。
   * emphasisOf 返回某个音节所在强调组的音译部分（不强调时为 null），注在强调音节下的音译段拆成单字放入其中，并带上该组的字体与字形
   */
  private buildWords(main: HTMLElement, line: ResolvedLyrics['lines'][number], mainWords: WordView[], units: RubyUnitView[], emphasisOf: (index: number) => EmphasisView | null): WordView[] {
    const doc = this.container.ownerDocument
    const parts = line.romanizationWords ?? []
    if (parts.length === 0) {
      main.append(...mainWords.map(word => word.el))
      return []
    }
    // 每个字一个注音单元：这个字的音译段放在它下面（显示时去掉标点与空白，见 ruby-layout.ts）
    const groups = new Map(rubyGroups(parts).map(group => [group.word, group.parts]))
    const rubyWords: WordView[] = []
    mainWords.forEach((mainWord, index) => {
      const group = groups.get(index)
      if (!group) {
        main.append(mainWord.el)
        return
      }
      const unitEl = doc.createElement('span')
      unitEl.className = 'lyric-unit'
      const ruby = doc.createElement('span')
      ruby.className = 'lyric-ruby'
      const unitParts: RubyUnitView['parts'] = []
      for (const part of group) {
        const text = rubyText(part.text)
        const el = doc.createElement('span')
        el.className = 'lyric-word'
        const emphasis = emphasisOf(part.word)
        if (emphasis)
          fillEmphasisChars(el, text, emphasis.chars, emphasis.group, part)
        else
          el.textContent = text
        ruby.append(el)
        unitParts.push({ el, text })
        rubyWords.push({ word: { text, start: part.start, end: part.end }, el, width: 0, pad: 0, mask: '', transform: '' })
      }
      unitEl.append(mainWord.el, ruby)
      main.append(unitEl)
      units.push({ el: unitEl, ruby, word: mainWord.el, wordText: mainWord.word.text, parts: unitParts })
    })
    return rubyWords
  }

  /** 单行条一行歌词的横向滚动数据：时间按 getLyricMarqueeOffset 的格式（只取原文的词），下一行为之后最近的主唱行 */
  private buildMarquee(main: HTMLElement, index: number): StripMarquee {
    const line = this.lyrics.lines[index]
    return {
      main,
      line: {
        items: line.words.map(word => ({ text: word.text, startTime: word.start, duration: Math.max(0, word.end - word.start) })),
        startTime: line.start,
        duration: Math.max(0, line.end - line.start),
        originalText: line.words.map(word => word.text).join(''),
      },
      nextStart: this.lyrics.lines.slice(index + 1).find(next => !next.isBackground)?.start,
      boxes: [],
      containerWidth: 0,
      contentWidth: 0,
      transform: '',
      mask: '',
    }
  }

  private measure() {
    this.containerHeight = this.container.clientHeight
    if (this.options.strip)
      this.interludeHeight = this.containerHeight
    this.narrow = this.container.ownerDocument.defaultView?.matchMedia('(max-width: 1024px)').matches ?? false
    const firstMain = this.container.querySelector<HTMLElement>('.lyric-main')
    if (firstMain)
      this.fontSize = Number.parseFloat(getComputedStyle(firstMain).fontSize) || 16
    // 注音单元的排版会改变行宽与换行，先于测量高度
    for (const view of this.views)
      layoutRubyUnits(view.rubyUnits, this.display.showRomanization)
    for (const view of this.views) {
      // 缩放不影响 offsetHeight / offsetWidth
      view.height = view.item.kind === 'interlude' ? this.interludeHeight : view.el.offsetHeight
      for (const word of view.words) {
        word.width = word.el.offsetWidth
        word.pad = view.emphasis.length > 0 ? Number.parseFloat(getComputedStyle(word.el).paddingLeft) || 0 : 0
      }
      const marquee = view.marquee
      if (marquee) {
        // 可视宽度为行的内容区；词的位置相对原文左边缘（offsetLeft 不受位移影响），去掉强调词四周的内边距
        const style = getComputedStyle(view.el)
        marquee.containerWidth = view.el.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0)
        marquee.contentWidth = marquee.main.offsetWidth
        marquee.boxes = view.words.slice(0, marquee.line.items.length).map(word => ({
          left: word.el.offsetLeft - marquee.main.offsetLeft + word.pad,
          width: Math.max(0, word.width - word.pad * 2),
        }))
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
    this.rhythm = this.options.getRhythm?.() ?? null
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
    if (this.options.strip)
      this.state.focus = this.stripFocus(this.state.focus)
    this.activeLines = new Set(this.state.active)
    const focusChanged = this.state.focus !== previousFocus
    // 单行条只把此刻显示的一行交给读屏（它是导航栏链接的文字）
    if (this.options.strip && (focusChanged || this.teleport)) {
      this.views.forEach((view, i) => {
        if (i === this.state.focus && view.item.kind !== 'interlude')
          view.el.removeAttribute('aria-hidden')
        else
          view.el.setAttribute('aria-hidden', 'true')
      })
    }

    // 跳转后旧的消散颗粒与破碎碎片不再对应当前歌词
    if (this.teleport)
      this.debris.clear()
    // 聚光灯随特效开关；减少动态效果与手动滚动时不演出
    const spotlight = this.spotViews.size > 0 && this.display.effects && !this.reducedMotion && !this.manual && !this.options.strip ? spotlightAt(this.lyrics, timeMs) : null
    const spotView = spotlight ? this.spotViews.get(spotlight.line) ?? -1 : -1
    this.spot = spotView >= 0 && spotlight ? spotlight.level : 0
    // 换到另一句（或熄灭）时重新测量放大倍数
    if (spotView !== this.spotView)
      this.spotScale = null
    this.spotView = spotView
    const animating = this.layout(dt, now, focusChanged)
    const teleported = this.teleport
    this.teleport = false
    // 逐字效果隔帧重绘；跳转、换行或循环即将停下时（最后一帧）必须画
    const continuing = playing || animating || this.manual != null || teleported
    const detail = !continuing || teleported || focusChanged || now - this.lastDetail >= LYRIC_DETAIL_FRAME_MS
    if (detail)
      this.lastDetail = now
    this.paint(timeMs, detail)
    const debris = this.debris.step(playing ? dt : 0)

    if (continuing || (debris && playing))
      this.wake()
  }

  /**
   * 单行条的焦点始终是主唱行：优先此刻在唱的第一句主唱行（上一句的和声还没唱完、下一句已经开唱时跟到下一句）；
   * 只有背景和声在唱时为它所附着的主唱行
   */
  private stripFocus(focus: number): number {
    const main = this.state.active.find(line => !this.lyrics.lines[line]?.isBackground)
    if (main != null)
      return this.lineViews.get(main) ?? focus
    const owner = this.views[focus]?.owner ?? -1
    return owner >= 0 ? owner : focus
  }

  /**
   * 单行条放在下层的条目：焦点句附着的背景和声优先，其次是与焦点句同时在唱、离它最近的另一句（重叠的对唱、上一句没唱完的和声等）；
   * 容器太矮或没有时为 -1
   */
  private stripPairOf(focus: number): number {
    if (this.containerHeight < STRIP_TIER_MIN_HEIGHT_PX || this.items[focus]?.kind !== 'line')
      return -1
    let pair = -1
    for (const line of this.state.active) {
      const index = this.lineViews.get(line)
      if (index == null || index === focus)
        continue
      if (this.views[index].owner === focus)
        return index
      if (pair < 0 || Math.abs(index - focus) < Math.abs(pair - focus))
        pair = index
    }
    return pair
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

    // 单行条的背景和声不占位置：跟着所附着的主唱行，唱到时放在下层
    const heights = this.views.map(view => view.expand ? view.height * view.expand.position : this.options.strip && view.owner >= 0 ? 0 : view.height)
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

    // 单行条的上下两层：焦点句上移、缩小，同时在唱的另一句放在下层
    const strip = this.options.strip ?? false
    const pair = strip ? this.stripPairOf(focus) : -1
    this.stripPair = pair
    const center = (tops[focus] ?? 0) - scroll

    // 阶梯入场：焦点因播放推进而变化时，从视口内第一个条目开始逐个增加延迟
    let delay = 0
    let step = LYRIC_STAGGER_BASE_S
    const stagger = focusChanged && !jump && !this.manual

    for (let i = 0; i < this.views.length; i++) {
      const view = this.views[i]
      let target = tops[i] - scroll + spotShift + (spotView >= 0 && i !== spotView ? Math.sign(i - spotView) * spotSpread : 0)
      if (strip) {
        if (i === pair)
          target = center + STRIP_TIER_BOTTOM * this.containerHeight
        else if (i === focus && pair >= 0)
          target += STRIP_TIER_TOP * this.containerHeight
        // 没轮到的背景和声跟着所附着的主唱行（隐藏），唱到时原地淡入
        else if (view.owner >= 0)
          target = (tops[view.owner] ?? 0) - scroll + STRIP_TIER_BOTTOM * this.containerHeight
      }
      // 单行条按容器本身判断：移出的上一行不排队，新行立即移入
      const overscan = this.options.strip ? 0 : LYRIC_OVERSCAN_PX
      const onScreen = target + heights[i] > -overscan && target < this.containerHeight + overscan
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
      // 分层时焦点句与下层的主唱句缩小（背景和声本身字号更小，不再缩放）
      const tiered = pair >= 0 && (i === focus || (i === pair && view.owner < 0))
      const scaleTarget = tiered ? STRIP_TIER_SCALE : i === spotView ? baseScale + (spotScale - baseScale) * spot : baseScale
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

  private paint(timeMs: number, detail: boolean) {
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
        if (this.options.strip && view.owner >= 0) {
          const opacity = i === this.stripPair ? '' : '0'
          if (opacity !== view.opacity) {
            view.opacity = opacity
            view.el.style.opacity = opacity
          }
        }
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
        // 横向滚动只改合成层，逐帧更新；只算此刻在容器内的行
        if (view.marquee && y + view.height > 0 && y < this.containerHeight)
          this.paintMarquee(view.marquee, view.el, timeMs)
        if (!detail)
          continue
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
          const state = interludeDot(item.start, item.end, timeMs, index, view.dots.length, rhythmContext(this.lyrics.pace, this.rhythm))
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

  /**
   * 单行条的横向滚动：超出宽度的行跟随演唱位置（逐行歌词按行进度）匀变速地滚动，两侧按是否还有内容渐隐；
   * 唱完的行停在末尾，随弹簧移出时仍露出结尾。减少动态效果时不滚动，只渐隐右侧
   */
  private paintMarquee(marquee: StripMarquee, el: HTMLElement, timeMs: number) {
    const overflow = marquee.contentWidth - marquee.containerWidth
    const offset = overflow > 0 && !this.reducedMotion
      ? getLyricMarqueeOffset({
          line: marquee.line,
          nextLineStartTime: marquee.nextStart,
          currentTimeMs: timeMs,
          containerWidth: marquee.containerWidth,
          contentWidth: marquee.contentWidth,
          wordBoxes: this.lyrics.wordTimed ? marquee.boxes : undefined,
        })
      : 0
    const transform = offset > 0 ? `translate3d(${(-offset).toFixed(2)}px, 0, 0)` : ''
    if (transform !== marquee.transform) {
      marquee.transform = transform
      marquee.main.style.transform = transform
    }
    const mask = overflow > 0 ? stripFadeMask(offset > 0.5, offset < overflow - 0.5) : ''
    if (mask !== marquee.mask) {
      marquee.mask = mask
      el.style.maskImage = mask
      el.style.setProperty('-webkit-mask-image', mask)
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
    // 柔光持续到这一行结束
    const lineEnd = view.item.kind === 'line' ? this.lyrics.lines[view.item.line]?.end ?? 0 : 0
    for (const { group, chars } of view.emphasis) {
      // 特效节奏：跟随节拍时由拍点驱动（心跳、重音、柔光呼吸、波浪、抖动的调幅、流光），固定快慢时按固定周期；
      // 起落曲线、消散的时长按基准周期 T_b 换算（见 rhythm/effects.ts）
      const rhythm = rhythmContext(group.pace, this.rhythm)
      const pace = nearestFixedPace(rhythm)
      const duration = Math.max(LYRIC_EMPHASIS_MIN_MS, group.end - group.start) * envelopeScale(rhythm)
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
      // 流光的光带位置、心跳的强度、放大的拍上重音、柔光的门控与呼吸、抖动的调幅（整个词同步）；波浪每个字一个上浮
      const shine = group.effect === 'shimmer' ? shimmerCenter(rhythm, group.start, timeMs, count) : null
      const beat = group.effect === 'heartbeat' ? heartbeatLevel(rhythm, group.start, group.end, timeMs) : 0
      const accent = group.effect === 'swell' ? swellAccent(rhythm, group.start, timeMs) : 0
      const breath = group.effect === 'glow' ? glowLevel(rhythm, group.start, lineEnd || group.end, timeMs) : null
      const waves = wave ? waveLevels(rhythm, group.start, group.end, count, timeMs) : null
      const kick = group.effect === 'shake' && !hold ? shakeLevel(rhythm, group.start, group.start + duration, timeMs) : 0
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
          const dissolve = dissolveState(group.start, group.end, i, count, timeMs, this.seekAt, dissolveFadeMs(rhythm))
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
        // factor 为 0 的组（唱得太快的标注短语）只保留颜色、字体与字形，不做动效；柔光与波浪由拍驱动，起落曲线之外也会动
        const rise = waves?.[i] ?? 0
        if (f > 0 && (v > 0 || lift > 0 || (breath?.gate ?? 0) > 0 || rise > 0)) {
          let scale = 1
          let x = 0
          let y = -lift * (bg ? 0.1 : 0.05)
          let glow = 0
          let radius = 0.3
          if (group.effect === 'swell') {
            // 起落曲线上叠加拍上的重音；左右两侧的字向外轻推
            const k = v * (1 + rhythm.params.swell.gain * accent)
            scale = 1 + k * 0.14 * f
            x = -k * 0.03 * f * (count / 2 - i - 0.5)
            y -= k * 0.025 * f
            glow = v * (0.25 + 0.45 * f) * (1 + 0.4 * accent)
          }
          else if (group.effect === 'glow' && breath) {
            // 从开唱到行尾随拍呼吸
            scale = 1 + breath.gate * breath.y * 0.04 * f
            glow = breath.gate * (0.35 + 0.5 * f) * (0.3 + 0.7 * breath.y)
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
            // 每个字的相位不同；幅度随起落曲线，并在拍上「踢」一下再衰减
            const amp = v * (0.35 + 0.65 * kick)
            const phase = (timeMs - begin) / shakeCarrierMs(rhythm)
            x = Math.sin(phase * 2.3 + i * 1.7) * 0.035 * f * amp
            y += Math.cos(phase * 1.9 + i * 1.3) * 0.025 * f * amp
            scale = 1 + amp * 0.06 * f
            glow = amp * (0.15 + 0.25 * f)
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
            // 波浪：一拍内波峰从首字走到末字
            y = -rise * (0.08 + 0.14 * f)
            scale = 1 + rise * 0.05 * f
          }
          scale = 1 + (scale - 1) * growScale
          glow *= glowScale
          transform = `translate(${x.toFixed(3)}em, ${y.toFixed(3)}em) scale(${scale.toFixed(3)})`
          // 辉光强度按整数百分比写入：看不出的细微变化不重写 text-shadow（每次重写都要重绘这个字）
          const glowPercent = Math.round(glow * 100)
          if (glowPercent > 0)
            shadow = `0 0 ${radius}em color-mix(in srgb, ${tintColor ?? 'var(--lyric-glow, var(--lyric-accent, var(--lyric-color, #fff)))'} ${glowPercent}%, transparent)`
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
