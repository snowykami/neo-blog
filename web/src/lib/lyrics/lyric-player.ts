import type { LyricMarqueeKnot, LyricMarqueeWordBox } from './marquee'
import type { RhythmModel } from './rhythm/model'
import type { RubyMetrics } from './ruby-layout'
import type { StripLine, StripSlot } from './strip-slots'
import type { TimelineItem, TimelineState } from './timeline'
import type { LyricAgent, LyricEmphasis, LyricLine, LyricWord, ResolvedLyrics } from './types'
import { HDR_BRIGHTNESS, hdrColorUrl, hdrShimmerUrl, shimmerPosition } from '@/lib/hdr-color'
import { LYRIC_COLORS, MOOD_GLOW, resolveAgentHex } from './colors'
import {
  LYRIC_ALIGN_POSITION,
  LYRIC_ANIMATION_HEADSTART_MS,
  LYRIC_BG_COLLAPSED_SCALE,
  LYRIC_BG_EXPAND_SPRING,
  LYRIC_BLUR_MAX_PX,
  LYRIC_BLUR_NARROW_FACTOR,
  LYRIC_BLUR_PAST_PX,
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
  LYRIC_PRESS_SCALE,
  LYRIC_SCALE_SPRING,
  LYRIC_SCROLL_INACTIVE_ALPHA,
  LYRIC_SCROLL_INACTIVE_ALPHA_LINE_TIMED,
  LYRIC_SEEK_THRESHOLD_MS,
  LYRIC_STAGGER_BASE_S,
  LYRIC_STAGGER_DECAY,
  LYRIC_USER_SCROLL_HOLD_MS,
  LYRIC_WORD_FLOAT_EM,
} from './config'
import { swellCurve } from './easing'
import { interludeDots } from './interlude'
import { getBackgroundOwnerMap, getLyricLineAlign } from './line-utils'
import { LyricDebris } from './lyric-debris'
import { evaluateMarqueeKnots, getLyricMarqueeOffset, getWordMarqueeKnots } from './marquee'
import { PACE } from './pace'
import { dissolveFadeMs, envelopeScale, glowLevel, heartbeatLevel, nearestFixedPace, rhythmContext, shakeCarrierMs, shakeLevel, shimmerCenter, swellAccent, waveLevels } from './rhythm/effects'
import { placeRuby, rubyGroups, rubyText } from './ruby-layout'
import { Spring } from './spring'
import { spotlightAt } from './stage-effects'
import { placeStripLines } from './strip-slots'
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
  // 行不换行，超出宽度时跟随演唱位置横向滚动（见 marquee.ts 的 getLyricMarqueeOffset）。
  // 对唱行右对齐；容器足够高时，背景和声或与焦点句同时在唱的另一句放在下层，两位歌手同时唱三句及以上时分成四格（见 strip-slots.ts、STRIP_TIER_*）。
  // 不显示翻译与音译，没有聚光灯，不响应点击与滚动
  strip?: boolean
  // 这首歌的节拍模型，每帧读取；分析完成前或不可用时返回 null，动效回退到固定快慢（见 rhythm/effects.ts）
  getRhythm?: () => RhythmModel | null
}

export interface LyricPlayerDisplay {
  showTranslation: boolean
  showRomanization: boolean
  footerText: string
  // 无名合唱胶囊的兜底文案（多语言「合唱」 / Together）
  togetherLabel?: string
  // 强调特效（放大、辉光、波浪）；减少动态效果时始终关闭
  effects: boolean
  // HDR 高光：正在唱的字亮过 SDR 白（只在深色界面、屏幕支持 HDR 时开启，见 lib/hdr-color.ts）
  hdr: boolean
}

interface WordView {
  word: LyricWord
  el: HTMLElement
  width: number
  // 强调词四周留出的内边距（px）：放大的字与辉光不被擦除遮罩裁掉
  pad: number
  // 仅主文音节允许普通词上浮；振假名与逐字音译行只擦除不上浮（同 StarryPlayer liftsSyllables 规则）
  lifts: boolean
  // 是否已拆分为 .lyric-char 单字节点（即携带 .lyric-word--emphasis）
  split: boolean
  // 是否携带非零强度的强调动效（开启歌词特效时由 .lyric-char 自行上浮，不再叠加外层词上浮）
  emphasized: boolean
  mask: string
  // 高亮行中还没唱到的词：整体压暗（见 paintWords）
  opacity: string
  transform: string
}

/** 注音单元（底字上方可选振假名、下方可选逐字音译）：排版见 layoutRubyUnits 与 ruby-layout.ts 的 placeRuby */
interface RubyUnitView {
  el: HTMLElement
  furigana: HTMLElement | null
  furiganaParts: { el: HTMLElement, text: string }[]
  ruby: HTMLElement | null
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
  // HDR 高光下流光横条的位置（lyric-char--shine 的 --lyric-shine-x，见 lyric-player.css）；不在扫光时为空
  shine: string
  // 消散 / 破碎：已为这个时刻生成过颗粒或碎片（往回拖动进度后重新生成）
  debrisAt: number | null
}

/** 单行条中一行歌词的横向滚动：时间与各词位置（相对原文左边缘，测量时写入）及上次写入的位移与两侧渐隐 */
interface StripMarquee {
  main: HTMLElement
  line: LyricLine
  nextStart?: number
  boxes: LyricMarqueeWordBox[]
  // 按当前 containerWidth 缓存的逐字拉紧弦折点，避免逐帧重复构图；重测或宽度变化时失效
  knots: LyricMarqueeKnot[] | null
  knotsWidth: number
  // 行的左右内边距之和；可视宽度按此刻占整行还是半行（四格）计算
  padding: number
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
  main: HTMLElement | null
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
  // 单行条四格时占半行
  half: boolean
  // 新段落（TTML <div>）首行组在此条目之前留出额外间距
  gapBefore: boolean
  // 非单行条下的背景人声是否处于折叠不可点击态
  collapsed: boolean
  // 上次写入的样式，未变化时不重复写 DOM
  transform: string
  filter: string
  color: string
  opacity: string
  visible: boolean
  // 是否正在唱（lyric-line--active）、是否是聚光灯下的点题句（lyric-line--spot）：HDR 高光据此给字上色，见 lyric-player.css
  active: boolean
  spotlit: boolean
  // HDR 跨行退场：在 HDR_EXIT_MS 内保持静态已解码 HDR 素材不变，通过合成层 opacity 平滑过渡到非激活 SDR 亮度，避免瞬间熄灭与 WebKit 闪烁
  hdrExitStart: number | null
  hdrExitFromSpot: boolean
  hdrExiting: boolean
  mainOpacity: string
  // 多声部视觉装饰（边缘光丝与切换低语胶囊）：聚光灯亮起时同步让路淡出
  ornaments: HTMLElement[]
  ornamentOpacity: string
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

// HDR 高光的亮度见 lib/hdr-color.ts 的 HDR_BRIGHTNESS
// 聚光灯亮到这个程度时点题句换成更亮的一档（背景素材不能渐变，只能换档）
const HDR_SPOT_THRESHOLD = 0.5
// HDR 跨行切换时的平滑退场时长（ms，与 .lyric-line 的 color 0.4s ease-out 对齐）
const HDR_EXIT_MS = 400
// 流光光带在 HDR 高光下的颜色（同 SDR 下光带的暖白）
const HDR_SHINE_COLOR = '#fffae6'

/**
 * HDR 素材（线性亮度 gain 倍 SDR 白）在扩展 sRGB 合成层中的等效通道值：
 * 跨行退场期间保持已解码的静态 HDR 素材不变（避免逐帧生成 16 位 cICP PNG 触发 WebKit ImageIO 异步解码空帧闪烁），
 * 仅通过合成层 opacity 衰减；退场终点将不透明度压到 targetAlpha / esrgb(gain)，使切换回 SDR 文字的瞬间亮度连续无跳变
 */
function hdrExitEndAlpha(targetAlpha: number, gain: number): number {
  if (gain <= 1)
    return targetAlpha
  return targetAlpha / (1.055 * gain ** (1 / 2.4) - 0.055)
}

/**
 * 强调短语在 HDR 高光下的颜色：开始上色后固定为峰值的上色程度（色板颜色与白色混合，同 color-mix in srgb），不随演出或退场逐帧变化——
 * 每换一次颜色就换一张 16 位 PNG 素材，WebKit 异步解码未完成时透明文字会短暂消失闪烁；上色的起落与退场分别交给辉光与合成层不透明度表现
 */
function hdrTint(tintColor: string | null, tint: number) {
  if (!tintColor || tint <= 0.005)
    return '#fff'
  const t = EMPHASIS_TINT_PEAK
  const hex = /^#([0-9a-f]{6})$/i.exec(tintColor)?.[1]
  if (!hex)
    return tintColor
  return `#${[0, 2, 4].map(i => Math.round(255 * (1 - t) + Number.parseInt(hex.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('')}`
}

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
// TTML <div> 段落之间的额外间距（主字号倍数）
const PARAGRAPH_GAP_EM = 0.45
const PARAGRAPH_GAP_COMPACT_EM = 0.35

/**
 * 聚光灯放大倍数：不超过 max，且放大后文字不超出整行（缩放默认以行首为原点，对唱行以行尾为原点，合唱行以中心为原点）。
 * 按各文字节点相对整行的位置计算，与当前缩放无关
 */
function spotlightFit(el: HTMLElement, max: number): number {
  const box = el.getBoundingClientRect()
  if (box.width <= 0 || el.offsetWidth <= 0)
    return max
  const fromRight = el.classList.contains('lyric-line--duet')
  const centered = el.classList.contains('lyric-line--center')
  const centerX = (box.left + box.right) / 2
  const range = el.ownerDocument.createRange()
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let extent = 0
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest('.lyric-singer'))
      continue
    range.selectNodeContents(node)
    const rect = range.getBoundingClientRect()
    if (rect.width > 0) {
      extent = Math.max(
        extent,
        centered
          ? 2 * Math.max(centerX - rect.left, rect.right - centerX)
          : fromRight
            ? box.right - rect.left
            : rect.right - box.left,
      )
    }
  }
  // 留出行尾（合唱行留出两侧）的内边距
  const style = getComputedStyle(el)
  const padRight = (Number.parseFloat(style.paddingRight) || 0) * box.width / el.offsetWidth
  const padLeft = (Number.parseFloat(style.paddingLeft) || 0) * box.width / el.offsetWidth
  const avail = centered ? box.width - padLeft - padRight : fromRight ? box.width - padLeft : box.width - padRight
  return extent > 0 ? Math.max(1, Math.min(max, avail / extent)) : max
}

/** 群组/合唱多色解析：优先取成员色（≥2 位，最多 6 色），否则取曲目前两位独唱色，不足两位时退回群组自身颜色 */
function resolveGroupColors(agent: LyricAgent, agents: Record<string, LyricAgent>, soloAgents: LyricAgent[]): string[] {
  const seenIds = new Set<string>()
  const memberHexes: string[] = []
  for (const id of agent.members ?? []) {
    if (seenIds.has(id))
      continue
    seenIds.add(id)
    const member = agents[id]
    if (member)
      memberHexes.push(resolveAgentHex(member))
  }
  if (memberHexes.length >= 2)
    return memberHexes.slice(0, 6)
  const c1 = soloAgents[0] ? resolveAgentHex(soloAgents[0]) : resolveAgentHex(agent)
  const c2 = soloAgents[1] ? resolveAgentHex(soloAgents[1]) : resolveAgentHex(agent)
  return [c1, c2]
}

/**
 * 构建演唱者切换低语胶囊（Scheme A）：
 * - 群组/合唱：多圆点 + 群组名 / 成员名拼接 / 本地化合唱文案
 * - 有名独唱：单圆点 + 歌手名
 * - 无名独唱：≤2 位独唱完全省略（零占位文字）；≥3 位独唱仅渲染颜色圆点
 */
function buildSingerPill(
  doc: Document,
  agent: LyricAgent,
  agents: Record<string, LyricAgent>,
  soloAgents: LyricAgent[],
  soloCount: number,
  togetherLabel?: string,
): HTMLElement | null {
  const pill = doc.createElement('span')
  pill.className = 'lyric-singer'
  pill.setAttribute('aria-hidden', 'true')

  if (agent.isGroup) {
    const colors = resolveGroupColors(agent, agents, soloAgents)
    const dots = doc.createElement('span')
    dots.className = 'lyric-singer__dots'
    for (const hex of colors) {
      const dot = doc.createElement('span')
      dot.className = 'lyric-singer__dot'
      dot.style.backgroundColor = hex
      dot.style.setProperty('--dot-color', hex)
      dots.append(dot)
    }
    pill.append(dots)

    let text = agent.name
    let isTogetherFallback = false
    if (!text) {
      const members = agent.members ?? []
      if (members.length >= 2 && members.every(id => Boolean(agents[id]?.name))) {
        text = members.map(id => agents[id]!.name!).join(' · ')
      }
      else {
        text = togetherLabel || 'Together'
        isTogetherFallback = true
      }
    }
    const label = doc.createElement('span')
    label.className = 'lyric-singer__label'
    if (isTogetherFallback)
      label.dataset.together = '1'
    label.textContent = text
    pill.append(label)
    return pill
  }

  const dot = doc.createElement('span')
  dot.className = 'lyric-singer__dot'
  const hex = resolveAgentHex(agent)
  dot.style.backgroundColor = hex
  dot.style.setProperty('--dot-color', hex)

  if (agent.name) {
    const label = doc.createElement('span')
    label.className = 'lyric-singer__label'
    label.textContent = agent.name
    pill.append(dot, label)
    return pill
  }

  if (soloCount <= 2)
    return null

  pill.classList.add('lyric-singer--dot-only')
  pill.append(dot)
  return pill
}

/**
 * 一行歌词的不透明度与模糊（px）：
 * - 焦点行、正在唱的行与鼠标悬停行清晰（0px）
 * - 非对称模糊：已唱行统一温和模糊 3px，待唱行按距焦点的行距递增（1 + 距离，上限 4px）
 * - 聚光灯亮起时（spot 为强度 0 ~ 1，spotted 为点题句本身）其余行变淡、变虚，但正在唱与焦点行保持原样（见 spec 7.2k）
 * - noBlur（减少动态效果、手动滚动）时不模糊；blurFactor 为窄视口与紧凑模式的模糊系数
 */
export function lineAppearance({ active, distance, past = false, hovered = false, spotted, spot, inactiveAlpha, blurFactor, noBlur }: {
  active: boolean
  distance: number
  past?: boolean
  hovered?: boolean
  spotted: boolean
  spot: number
  inactiveAlpha: number
  blurFactor: number
  noBlur: boolean
}): { alpha: number, blur: number } {
  const alpha = active ? 1 : inactiveAlpha
  const clear = active || distance === 0
  // 聚光灯只压低不在唱的其余行
  const dimmed = spot > 0 && !spotted && !clear
  const baseBlur = past ? LYRIC_BLUR_PAST_PX : Math.min(LYRIC_BLUR_MAX_PX, 1 + distance)
  return {
    alpha: dimmed ? alpha + (Math.min(alpha, SPOTLIGHT_OTHERS_ALPHA) - alpha) * spot : alpha,
    blur: noBlur || clear || hovered ? 0 : Math.max(baseBlur, dimmed ? SPOTLIGHT_BLUR_PX * spot : 0) * blurFactor,
  }
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

// 单行条的上下两层：背景和声或与焦点句同时在唱的另一句（重叠的对唱等）放在下层，两位歌手同时唱三句及以上时分成四格（见 strip-slots.ts）。
// 容器至少这么高才分层（导航栏 36px 可以，单曲卡 20px 不分层）；
// 上层句上移、缩小，下层句下移（按容器高度的比例）；背景和声的字号见 lyric-player.css（0.72em），重叠的主唱句与焦点句同样缩小
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
 * 排版一行的注音单元（上方日文振假名 + 下方逐字音译）：
 * - 先清除上次的外边距再测量宽度；
 * - 振假名比底字宽时，两侧按超出宽度的一半撑开（spec 8.5），并居中于底字上方；
 * - 逐字音译可见时，再调用 placeRuby 防止相邻音译重叠（与振假名的左撑开叠加）
 */
function layoutRubyUnits(units: RubyUnitView[], showRomanization: boolean) {
  for (const unit of units) {
    unit.el.style.marginLeft = ''
    unit.el.style.marginRight = ''
    if (unit.furigana)
      unit.furigana.style.marginLeft = ''
    if (unit.ruby)
      unit.ruby.style.marginLeft = ''
  }
  if (units.length === 0)
    return
  const furiPads = units.map((unit) => {
    if (!unit.furigana || unit.furiganaParts.length === 0)
      return 0
    const charWidth = textWidth(unit.word, unit.wordText) ?? unit.word.offsetWidth
    const furiWidth = unit.furiganaParts.reduce((sum, part) => sum + (textWidth(part.el, part.text) ?? 0), 0)
    const pad = Math.max(0, (furiWidth - charWidth) / 2)
    if (pad > 0) {
      unit.el.style.marginLeft = `${pad.toFixed(1)}px`
      unit.el.style.marginRight = `${pad.toFixed(1)}px`
    }
    unit.furigana.style.marginLeft = `${((charWidth - furiWidth) / 2).toFixed(1)}px`
    return pad
  })
  if (!showRomanization)
    return
  const romanItems = units
    .map((unit, index) => ({ unit, index }))
    .filter((item): item is { unit: RubyUnitView & { ruby: HTMLElement }, index: number } => item.unit.ruby != null && item.unit.parts.length > 0)
  if (romanItems.length === 0)
    return
  const metrics: RubyMetrics[] = romanItems.map(({ unit }) => {
    const firstWidth = textWidth(unit.parts[0].el, unit.parts[0].text) ?? 0
    return {
      left: unit.el.offsetLeft,
      top: unit.el.offsetTop,
      charWidth: textWidth(unit.word, unit.wordText) ?? unit.word.offsetWidth,
      firstWidth,
      rubyWidth: unit.parts.reduce((sum, part, i) => sum + (i === 0 ? firstWidth : textWidth(part.el, part.text) ?? 0), 0),
    }
  })
  const gap = RUBY_GAP_EM * (Number.parseFloat(getComputedStyle(romanItems[0].unit.ruby).fontSize) || 10)
  placeRuby(metrics, gap).forEach(({ shift, offset }, k) => {
    const { unit, index } = romanItems[k]
    const totalLeft = furiPads[index] + shift
    if (totalLeft > 0)
      unit.el.style.marginLeft = `${totalLeft.toFixed(1)}px`
    unit.ruby.style.marginLeft = `${offset.toFixed(1)}px`
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
      chars.push({ el: charEl, transform: '', shadow: '', color: '', filter: '', line: '', background: '', opacity: '', shine: '', debrisAt: null, start: timing.start + step * k, end: timing.start + step * (k + 1) })
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
  private display: LyricPlayerDisplay = { showTranslation: true, showRomanization: true, footerText: '', effects: true, hdr: false }
  private state: TimelineState = { active: [], focus: 0, interlude: null }
  private activeLines = new Set<number>()
  // 聚光灯：点题句的行号到条目的映射、此刻演出的条目（没有时为 -1）、当前强度与放大倍数上限（开始亮起时按文字宽度测量）
  private spotViews = new Map<number, number>()
  private spotView = -1
  private spot = 0
  // HDR 高光下按点题句亮度显示的条目（没有时为 -1）：聚光灯亮过一半时的那一句；单行条不演出聚光灯，只按聚光灯的时段换亮度
  private hdrSpotView = -1
  private spotScale: number | null = null
  // 行号到条目的映射；单行条此刻分层（或分成四格）显示的条目与位置，焦点句单独在唱时为空
  private lineViews = new Map<number, number>()
  private stripSlots = new Map<number, StripSlot>()

  private containerWidth = 0
  private containerHeight = 0
  private narrow = false
  private fontSize = 16
  private layoutDirty = true
  private teleport = true
  private reducedMotion = prefersReducedMotion()

  private rafId = 0
  private lastFrame = 0
  // 暂停期间不跑逐帧循环（见 setPaused）
  private paused = false
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
  // 鼠标悬停与指针按压中的条目下标（没有为 -1）
  private hoveredView = -1
  private pressedView = -1

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
          ['pointerleave', this.onPointerLeave as EventListener],
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
    this.container.classList.remove('lyric-player', 'lyric-player--compact', 'lyric-player--strip', 'lyric-player--no-roman', 'lyric-player--no-webfonts', 'lyric-player--hdr', 'lyric-player--multi-vocal')
    this.container.style.removeProperty('--lyric-hdr')
    this.container.style.removeProperty('--lyric-hdr-spot')
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
    const multiVocal = Boolean(lyrics.agents && Object.keys(lyrics.agents).length > 0) || lyrics.lines.some(line => getLyricLineAlign(line) !== 'left')
    this.container.classList.toggle('lyric-player--multi-vocal', multiVocal)
    this.items = buildTimeline(lyrics.lines)
    this.debris.clear()
    this.manual = null
    this.hoveredView = -1
    this.pressedView = -1
    this.lastTimeMs = null
    this.build()
  }

  setDisplay(display: LyricPlayerDisplay) {
    const { showTranslation, showRomanization, footerText, togetherLabel, effects, hdr } = this.display
    this.display = display
    // HDR 高光开关时强调词的字从头重写样式（背景、辉光的画法不同）
    if ((effects && !display.effects) || display.hdr !== hdr)
      this.views.forEach(view => this.resetEmphasis(view))
    // 碎屑（消散、破碎）刚出现时亮过 SDR 白、随时间熄灭（见 lyric-debris.ts）
    this.debris.setHdr(display.hdr ? HDR_BRIGHTNESS.debris : 1)
    if (display.hdr !== hdr) {
      if (!display.hdr)
        this.views.forEach(view => this.clearHdrExit(view))
      this.container.classList.toggle('lyric-player--hdr', display.hdr)
      for (const [name, gain] of [['--lyric-hdr', HDR_BRIGHTNESS.lyric], ['--lyric-hdr-spot', this.spotGain()]] as const) {
        const url = display.hdr ? hdrColorUrl('#fff', gain) : null
        if (url)
          this.container.style.setProperty(name, `url("${url}")`)
        else
          this.container.style.removeProperty(name)
      }
    }
    if (display.footerText !== footerText) {
      const footer = this.views.at(-1)
      if (footer?.item.kind === 'footer')
        footer.el.textContent = display.footerText
    }
    if (display.togetherLabel !== togetherLabel) {
      const nextTogether = display.togetherLabel || 'Together'
      this.views.forEach((view) => {
        view.el.querySelectorAll<HTMLElement>('.lyric-singer__label[data-together="1"]').forEach((label) => {
          label.textContent = nextTogether
        })
      })
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

  /**
   * 暂停 / 恢复逐帧循环：暂停时画面停在此刻，期间的唤醒都不生效；恢复时直接跳到此刻的进度（不补播期间的换行动画）。
   * 用于同一首歌的另一套歌词引擎正在显示时（如顶栏灵动岛的胶囊藏在悬浮播放器后面），不让两套同时逐帧运行
   */
  setPaused(paused: boolean) {
    if (paused === this.paused)
      return
    this.paused = paused
    if (paused) {
      cancelAnimationFrame(this.rafId)
      this.rafId = 0
      return
    }
    this.teleport = true
    this.wake()
  }

  /** 唤醒逐帧循环：播放状态、进度、尺寸变化时调用 */
  wake() {
    if (this.rafId || this.paused)
      return
    this.lastFrame = performance.now()
    this.rafId = requestAnimationFrame(this.frame)
  }

  // ---------- 构建 ----------

  private build() {
    const doc = this.container.ownerDocument
    const lineTimed = !this.lyrics.wordTimed
    const agents = this.lyrics.agents
    const soloAgents = agents ? Object.values(agents).filter(agent => !agent.isGroup) : []
    const soloCount = soloAgents.length
    const bgOwners = getBackgroundOwnerMap(this.lyrics.lines)
    let prevMainAgent: string | undefined
    this.views = this.items.map((item, itemIndex) => {
      const view: ItemView = {
        item,
        el: doc.createElement(item.kind === 'line' && !this.options.strip ? 'button' : 'div'),
        main: null,
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
        half: false,
        gapBefore: false,
        collapsed: false,
        transform: '',
        filter: '',
        color: '',
        opacity: '',
        visible: true,
        active: false,
        spotlit: false,
        hdrExitStart: null,
        hdrExitFromSpot: false,
        hdrExiting: false,
        mainOpacity: '',
        ornaments: [],
        ornamentOpacity: '',
      }
      const { el } = view
      el.classList.add('lyric-item')
      if (item.kind === 'line') {
        const line = this.lyrics.lines[item.line]
        const ownerLine = line.isBackground ? bgOwners.get(item.line) : undefined
        const align = line.isBackground && line.align == null && !line.isDuet && ownerLine != null
          ? getLyricLineAlign(this.lyrics.lines[ownerLine])
          : getLyricLineAlign(line)
        if (!this.options.strip)
          el.setAttribute('type', 'button')
        el.classList.add('lyric-line')
        if (align === 'right')
          el.classList.add('lyric-line--duet')
        else if (align === 'center')
          el.classList.add('lyric-line--center')
        if (line.paragraphStart)
          el.classList.add('lyric-line--para')
        if (line.isBackground) {
          el.classList.add('lyric-line--bg')
          if (!this.options.strip) {
            view.expand = new Spring(0, LYRIC_BG_EXPAND_SPRING)
            view.scale.jump(LYRIC_BG_COLLAPSED_SCALE)
            view.collapsed = true
            el.classList.add('lyric-line--collapsed')
            el.setAttribute('aria-hidden', 'true')
            view.opacity = '0'
            el.style.opacity = '0'
          }
        }
        el.dataset.start = String(line.start)
        const main = doc.createElement('span')
        main.className = 'lyric-main'
        view.main = main
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
            const emphasized = group >= 0 && view.emphasis[group].group.factor > 0
            return { word, el: wordEl, width: 0, pad: 0, lifts: true, split: group >= 0, emphasized, mask: '', opacity: '', transform: '' }
          })
          view.words = [...mainWords, ...this.buildWords(main, line, mainWords, view.rubyUnits, (index) => {
            const group = groupOf(index)
            return group >= 0 ? rubyEmphasis[group] : null
          })]
          view.emphasis.push(...rubyEmphasis.filter(item => item.chars.length > 0))
        }
        if (line.mood)
          el.style.setProperty('--lyric-glow', MOOD_GLOW[line.mood])
        if (!line.isBackground && !this.options.strip) {
          const switched = line.agent !== prevMainAgent || Boolean(line.paragraphStart)
          prevMainAgent = line.agent
          const agent = agents && line.agent ? agents[line.agent] : undefined
          if (agent && agents) {
            const colors = agent.isGroup ? resolveGroupColors(agent, agents, soloAgents) : [resolveAgentHex(agent)]
            const hex1 = colors[0]
            el.style.setProperty('--singer-color', hex1)
            if (agent.isGroup) {
              el.style.setProperty('--singer-color-2', colors[colors.length - 1])
              el.style.setProperty('--singer-edge-gradient', `linear-gradient(90deg, ${colors.join(', ')})`)
              if (colors.length > 2)
                el.style.setProperty('--singer-edge-width', '3.25rem')
            }
            // 色道隔离：不染字色；无情绪标注时把默认微光淡淡拉向歌手色温度
            if (!line.mood)
              el.style.setProperty('--lyric-glow', `color-mix(in srgb, ${hex1} 38%, #ffffff)`)
            const edge = doc.createElement('span')
            edge.className = 'lyric-edge'
            edge.setAttribute('aria-hidden', 'true')
            el.append(edge)
            view.ornaments.push(edge)
            if (switched) {
              const pill = buildSingerPill(doc, agent, agents, soloAgents, soloCount, this.display.togetherLabel)
              if (pill) {
                el.append(pill)
                view.ornaments.push(pill)
              }
            }
          }
        }
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
        const nextMain = this.items.slice(itemIndex + 1).find(candidate => candidate.kind === 'line' && !this.lyrics.lines[candidate.line]?.isBackground)
        if (nextMain?.kind === 'line') {
          const nextAlign = getLyricLineAlign(this.lyrics.lines[nextMain.line])
          if (nextAlign === 'right')
            el.classList.add('lyric-interlude--duet')
          else if (nextAlign === 'center')
            el.classList.add('lyric-interlude--center')
        }
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
    // 行号到条目的映射，支持前置（above）与后置（below）背景人声附着到所属主唱行
    this.lineViews = new Map()
    this.views.forEach((view, index) => {
      if (view.item.kind === 'line')
        this.lineViews.set(view.item.line, index)
    })
    this.views.forEach((view) => {
      if (view.item.kind !== 'line' || !this.lyrics.lines[view.item.line]?.isBackground)
        return
      const ownerLine = bgOwners.get(view.item.line)
      if (ownerLine != null)
        view.owner = this.lineViews.get(ownerLine) ?? -1
    })
    // TTML <div> 段落首行额外间距标记在所属行组的最早条目上（避免插在前置背景行与主唱行之间；首句行组不加段落间距）
    const firstLineView = this.views.findIndex(view => view.item.kind === 'line')
    const groupFirstView = new Map<number, number>()
    this.views.forEach((view, index) => {
      if (view.item.kind !== 'line')
        return
      const groupMainView = view.owner >= 0 ? view.owner : index
      const prev = groupFirstView.get(groupMainView)
      if (prev == null || index < prev)
        groupFirstView.set(groupMainView, index)
    })
    this.views.forEach((view, index) => {
      if (view.item.kind === 'line' && this.lyrics.lines[view.item.line]?.paragraphStart) {
        const startView = groupFirstView.get(index) ?? index
        if (startView > firstLineView)
          this.views[startView].gapBefore = true
        else
          view.el.classList.remove('lyric-line--para')
      }
    })
    this.stripSlots = new Map()
    const spotlights = new Set(this.lyrics.spotlights)
    this.spotViews = new Map()
    this.views.forEach((view, index) => {
      if (view.item.kind === 'line' && spotlights.has(view.item.line))
        this.spotViews.set(view.item.line, index)
    })
    this.spotView = -1
    this.hdrSpotView = -1
    this.container.querySelectorAll(':scope > .lyric-item').forEach(el => el.remove())
    this.container.append(...this.views.map(view => view.el))
    this.layoutDirty = true
    this.teleport = true
    this.wake()
  }

  /**
   * 把原文的词放进主行；有上方振假名（word.ruby，非 strip 模式）或下方逐字音译（line.romanizationWords）时，
   * 组成注音单元（单元记入 units，测量时排版，见 layoutRubyUnits），振假名各假名与音译各分段均作为可擦除的词返回，按各自时间逐段擦除。
   * emphasisOf 返回某个音节所在强调组的音译部分（不强调时为 null），注在强调音节下的音译段拆成单字放入其中，并带上该组的字体与字形
   */
  private buildWords(main: HTMLElement, line: ResolvedLyrics['lines'][number], mainWords: WordView[], units: RubyUnitView[], emphasisOf: (index: number) => EmphasisView | null): WordView[] {
    const doc = this.container.ownerDocument
    const parts = line.romanizationWords ?? []
    const hasFurigana = !this.options.strip && line.words.some(word => (word.ruby?.length ?? 0) > 0)
    if (parts.length === 0 && !hasFurigana) {
      main.append(...mainWords.map(word => word.el))
      return []
    }
    // 每个字一个注音单元：上方可选振假名、下方可选逐字音译（音译显示时去掉标点与空白，见 ruby-layout.ts）
    const groups = new Map(rubyGroups(parts).map(group => [group.word, group.parts]))
    const extraWords: WordView[] = []
    mainWords.forEach((mainWord, index) => {
      const furiganaList = !this.options.strip ? mainWord.word.ruby : undefined
      const group = groups.get(index)
      if ((!furiganaList || furiganaList.length === 0) && !group) {
        main.append(mainWord.el)
        return
      }
      const unitEl = doc.createElement('span')
      unitEl.className = 'lyric-unit'
      let furiganaEl: HTMLElement | null = null
      const furiganaParts: RubyUnitView['furiganaParts'] = []
      if (furiganaList && furiganaList.length > 0) {
        unitEl.classList.add('lyric-unit--furigana')
        furiganaEl = doc.createElement('span')
        furiganaEl.className = 'lyric-furigana'
        for (const item of furiganaList) {
          const el = doc.createElement('span')
          el.className = 'lyric-word'
          el.textContent = item.text
          furiganaEl.append(el)
          furiganaParts.push({ el, text: item.text })
          extraWords.push({ word: { text: item.text, start: item.start, end: item.end }, el, width: 0, pad: 0, lifts: false, split: false, emphasized: false, mask: '', opacity: '', transform: '' })
        }
        unitEl.append(furiganaEl)
      }
      unitEl.append(mainWord.el)
      let ruby: HTMLElement | null = null
      const unitParts: RubyUnitView['parts'] = []
      if (group) {
        ruby = doc.createElement('span')
        ruby.className = 'lyric-ruby'
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
          extraWords.push({ word: { text, start: part.start, end: part.end }, el, width: 0, pad: 0, lifts: false, split: Boolean(emphasis), emphasized: false, mask: '', opacity: '', transform: '' })
        }
        unitEl.append(ruby)
      }
      main.append(unitEl)
      units.push({ el: unitEl, furigana: furiganaEl, furiganaParts, ruby, word: mainWord.el, wordText: mainWord.word.text, parts: unitParts })
    })
    return extraWords
  }

  /** 单行条一行歌词的横向滚动数据：直接引用当前 LyricLine，下一行为之后最近的主唱行 */
  private buildMarquee(main: HTMLElement, index: number): StripMarquee {
    return {
      main,
      line: this.lyrics.lines[index],
      nextStart: this.lyrics.lines.slice(index + 1).find(next => !next.isBackground)?.start,
      boxes: [],
      knots: null,
      knotsWidth: -1,
      padding: 0,
      contentWidth: 0,
      transform: '',
      mask: '',
    }
  }

  private measure() {
    this.containerWidth = this.container.clientWidth
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
        // 强调词四周、HDR 高光下所有词左右留有内边距（见 lyric-player.css）
        word.pad = view.emphasis.length > 0 || this.display.hdr ? Number.parseFloat(getComputedStyle(word.el).paddingLeft) || 0 : 0
      }
      const marquee = view.marquee
      if (marquee) {
        // 可视宽度为行的内容区（见 paintMarquee）；词的位置相对原文左边缘（offsetLeft 不受位移影响），去掉强调词四周的内边距
        const style = getComputedStyle(view.el)
        marquee.padding = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0)
        marquee.contentWidth = marquee.main.offsetWidth
        marquee.boxes = view.words.slice(0, marquee.line.words.length).map(word => ({
          left: word.el.offsetLeft - marquee.main.offsetLeft + word.pad,
          width: Math.max(0, word.width - word.pad * 2),
        }))
        marquee.knots = null
        marquee.knotsWidth = -1
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
    if (this.options.strip) {
      const lit = this.display.hdr && this.spotViews.size > 0 && this.display.effects ? spotlightAt(this.lyrics, timeMs) : null
      this.hdrSpotView = lit && lit.level >= HDR_SPOT_THRESHOLD ? this.spotViews.get(lit.line) ?? -1 : -1
    }
    else {
      this.hdrSpotView = this.spot >= HDR_SPOT_THRESHOLD ? spotView : -1
    }
    const animating = this.layout(dt, now, focusChanged)
    const teleported = this.teleport
    this.teleport = false
    const hdrExitingAny = this.updateHdrExits(now, teleported)
    // 逐字效果隔帧重绘；跳转、换行、HDR 跨行退场或循环即将停下时（最后一帧）必须画
    const continuing = playing || animating || hdrExitingAny || this.manual != null || teleported
    const detail = !continuing || teleported || focusChanged || now - this.lastDetail >= LYRIC_DETAIL_FRAME_MS
    if (detail)
      this.lastDetail = now
    this.paint(timeMs, now, detail)
    const debris = this.debris.step(playing ? dt : 0)

    if (continuing || (debris && playing))
      this.wake()
  }

  /** 非单行条下背景人声是否处于展开窗口（自身或所属主唱行正在唱） */
  private isBgExpanded(index: number): boolean {
    const view = this.views[index]
    if (!view || view.item.kind !== 'line' || view.owner < 0)
      return false
    if (this.activeLines.has(view.item.line))
      return true
    const ownerView = this.views[view.owner]
    return ownerView?.item.kind === 'line' && this.activeLines.has(ownerView.item.line)
  }

  /** 行是否按高亮态渲染（正在唱，或非单行条下随所属主行展开的背景人声） */
  private isLineRenderActive(index: number): boolean {
    const view = this.views[index]
    if (!view || view.item.kind !== 'line')
      return false
    return this.activeLines.has(view.item.line) || (!this.options.strip && view.owner >= 0 && this.isBgExpanded(index))
  }

  /** 计算各条目的当前高度、纵向起点（含段落间距）与总高度 */
  private computeTops(): { heights: number[], tops: number[], total: number } {
    const heights = this.views.map(view => view.expand ? view.height * view.expand.position : this.options.strip && view.owner >= 0 ? 0 : view.height)
    const paraGap = this.options.strip
      ? 0
      : (this.options.compact ? PARAGRAPH_GAP_COMPACT_EM : PARAGRAPH_GAP_EM) * this.fontSize
    const tops: number[] = []
    let total = 0
    for (let i = 0; i < this.views.length; i++) {
      const view = this.views[i]
      if (view.gapBefore && paraGap > 0) {
        const prev = this.views[i - 1]
        const interludeRatio = prev?.item.kind === 'interlude' ? 1 - (prev.expand?.position ?? 0) : 1
        // 该行已带有切换胶囊时胶囊自身已留出上方呼吸空间，不再全额叠加段落间距
        const pillScale = view.ornaments.length > 1 ? 0.35 : 1
        total += paraGap * interludeRatio * pillScale
      }
      tops.push(total)
      total += heights[i]
    }
    return { heights, tops, total }
  }

  /** 更新各行的 HDR 跨行退场计时，返回是否有行仍处于退场窗口内 */
  private updateHdrExits(now: number, teleported: boolean): boolean {
    let any = false
    for (let i = 0; i < this.views.length; i++) {
      const view = this.views[i]
      if (view.item.kind !== 'line')
        continue
      const active = this.isLineRenderActive(i)
      if (!this.display.hdr || teleported || this.reducedMotion || active) {
        view.hdrExitStart = null
      }
      else if (view.active && view.hdrExitStart == null) {
        view.hdrExitStart = now
        view.hdrExitFromSpot = view.spotlit
      }
      else if (view.hdrExitStart != null && now - view.hdrExitStart >= HDR_EXIT_MS) {
        view.hdrExitStart = null
      }
      if (view.hdrExitStart != null)
        any = true
    }
    return any
  }

  private clearHdrExit(view: ItemView) {
    view.hdrExitStart = null
    view.hdrExitFromSpot = false
    if (view.hdrExiting) {
      view.hdrExiting = false
      view.el.classList.remove('lyric-line--hdr-exit')
    }
    if (view.spotlit && !view.active) {
      view.spotlit = false
      view.el.classList.remove('lyric-line--spot')
    }
    if (view.mainOpacity && view.main) {
      view.mainOpacity = ''
      view.main.style.opacity = ''
    }
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

  /** 单行条此刻分层（或分成四格）显示的条目与位置（见 strip-slots.ts）；容器太矮或焦点不是歌词行时为空 */
  private stripSlotsOf(focus: number): Map<number, StripSlot> {
    if (this.containerHeight < STRIP_TIER_MIN_HEIGHT_PX || this.items[focus]?.kind !== 'line')
      return new Map()
    const stripLine = (index: number): StripLine => {
      const item = this.items[index]
      const line = item.kind === 'line' ? this.lyrics.lines[item.line] : undefined
      return { index, duet: !!line?.isDuet, background: !!line?.isBackground, ownedByFocus: this.views[index].owner === focus }
    }
    const others: StripLine[] = []
    for (const line of this.state.active) {
      const index = this.lineViews.get(line)
      if (index != null && index !== focus)
        others.push(stripLine(index))
    }
    return placeStripLines(stripLine(focus), others)
  }

  /** 计算各条目的目标位置并推进弹簧；返回是否仍有动画在进行 */
  private layout(dt: number, now: number, focusChanged: boolean): boolean {
    const jump = this.teleport || this.reducedMotion
    let animating = false

    // 间奏与非单行条背景人声展开 / 收起（影响后续条目的位置）
    for (let i = 0; i < this.views.length; i++) {
      const view = this.views[i]
      const { expand } = view
      if (!expand)
        continue
      const target = view.item.kind === 'interlude'
        ? (this.state.interlude === i ? 1 : 0)
        : (this.isBgExpanded(i) ? 1 : 0)
      if (jump)
        expand.jump(target)
      else
        expand.setTarget(target)
      expand.step(dt)
      animating ||= !expand.resting
      if (view.item.kind === 'line') {
        const collapsed = target === 0 && expand.position < 0.02
        if (collapsed !== view.collapsed) {
          view.collapsed = collapsed
          view.el.classList.toggle('lyric-line--collapsed', collapsed)
          if (collapsed)
            view.el.setAttribute('aria-hidden', 'true')
          else
            view.el.removeAttribute('aria-hidden')
        }
      }
    }

    const { heights, tops, total } = this.computeTops()

    // 自动对齐：焦点条目的中心对齐到固定位置；间奏按展开后的高度计算，避免展开过程中目标漂移
    const focus = this.state.focus
    const focusHeight = this.views[focus]?.item.kind === 'interlude' ? this.interludeHeight : heights[focus] ?? 0
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

    // 单行条的上下两层：焦点句上移、缩小，同时在唱的另一句放在下层；两位歌手同时唱三句及以上时分成四格，每句占半行
    const strip = this.options.strip ?? false
    const slots = strip ? this.stripSlotsOf(focus) : this.stripSlots
    this.stripSlots = slots
    const center = (tops[focus] ?? 0) - scroll

    // 阶梯入场：焦点因播放推进而变化时，从视口内第一个条目开始逐个增加延迟
    let delay = 0
    let step = LYRIC_STAGGER_BASE_S
    const stagger = focusChanged && !jump && !this.manual

    for (let i = 0; i < this.views.length; i++) {
      const view = this.views[i]
      let target = tops[i] - scroll + spotShift + (spotView >= 0 && i !== spotView ? Math.sign(i - spotView) * spotSpread : 0)
      const slot = slots.get(i)
      if (strip) {
        if (slot)
          target = center + (slot.row === 'top' ? STRIP_TIER_TOP : STRIP_TIER_BOTTOM) * this.containerHeight
        // 没轮到的背景和声跟着所附着的主唱行（隐藏），唱到时原地淡入
        else if (view.owner >= 0)
          target = (tops[view.owner] ?? 0) - scroll + STRIP_TIER_BOTTOM * this.containerHeight
        // 四格时占半行：主唱在左、对唱在右（见 lyric-player.css），宽度不做过渡
        const half = slot?.half ?? false
        if (half !== view.half) {
          view.half = half
          view.el.classList.toggle('lyric-line--half', half)
        }
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
      const bgLine = !strip && view.owner >= 0 && view.expand != null
      const baseScale = bgLine
        ? (this.isBgExpanded(i) ? 1 : LYRIC_BG_COLLAPSED_SCALE)
        : view.item.kind === 'line' && !highlighted
          ? LYRIC_INACTIVE_SCALE
          : 1
      // 分层时上下两层的主唱句缩小（背景和声本身字号更小，不再缩放）
      const tiered = slot != null && view.owner < 0
      let scaleTarget = tiered ? STRIP_TIER_SCALE : i === spotView ? baseScale + (spotScale - baseScale) * spot : baseScale
      if (!strip && i === this.pressedView)
        scaleTarget *= LYRIC_PRESS_SCALE
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

  private paint(timeMs: number, now: number, detail: boolean) {
    const focus = this.state.focus
    const spot = this.spot
    const hdrDim = this.display.hdr ? HDR_BRIGHTNESS.dim : 1
    const scrolling = this.manual != null && !this.options.strip
    // 高亮行内未唱词保持基础对比度；手动滚动期间非激活行整体提亮便于浏览
    const wordDimAlpha = (this.lyrics.wordTimed ? LYRIC_INACTIVE_ALPHA : LYRIC_INACTIVE_ALPHA_LINE_TIMED) * hdrDim
    const inactiveAlpha = (scrolling
      ? (this.lyrics.wordTimed ? LYRIC_SCROLL_INACTIVE_ALPHA : LYRIC_SCROLL_INACTIVE_ALPHA_LINE_TIMED)
      : (this.lyrics.wordTimed ? LYRIC_INACTIVE_ALPHA : LYRIC_INACTIVE_ALPHA_LINE_TIMED)) * hdrDim
    const blurFactor = (this.narrow ? LYRIC_BLUR_NARROW_FACTOR : 1) * (this.options.compact ? COMPACT_BLUR_FACTOR : 1)
    const noBlur = this.reducedMotion || this.manual != null
    const feather = LYRIC_FEATHER_EM * this.fontSize

    // 视觉行号：跳过折叠隐藏中的间奏与背景人声，避免虚拟高度为 0 的条目拉大行距模糊档位
    const visualIndex: number[] = []
    let visibleIdx = 0
    for (let i = 0; i < this.views.length; i++) {
      visualIndex.push(visibleIdx)
      const view = this.views[i]
      const hiddenCollapsed = view.item.kind === 'interlude'
        ? this.state.interlude !== i
        : (!this.options.strip && view.owner >= 0 && !this.isBgExpanded(i) && (view.expand?.position ?? 0) < 0.02)
      if (!hiddenCollapsed)
        visibleIdx++
    }
    const focusVisual = visualIndex[focus] ?? 0

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
          const opacity = this.stripSlots.has(i) ? '' : '0'
          if (opacity !== view.opacity) {
            view.opacity = opacity
            view.el.style.opacity = opacity
          }
        }
        else if (!this.options.strip && view.owner >= 0) {
          const opacity = (0.75 * (view.expand?.position ?? 0)).toFixed(3)
          if (opacity !== view.opacity) {
            view.opacity = opacity
            view.el.style.opacity = opacity
          }
        }
        const active = this.isLineRenderActive(i)
        const hdrExiting = view.hdrExitStart != null
        const hdrExitWeight = hdrExiting ? (1 - Math.min(1, Math.max(0, (now - view.hdrExitStart!) / HDR_EXIT_MS))) ** 2 : 0
        const offset = visualIndex[i] - focusVisual
        // 聚光灯亮起时其余不在唱的行变淡、变虚；同时在唱的行与鼠标悬停行保持清晰
        const { alpha, blur } = lineAppearance({
          active,
          distance: Math.abs(offset),
          past: offset < 0,
          hovered: !this.options.strip && i === this.hoveredView,
          spotted: i === this.spotView,
          spot,
          inactiveAlpha,
          blurFactor,
          noBlur,
        })
        const color = lyricColor(Math.round(alpha * 100) / 100)
        if (color !== view.color) {
          view.color = color
          view.el.style.color = color
        }
        // HDR 高光下在唱或处于 0.4s 退场窗口内的行不加模糊：background-clip: text 与 filter: blur 叠加在离屏纹理上会闪出白色矩形
        const filter = blur > 0 && !(this.display.hdr && (active || view.active || hdrExiting)) ? `blur(${blur.toFixed(1)}px)` : ''
        if (filter !== view.filter) {
          view.filter = filter
          view.el.style.filter = filter
        }
        // 横向滚动只改合成层，逐帧更新；只算此刻在容器内的行
        if (view.marquee && y + view.height > 0 && y < this.containerHeight)
          this.paintMarquee(view.marquee, view.el, (view.half ? this.containerWidth / 2 : this.containerWidth) - view.marquee.padding, timeMs)
        // 聚光灯亮起时，边缘光丝与切换胶囊先让路淡出，突出点题歌词本身
        if (view.ornaments.length > 0) {
          const ornamentAlpha = i === this.spotView && spot > 0 ? Math.max(0, 1 - spot * 1.25) : 1
          const nextOrnamentOpacity = ornamentAlpha < 0.999 ? ornamentAlpha.toFixed(3) : ''
          if (nextOrnamentOpacity !== view.ornamentOpacity) {
            view.ornamentOpacity = nextOrnamentOpacity
            for (const orn of view.ornaments)
              orn.style.opacity = nextOrnamentOpacity
          }
        }
        const lineNeedsDetail = detail || active !== view.active || hdrExiting || view.hdrExiting
        if (!lineNeedsDetail)
          continue
        // 与下面的逐字样式在同一帧切换（HDR 高光的字色由类名决定，见 lyric-player.css）
        if (active !== view.active) {
          view.active = active
          view.el.classList.toggle('lyric-line--active', active)
        }
        if (hdrExiting !== view.hdrExiting) {
          view.hdrExiting = hdrExiting
          view.el.classList.toggle('lyric-line--hdr-exit', hdrExiting)
        }
        const linePeakGain = view.hdrExitFromSpot ? this.spotGain() : HDR_BRIGHTNESS.lyric
        if (!this.lyrics.wordTimed && view.main) {
          const endAlpha = hdrExitEndAlpha(alpha, linePeakGain)
          const nextAlpha = endAlpha + (1 - endAlpha) * hdrExitWeight
          const mainOpacity = hdrExiting && nextAlpha < 0.9995 ? nextAlpha.toFixed(3) : ''
          if (mainOpacity !== view.mainOpacity) {
            view.mainOpacity = mainOpacity
            view.main.style.opacity = mainOpacity
          }
        }
        // 在唱或处于 0.4s HDR 退场窗口内的点题句保持聚光灯档位素材（脱离这两个类名时必须撤下，见 lyric-player.css）
        const spotlit = (active && i === this.hdrSpotView) || (hdrExiting && view.hdrExitFromSpot)
        if (spotlit !== view.spotlit) {
          view.spotlit = spotlit
          view.el.classList.toggle('lyric-line--spot', spotlit)
        }
        const hdrExit = hdrExiting ? { weight: hdrExitWeight, targetAlpha: alpha, dimAlpha: wordDimAlpha, lineGain: linePeakGain } : null
        this.paintWords(view, active, timeMs + LYRIC_ANIMATION_HEADSTART_MS, feather, wordDimAlpha, hdrExit)
        if (view.emphasis.length > 0) {
          if (this.display.effects && !this.reducedMotion)
            this.paintEmphasis(view, active, timeMs, hdrExit)
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
        // 间奏圆点：依次淡入、按拍倒计时点亮、呼吸，结束前放大后收拢在人声进入的那一拍（见 interlude.ts）；减少动态效果时只保留透明度
        const dots = interludeDots(item.start, item.end, timeMs, view.dots.length, rhythmContext(this.rhythm))
        view.dots.forEach((dot, index) => {
          const state = dots[index]
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
   * 单行条的横向滚动：超出宽度的行跟随演唱位置（逐行歌词按行进度，逐字歌词沿舒适走廊拉紧弦并做 C² 平滑）滚动，
   * 两侧按是否还有内容渐隐；唱完的行停在末尾，随弹簧移出时仍露出结尾。减少动态效果时不滚动，只渐隐右侧
   */
  private paintMarquee(marquee: StripMarquee, el: HTMLElement, containerWidth: number, timeMs: number) {
    const overflow = marquee.contentWidth - containerWidth
    let offset = 0
    if (overflow > 0 && !this.reducedMotion) {
      const words = marquee.line.words
      const useWordTiming = this.lyrics.wordTimed
        && marquee.boxes.length === words.length
        && words.length > 0
        && words.some(word => word.end > word.start)
      if (useWordTiming) {
        if (marquee.knots == null || marquee.knotsWidth !== containerWidth) {
          marquee.knots = getWordMarqueeKnots(words, marquee.boxes, containerWidth, overflow)
          marquee.knotsWidth = containerWidth
        }
        offset = evaluateMarqueeKnots(marquee.knots, timeMs)
      }
      else {
        offset = getLyricMarqueeOffset({
          line: marquee.line,
          nextLineStartTime: marquee.nextStart,
          currentTimeMs: timeMs,
          containerWidth,
          contentWidth: marquee.contentWidth,
        })
      }
    }
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

  /**
   * 逐字擦除：高亮行的每个词按演唱进度用带羽化边缘的遮罩揭示，演唱中的词轻微上浮；不高亮时清除。
   * 只有正在唱的词用遮罩，还没唱到的词改用等效的整体不透明度压暗：每个遮罩都要单独离屏绘制，
   * 整行都挂着遮罩时，正在唱的词每帧重绘都会连带重绘这些遮罩（实测去掉遮罩后 GPU 进程主线程约少 3.4 个百分点）
   */
  private paintWords(
    view: ItemView,
    active: boolean,
    timeMs: number,
    feather: number,
    dimAlpha: number,
    hdrExit: { weight: number, targetAlpha: number, dimAlpha: number, lineGain: number } | null = null,
  ) {
    const bg = view.item.kind === 'line' && Boolean(this.lyrics.lines[view.item.line]?.isBackground)
    const floatPx = LYRIC_WORD_FLOAT_EM * this.fontSize * (bg ? 2 : 1)
    const effectsOn = this.display.effects && !this.reducedMotion
    const wordEndAlpha = hdrExit ? hdrExitEndAlpha(hdrExit.targetAlpha, hdrExit.lineGain) : 0
    for (const word of view.words) {
      let mask = ''
      let opacity = ''
      let transform = ''
      const width = word.width - word.pad * 2
      if (active && width > 0) {
        const progress = getWordProgress(word.word.start, word.word.end, timeMs)
        if (progress <= 0) {
          opacity = String(dimAlpha)
        }
        else if (progress < 1) {
          // 遮罩按像素定位：强调词四周有内边距，揭示位置从内边距之后算起
          const x = word.pad + progress * (width + feather)
          mask = `linear-gradient(90deg, #000 ${(x - feather).toFixed(1)}px, rgb(0 0 0 / ${dimAlpha}) ${x.toFixed(1)}px)`
        }
        if (!this.reducedMotion && progress > 0 && word.lifts && (!word.emphasized || !effectsOn))
          transform = `translateY(${(-floatPx * easeOut(progress)).toFixed(2)}px)`
      }
      else if (hdrExit && !word.split) {
        const progress = getWordProgress(word.word.start, word.word.end, timeMs)
        const startAlpha = dimAlpha + (1 - dimAlpha) * progress
        const nextAlpha = wordEndAlpha + (startAlpha - wordEndAlpha) * hdrExit.weight
        opacity = nextAlpha < 0.9995 ? nextAlpha.toFixed(3) : ''
        if (!this.reducedMotion && progress > 0 && word.lifts) {
          const dy = -floatPx * easeOut(progress) * hdrExit.weight
          if (Math.abs(dy) >= 0.02)
            transform = `translateY(${dy.toFixed(2)}px)`
        }
      }
      if (mask !== word.mask) {
        word.mask = mask
        word.el.style.maskImage = mask
        word.el.style.setProperty('-webkit-mask-image', mask)
      }
      if (opacity !== word.opacity) {
        word.opacity = opacity
        word.el.style.opacity = opacity
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
  /** 点题句的 HDR 亮度：单行条（灵动岛）与播放器页、悬浮小窗分开配置 */
  private spotGain() {
    return this.options.strip ? HDR_BRIGHTNESS.stripSpotlight : HDR_BRIGHTNESS.spotlight
  }

  private paintEmphasis(
    view: ItemView,
    active: boolean,
    timeMs: number,
    hdrExit: { weight: number, targetAlpha: number, dimAlpha: number } | null = null,
  ) {
    const bg = view.item.kind === 'line' && this.lyrics.lines[view.item.line]?.isBackground
    // 聚光灯下的点题句：辉光与字的放大随聚光灯强度收敛（见 SPOTLIGHT_EMPHASIS_GLOW）
    const spot = this.views[this.spotView] === view ? this.spot : 0
    // HDR 高光：正在唱或处于 0.4s 退场窗口内的行里强调词的字由静态 HDR 素材绘制，退场期间不换素材、仅通过单字 opacity 平滑降到 SDR 亮度
    const hdrExiting = !active && hdrExit != null
    const hdr = this.display.hdr && (active || hdrExiting)
    const hdrGain = (active ? this.views[this.hdrSpotView] === view : view.hdrExitFromSpot) ? this.spotGain() : HDR_BRIGHTNESS.emphasis
    const charEndAlpha = hdrExit ? hdrExitEndAlpha(hdrExit.targetAlpha, hdrGain) : 0
    const glowScale = 1 - (1 - SPOTLIGHT_EMPHASIS_GLOW) * spot
    const growScale = 1 - (1 - SPOTLIGHT_EMPHASIS_SCALE) * spot
    // 柔光持续到这一行结束
    const lineEnd = view.item.kind === 'line' ? this.lyrics.lines[view.item.line]?.end ?? 0 : 0
    for (const { group, chars } of view.emphasis) {
      // 特效节奏：跟随节拍时由拍点驱动（心跳、重音、柔光呼吸、波浪、抖动的调幅、流光），固定快慢时按固定周期；
      // 起落曲线、消散的时长按基准周期 T_b 换算（见 rhythm/effects.ts）
      const rhythm = rhythmContext(this.rhythm)
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
      const shine = group.effect === 'shimmer' && (active || hdrExiting || !view.filter) ? shimmerCenter(rhythm, group.start, timeMs, count) : null
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
        let tint = 0
        let shineX = ''
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
          tint = Math.max(v * EMPHASIS_TINT_PEAK, (active || hdrExiting) && timeMs >= begin ? EMPHASIS_TINT_HOLD : 0)
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
        const canShine = shine != null && !(hdr && hdrExiting && !char.shine)
        let usedHdrBg = false
        if (canShine) {
          // 流光：字的颜色改由背景绘制（裁剪到字形，见 lyric-player.css），叠上一道光带；文字本身透明，辉光会盖住背景所以不用
          const pos = (shine - i) * 100
          if (hdr && hdrExiting && char.shine && char.background) {
            background = char.background
            shineX = shimmerPosition(pos)
            usedHdrBg = true
          }
          else {
            // HDR 高光：底色与光带都是 HDR——一张「底色 → 光带 → 底色」的横条素材随光带移动，底下再铺一层底色素材（横条移出字外时兜底）。
            // CSS 不能给图片层加渐变遮罩，所以光带直接画进素材里（见 hdrShimmerUrl）；扫光期间整个字就是 HDR，扫完不会突然变亮
            const hdrBase = hdr ? hdrTint(tintColor, tint) : null
            const strip = hdrBase ? hdrShimmerUrl(hdrBase, hdrGain, HDR_SHINE_COLOR, Math.max(HDR_BRIGHTNESS.shimmer, hdrGain)) : null
            const baseUrl = hdrBase ? hdrColorUrl(hdrBase, hdrGain) : null
            if (strip && baseUrl) {
              background = `url("${strip}"), url("${baseUrl}")`
              shineX = shimmerPosition(pos)
              usedHdrBg = true
            }
            else {
              const base = color ? color.replace('currentColor', 'var(--lyric-color, #fff)') : 'var(--lyric-color, #fff)'
              background = `linear-gradient(105deg, transparent ${(pos - 40).toFixed(1)}%, rgb(255 250 230 / 0.95) ${pos.toFixed(1)}%, transparent ${(pos + 40).toFixed(1)}%), linear-gradient(${base}, ${base})`
            }
          }
          color = 'transparent'
          shadow = ''
        }
        else if (hdr && (!filter || group.effect === 'focus')) {
          // 字的颜色改由 HDR 素材绘制、裁剪到字形（见 lyric-player.css）。辉光不画：text-shadow 会盖在背景上，
          // 改用 drop-shadow 等滤镜与 background-clip: text 叠在同一个元素上时，Chrome 偶尔按整个盒子而不是字形绘制，闪出白色矩形；
          // HDR 的亮度本身代替辉光。消散时（带模糊、正在淡出）这个字退回 SDR 颜色；聚焦的模糊例外，整个词从头到尾都是 HDR——
          // 逐字等模糊消失再切换会一个一个字跳亮，而单纯的 blur 与 background-clip: text 叠加实测渲染正常。
          // 跨行退场期间直接复用激活态已解码的素材（若流光刚扫完则取已在第二层解码的底色素材），杜绝 WebKit 异步解码空帧闪烁
          if (hdrExiting && char.background) {
            const commaIdx = char.shine ? char.background.indexOf(', url(') : -1
            background = commaIdx >= 0 ? char.background.slice(commaIdx + 2) : char.background
            color = 'transparent'
            shadow = ''
            usedHdrBg = true
          }
          else {
            const url = hdrColorUrl(hdrTint(tintColor, tint), hdrGain)
            if (url) {
              background = `url("${url}")`
              color = 'transparent'
              shadow = ''
              usedHdrBg = true
            }
          }
        }
        if (hdrExit && usedHdrBg) {
          const charProgress = getWordProgress(char.start, char.end, timeMs + LYRIC_ANIMATION_HEADSTART_MS)
          const startAlpha = hdrExit.dimAlpha + (1 - hdrExit.dimAlpha) * charProgress
          const exitAlpha = charEndAlpha + (startAlpha - charEndAlpha) * hdrExit.weight
          const combined = (opacity ? Number.parseFloat(opacity) : 1) * exitAlpha
          opacity = combined < 0.9995 ? combined.toFixed(3) : ''
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
        if (shineX !== char.shine) {
          if (!shineX !== !char.shine)
            char.el.classList.toggle('lyric-char--shine', !!shineX)
          char.shine = shineX
          if (shineX)
            char.el.style.setProperty('--lyric-shine-x', shineX)
          else
            char.el.style.removeProperty('--lyric-shine-x')
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
        if (char.shine) {
          char.shine = ''
          char.el.classList.remove('lyric-char--shine')
          char.el.style.removeProperty('--lyric-shine-x')
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
    return this.computeTops().tops[index] ?? 0
  }

  private viewIndexFromTarget(target: EventTarget | null): number {
    const lineEl = (target as Element | null)?.closest?.<HTMLElement>('.lyric-line')
    if (!lineEl || !this.container.contains(lineEl))
      return -1
    return this.views.findIndex(view => view.el === lineEl && !view.collapsed)
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
    if (event.pointerType === 'mouse' && event.button !== 0)
      return
    const pressed = this.viewIndexFromTarget(event.target)
    if (pressed !== this.pressedView) {
      this.pressedView = pressed
      this.wake()
    }
    // 鼠标点击用于选择歌词行；触摸与触控笔拖动滚动
    if (event.pointerType === 'mouse')
      return
    this.drag = { pointerId: event.pointerId, lastY: event.clientY, lastAt: performance.now(), moved: 0 }
    this.suppressClick = false
  }

  private onPointerMove = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') {
      const hovered = this.viewIndexFromTarget(event.target)
      if (hovered !== this.hoveredView) {
        this.hoveredView = hovered
        this.wake()
      }
      return
    }
    const drag = this.drag
    if (!drag || drag.pointerId !== event.pointerId)
      return
    const now = performance.now()
    const dy = event.clientY - drag.lastY
    drag.moved += Math.abs(dy)
    if (drag.moved < DRAG_CLICK_TOLERANCE_PX)
      return
    if (this.pressedView >= 0)
      this.pressedView = -1
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
    if (this.pressedView >= 0) {
      this.pressedView = -1
      this.wake()
    }
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

  private onPointerLeave = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse')
      return
    let changed = false
    if (this.hoveredView >= 0) {
      this.hoveredView = -1
      changed = true
    }
    if (this.pressedView >= 0) {
      this.pressedView = -1
      changed = true
    }
    if (changed)
      this.wake()
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
