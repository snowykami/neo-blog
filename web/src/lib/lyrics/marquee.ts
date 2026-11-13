import type { LyricLine, LyricWord } from './types'

/** 逐行歌词（LRC）在无法得知下一行时间时使用的默认行时长 */
export const LYRIC_MARQUEE_DEFAULT_LINE_DURATION_MS = 5000
/** 逐行歌词：行开始后先静止的比例，保证开头可读 */
export const LYRIC_MARQUEE_HOLD_RATIO = 0.1
/** 逐行歌词：滚动到末尾时所处的行进度比例，保证在行结束前完整露出结尾 */
export const LYRIC_MARQUEE_FINISH_RATIO = 0.88
/** 逐字歌词：当前演唱位置在可视区域中的锚点比例 */
export const LYRIC_MARQUEE_ANCHOR_RATIO = 0.65
/** 逐字歌词：偏移量按当前时刻前后各一半的窗口取平均（ms），使速度连续变化、成为分段匀变速运动 */
export const LYRIC_MARQUEE_SMOOTH_WINDOW_MS = 300

/** 逐字歌词中每个字（词）在内容中的水平位置，单位 px，相对内容左边缘 */
export interface LyricMarqueeWordBox {
  left: number
  width: number
}

export interface LyricMarqueeOffsetParams {
  line: LyricLine
  /** 下一行开始时间（ms），用于推算逐行歌词的行时长；最后一行传 undefined */
  nextLineStartTime?: number
  currentTimeMs: number
  /** 可视容器宽度（px） */
  containerWidth: number
  /** 内容总宽度（px） */
  contentWidth: number
  /** 逐字歌词各字的位置，长度需与 line.words 一致；不传或长度不符时按逐行处理 */
  wordBoxes?: LyricMarqueeWordBox[]
  /** 逐字歌词的平滑窗口（ms），默认 LYRIC_MARQUEE_SMOOTH_WINDOW_MS；0 表示不平滑（速度在音节边界突变） */
  smoothWindowMs?: number
}

/** 偏移量随时间变化的折点：相邻折点之间线性变化，首个折点之前、最后一个折点之后保持不变 */
interface LyricMarqueeKnot {
  time: number
  offset: number
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

/**
 * 逐字歌词未平滑的偏移折线：演唱位置在每个字的演唱区间内从字的左边缘线性移到右边缘、字间空隙中从上一个字的末尾移到下一个字的开头，
 * 减去锚点后限定在 [0, 溢出宽度]（在越过两端的时刻插入折点）；时间重叠的字按先后顺序依次唱
 */
function getWordMarqueeKnots(
  words: LyricWord[],
  wordBoxes: LyricMarqueeWordBox[],
  containerWidth: number,
  overflow: number,
): LyricMarqueeKnot[] {
  const positions: { time: number, position: number }[] = []
  let lastTime = Number.NEGATIVE_INFINITY
  words.forEach((word, i) => {
    const box = wordBoxes[i]
    const start = Math.max(word.start, lastTime)
    lastTime = Math.max(start, word.end)
    positions.push({ time: start, position: box.left }, { time: lastTime, position: box.left + box.width })
  })

  const anchor = containerWidth * LYRIC_MARQUEE_ANCHOR_RATIO
  const knots: LyricMarqueeKnot[] = []
  positions.forEach((point, i) => {
    const prev = positions[i - 1]
    if (prev && prev.time < point.time) {
      // 本段越过滚动起点或终点的时刻
      const crossings = [anchor, anchor + overflow]
        .filter(edge => (prev.position - edge) * (point.position - edge) < 0)
        .map(edge => prev.time + (edge - prev.position) / (point.position - prev.position) * (point.time - prev.time))
        .sort((a, b) => a - b)
      for (const time of crossings) {
        const position = prev.position + (point.position - prev.position) * (time - prev.time) / (point.time - prev.time)
        knots.push({ time, offset: clamp(position - anchor, 0, overflow) })
      }
    }
    knots.push({ time: point.time, offset: clamp(point.position - anchor, 0, overflow) })
  })
  return knots
}

/** 折线在 [from, to] 上的平均值；from === to 时为该时刻的值 */
function averageMarqueeKnots(knots: LyricMarqueeKnot[], from: number, to: number): number {
  const first = knots[0]
  const last = knots[knots.length - 1]
  if (to <= from) {
    if (from <= first.time)
      return first.offset
    const index = knots.findIndex(knot => knot.time > from)
    if (index < 0)
      return last.offset
    const a = knots[index - 1]
    const b = knots[index]
    return a.offset + (b.offset - a.offset) * (from - a.time) / (b.time - a.time)
  }
  // 两端之外为常数，中间各段按梯形求面积
  let area = first.offset * Math.max(0, Math.min(to, first.time) - from)
    + last.offset * Math.max(0, to - Math.max(from, last.time))
  for (let i = 1; i < knots.length; i++) {
    const a = knots[i - 1]
    const b = knots[i]
    const lo = Math.max(from, a.time)
    const hi = Math.min(to, b.time)
    if (hi <= lo)
      continue
    const slope = (b.offset - a.offset) / (b.time - a.time)
    area += (2 * a.offset + slope * (lo - a.time + hi - a.time)) / 2 * (hi - lo)
  }
  return area / (to - from)
}

/** 获取歌词行时长（ms）：优先使用行自身时长，其次为与下一行的间隔，最后回退默认值 */
export function getLyricLineDuration(line: LyricLine, nextLineStartTime?: number): number {
  if (line.end > line.start)
    return line.end - line.start
  if (nextLineStartTime != null && nextLineStartTime > line.start)
    return nextLineStartTime - line.start
  return LYRIC_MARQUEE_DEFAULT_LINE_DURATION_MS
}

/**
 * 计算单行条歌词跑马灯的水平偏移量（px，正值表示内容向左移动的距离），结果限定在 [0, 溢出宽度]
 * - 逐行歌词：先静止 HOLD_RATIO，再匀速滚动，在 FINISH_RATIO 时到达末尾
 * - 逐字歌词：在当前字的时间区间内线性插值演唱位置，使其保持在可视区域约 ANCHOR_RATIO 处，
 *   再取以当前时刻为中心、宽 smoothWindowMs 的窗口内的平均值，使速度连续变化（分段匀变速）
 */
export function getLyricMarqueeOffset({
  line,
  nextLineStartTime,
  currentTimeMs,
  containerWidth,
  contentWidth,
  wordBoxes,
  smoothWindowMs = LYRIC_MARQUEE_SMOOTH_WINDOW_MS,
}: LyricMarqueeOffsetParams): number {
  const overflow = contentWidth - containerWidth
  if (!(overflow > 0) || !Number.isFinite(overflow))
    return 0

  const words = line.words
  const useWordTiming = wordBoxes != null
    && wordBoxes.length === words.length
    && words.length > 0
    && words.some(word => word.end > word.start)

  if (!useWordTiming) {
    const lineDuration = getLyricLineDuration(line, nextLineStartTime)
    const progress = (currentTimeMs - line.start) / lineDuration
    const ratio = clamp((progress - LYRIC_MARQUEE_HOLD_RATIO) / (LYRIC_MARQUEE_FINISH_RATIO - LYRIC_MARQUEE_HOLD_RATIO), 0, 1)
    return ratio * overflow
  }

  const knots = getWordMarqueeKnots(words, wordBoxes, containerWidth, overflow)
  const half = Math.max(0, smoothWindowMs) / 2
  return averageMarqueeKnots(knots, currentTimeMs - half, currentTimeMs + half)
}
