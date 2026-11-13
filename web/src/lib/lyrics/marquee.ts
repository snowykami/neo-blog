import type { LyricLine, LyricWord } from './types'

/** 逐行歌词（LRC）在无法得知下一行时间时使用的默认行时长 */
export const LYRIC_MARQUEE_DEFAULT_LINE_DURATION_MS = 5000
/** 逐行歌词：行开始后先静止的比例，保证开头可读 */
export const LYRIC_MARQUEE_HOLD_RATIO = 0.1
/** 逐行歌词：滚动到末尾时所处的行进度比例，保证在行结束前完整露出结尾 */
export const LYRIC_MARQUEE_FINISH_RATIO = 0.88
/** 逐字歌词：演唱位置在可视区域中允许偏左的下限比例（避开左侧渐隐） */
export const LYRIC_MARQUEE_CORRIDOR_MIN_RATIO = 0.35
/** 逐字歌词：演唱位置在可视区域中允许偏右的上限比例（避开右侧渐隐并留出前瞻空间） */
export const LYRIC_MARQUEE_CORRIDOR_MAX_RATIO = 0.72
/** 逐字歌词：二阶对称三角核平滑总窗口宽度（ms），等价于两次各宽一半的均值滤波，使速度与加速度均连续 */
export const LYRIC_MARQUEE_SMOOTH_WINDOW_MS = 500

/** 逐字歌词中每个字（词）在内容中的水平位置，单位 px，相对内容左边缘 */
export interface LyricMarqueeWordBox {
  left: number
  width: number
}

/** 偏移量随时间变化的折点：相邻折点之间线性变化，首个折点之前、最后一个折点之后保持不变 */
export interface LyricMarqueeKnot {
  time: number
  offset: number
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
  /** 逐字歌词的平滑窗口（ms），默认 LYRIC_MARQUEE_SMOOTH_WINDOW_MS；0 表示仅使用拉紧弦折线 */
  smoothWindowMs?: number
  /** 逐字歌词舒适走廊下限比例，默认 LYRIC_MARQUEE_CORRIDOR_MIN_RATIO */
  corridorMinRatio?: number
  /** 逐字歌词舒适走廊上限比例，默认 LYRIC_MARQUEE_CORRIDOR_MAX_RATIO */
  corridorMaxRatio?: number
}

interface CursorPoint {
  time: number
  position: number
}

interface CorridorGate {
  time: number
  lower: number
  upper: number
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

/**
 * 构造时间严格递增的原始游标轨迹（time, position）：
 * 每个字在自身区间内从 box.left 线性移到 box.left + box.width，时间重叠的字顺延，重叠完全相同的点去重
 */
function buildCursorPositions(words: LyricWord[], wordBoxes: LyricMarqueeWordBox[]): CursorPoint[] {
  const raw: CursorPoint[] = []
  let lastTime = Number.NEGATIVE_INFINITY
  words.forEach((word, i) => {
    const box = wordBoxes[i]
    const start = Math.max(word.start, lastTime)
    lastTime = Math.max(start, word.end)
    raw.push({ time: start, position: box.left }, { time: lastTime, position: box.left + box.width })
  })

  const positions: CursorPoint[] = []
  for (const pt of raw) {
    const prev = positions[positions.length - 1]
    if (prev && Math.abs(pt.time - prev.time) < 1e-6 && Math.abs(pt.position - prev.position) < 1e-6)
      continue
    const time = prev && pt.time <= prev.time ? prev.time + 1e-3 : pt.time
    positions.push({ time, position: pt.position })
  }
  return positions
}

/** 在原始游标折线穿过走廊边界阈值（anchor 与 anchor + overflow）的精确时刻插入采样点 */
function samplePositionsWithCrossings(positions: CursorPoint[], edges: number[]): CursorPoint[] {
  const result: CursorPoint[] = []
  for (let i = 0; i < positions.length; i++) {
    const pt = positions[i]
    const prev = positions[i - 1]
    if (prev && pt.time > prev.time + 1e-5 && pt.position !== prev.position) {
      const crossings: number[] = []
      for (const edge of edges) {
        if ((prev.position - edge) * (pt.position - edge) < 0) {
          const tCross = prev.time + (edge - prev.position) / (pt.position - prev.position) * (pt.time - prev.time)
          if (tCross > prev.time + 1e-4 && tCross < pt.time - 1e-4)
            crossings.push(tCross)
        }
      }
      crossings.sort((a, b) => a - b)
      let lastT = prev.time
      for (const tc of crossings) {
        if (tc - lastT <= 1e-4)
          continue
        const ratio = (tc - prev.time) / (pt.time - prev.time)
        result.push({ time: tc, position: prev.position + (pt.position - prev.position) * ratio })
        lastT = tc
      }
    }
    result.push({ time: pt.time, position: pt.position })
  }
  return result
}

/** 合并共线冗余折点，保持拉紧弦表示最简 */
function pruneCollinearKnots(knots: LyricMarqueeKnot[]): LyricMarqueeKnot[] {
  if (knots.length <= 2)
    return knots
  const pruned: LyricMarqueeKnot[] = [knots[0]]
  for (let i = 1; i < knots.length - 1; i++) {
    const a = pruned[pruned.length - 1]
    const b = knots[i]
    const c = knots[i + 1]
    const dt1 = b.time - a.time
    const dt2 = c.time - b.time
    if (dt1 > 0 && dt2 > 0) {
      const slope1 = (b.offset - a.offset) / dt1
      const slope2 = (c.offset - b.offset) / dt2
      if (Math.abs(slope1 - slope2) * (c.time - a.time) <= 1e-7)
        continue
    }
    pruned.push(b)
  }
  pruned.push(knots[knots.length - 1])
  return pruned
}

/**
 * 求解舒适走廊 gates = [{ time, lower, upper }] 内的最短拉紧弦（Taut String）折点：
 * 在整个连续时间轴上始终满足 lower(t) <= offset(t) <= upper(t)，同时最小化总斜率变化（长拖音/气口直接拉直线）
 */
function solveTautString(gates: CorridorGate[]): LyricMarqueeKnot[] {
  const n = gates.length
  if (n === 0)
    return []
  const knots: LyricMarqueeKnot[] = [{ time: gates[0].time, offset: gates[0].lower }]
  let i = 0
  let y = gates[0].lower
  while (i < n - 1) {
    let lowSlope = Number.NEGATIVE_INFINITY
    let lowIdx = -1
    let highSlope = Number.POSITIVE_INFINITY
    let highIdx = -1
    let bent = false
    for (let j = i + 1; j < n; j++) {
      const dt = gates[j].time - gates[i].time
      if (dt <= 0)
        continue
      const sL = (gates[j].lower - y) / dt
      const sU = (gates[j].upper - y) / dt
      if (sL > highSlope + 1e-10) {
        i = highIdx
        y = gates[i].upper
        knots.push({ time: gates[i].time, offset: y })
        bent = true
        break
      }
      if (sU < lowSlope - 1e-10) {
        i = lowIdx
        y = gates[i].lower
        knots.push({ time: gates[i].time, offset: y })
        bent = true
        break
      }
      if (sL >= lowSlope) {
        lowSlope = sL
        lowIdx = j
      }
      if (sU <= highSlope) {
        highSlope = sU
        highIdx = j
      }
    }
    if (!bent) {
      knots.push({ time: gates[n - 1].time, offset: gates[n - 1].lower })
      break
    }
  }
  return pruneCollinearKnots(knots)
}

/** 二分查找折线在时刻 t 处的分段线性值；首尾之外保持首尾常数 */
function evalKnots(knots: LyricMarqueeKnot[], t: number): number {
  const first = knots[0]
  if (t <= first.time)
    return first.offset
  const last = knots[knots.length - 1]
  if (t >= last.time)
    return last.offset

  let lo = 0
  let hi = knots.length - 1
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (knots[mid].time <= t)
      lo = mid
    else
      hi = mid
  }
  const a = knots[lo]
  const b = knots[hi]
  const dt = b.time - a.time
  return dt > 0 ? a.offset + (b.offset - a.offset) * (t - a.time) / dt : b.offset
}

/**
 * 线性加权折线积分 \int_{from}^{to} f(u) w(u) du，其中权重 w(u) 在 [from, to] 上从 wFrom 线性变化到 wTo；
 * 在折线分割出的每个线性子区间上 f(u)*w(u) 至多为二次多项式，采用 Simpson 公式可求得代数精确积分
 */
function integrateWeightedKnots(
  knots: LyricMarqueeKnot[],
  from: number,
  to: number,
  wFrom: number,
  wTo: number,
): number {
  if (knots.length === 0 || to <= from)
    return 0
  const span = to - from
  const simpson = (lo: number, hi: number, fLo: number, fHi: number) => {
    const len = hi - lo
    if (len <= 0)
      return 0
    const mid = (lo + hi) * 0.5
    const fMid = (fLo + fHi) * 0.5
    const wLo = wFrom + (wTo - wFrom) * (lo - from) / span
    const wMid = wFrom + (wTo - wFrom) * (mid - from) / span
    const wHi = wFrom + (wTo - wFrom) * (hi - from) / span
    return (len / 6) * (fLo * wLo + 4 * fMid * wMid + fHi * wHi)
  }

  let sum = 0
  const first = knots[0]
  const last = knots[knots.length - 1]
  if (from < first.time)
    sum += simpson(from, Math.min(to, first.time), first.offset, first.offset)
  for (let i = 1; i < knots.length; i++) {
    const a = knots[i - 1]
    const b = knots[i]
    const lo = Math.max(from, a.time)
    const hi = Math.min(to, b.time)
    if (hi <= lo)
      continue
    const dt = b.time - a.time
    const fLo = a.offset + (b.offset - a.offset) * (lo - a.time) / dt
    const fHi = a.offset + (b.offset - a.offset) * (hi - a.time) / dt
    sum += simpson(lo, hi, fLo, fHi)
  }
  if (to > last.time)
    sum += simpson(Math.max(from, last.time), to, last.offset, last.offset)
  return sum
}

/**
 * 计算逐字歌词舒适走廊内的最短拉紧弦折点；可随字盒测量与容器宽度缓存复用，避免每帧重复构图
 */
export function getWordMarqueeKnots(
  words: LyricWord[],
  wordBoxes: LyricMarqueeWordBox[],
  containerWidth: number,
  overflow: number,
  corridorMinRatio = LYRIC_MARQUEE_CORRIDOR_MIN_RATIO,
  corridorMaxRatio = LYRIC_MARQUEE_CORRIDOR_MAX_RATIO,
): LyricMarqueeKnot[] {
  if (words.length === 0 || wordBoxes.length !== words.length || !(overflow > 0))
    return []

  const minRatio = clamp(corridorMinRatio, 0, 1)
  const maxRatio = clamp(Math.max(minRatio, corridorMaxRatio), 0, 1)
  const anchorMin = containerWidth * minRatio
  const anchorMax = containerWidth * maxRatio

  const positions = buildCursorPositions(words, wordBoxes)
  if (positions.length === 0)
    return []

  const sampled = samplePositionsWithCrossings(positions, [
    anchorMin,
    anchorMin + overflow,
    anchorMax,
    anchorMax + overflow,
  ])

  const gates: CorridorGate[] = sampled.map((p, idx) => {
    let lower = clamp(p.position - anchorMax, 0, overflow)
    let upper = clamp(p.position - anchorMin, 0, overflow)
    if (lower > upper) {
      const mid = (lower + upper) * 0.5
      lower = mid
      upper = mid
    }
    if (idx === 0)
      upper = lower
    if (idx === sampled.length - 1)
      lower = upper
    return { time: p.time, lower, upper }
  })

  return solveTautString(gates)
}

/**
 * 求折线在指定时刻经二阶对称三角核（宽 smoothWindowMs）平滑后的偏移量：
 * 折角展开为 C² 分段三次过渡，速度与加速度均连续，直线恒速段保持零相位滞后不变
 */
export function evaluateMarqueeKnots(
  knots: LyricMarqueeKnot[],
  currentTimeMs: number,
  smoothWindowMs = LYRIC_MARQUEE_SMOOTH_WINDOW_MS,
): number {
  if (knots.length === 0)
    return 0
  if (knots.length === 1)
    return knots[0].offset

  const half = Math.max(0, smoothWindowMs) / 2
  if (half <= 0)
    return evalKnots(knots, currentTimeMs)

  const left = integrateWeightedKnots(knots, currentTimeMs - half, currentTimeMs, 0, 1 / half)
  const right = integrateWeightedKnots(knots, currentTimeMs, currentTimeMs + half, 1 / half, 0)
  return clamp(left + right, knots[0].offset, knots[knots.length - 1].offset)
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
 * - 逐字歌词：先在可视区域 [corridorMinRatio, corridorMaxRatio] 的舒适走廊内求最短拉紧弦折线，
 *   再经以当前时刻为中心、宽 smoothWindowMs 的二阶对称三角核平滑，使速度与加速度均连续
 */
export function getLyricMarqueeOffset({
  line,
  nextLineStartTime,
  currentTimeMs,
  containerWidth,
  contentWidth,
  wordBoxes,
  smoothWindowMs = LYRIC_MARQUEE_SMOOTH_WINDOW_MS,
  corridorMinRatio = LYRIC_MARQUEE_CORRIDOR_MIN_RATIO,
  corridorMaxRatio = LYRIC_MARQUEE_CORRIDOR_MAX_RATIO,
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

  const knots = getWordMarqueeKnots(words, wordBoxes, containerWidth, overflow, corridorMinRatio, corridorMaxRatio)
  return evaluateMarqueeKnots(knots, currentTimeMs, smoothWindowMs)
}
