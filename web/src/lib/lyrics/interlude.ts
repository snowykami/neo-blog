import type { RhythmContext } from './rhythm/effects'
import { cubicBezier } from './easing'
import { breathScale, interludeOctave, periodOf, pulsesIn, rhythmContext } from './rhythm/effects'

/**
 * 间奏圆点的动效（参考 StarryPlayer 的间奏倒计时：节奏与参数取自其表现，按时间计算、自行实现），时间点都落在拍上：
 * - 出场：圆点依次淡入（间隔 APPEAR_STAGGER_MS），先以「未点亮」的低透明度出现
 * - 倒计时：间奏开始 LIGHT_DELAY_MS 后依次点亮，每个点在一拍上亮满，最后一个点在退场那一拍亮满（像数拍子进拍）
 * - 呼吸：在吸气与呼气之间交替缓动，每 2^n 拍翻转一次（见 rhythm/effects.ts 的 breathScale）
 * - 退场：在人声进入前约 FADE_OUT_LEAD_MS 的那一拍先吸气放大，随后缩小并淡出，收拢正好在人声进入的那一拍完成
 *   （两侧的点以中间为原点，收拢到中间，见 lyric-player.css）
 * 跟随节拍时用检测到的拍点；固定快慢时用从人声进入的时刻往回每 T_b 一拍的网格（间奏的长度不一定是拍长的整数倍，从结尾对齐才落在人声上）。
 * 全部由当前时间算出，拖动进度或跳转时不需要额外状态
 */

const LIGHT_DELAY_MS = 1000
const FADE_OUT_LEAD_MS = 1800
const UNLIT_OPACITY = 0.1
const APPEAR_MS = 800
const APPEAR_STAGGER_MS = 60
const INHALE_SCALE = 1.2
const SWELL_MS = 1000
const VANISH_SCALE = 0.2
const SHRINK_MS = 500
const VANISH_FADE_MS = 300
// 人声进入的那一拍：人声前后这么近的拍算作人声的拍（检测到的拍点有几十毫秒的抖动）；早于人声的取它，晚于人声的取人声的时刻
const ENTRY_TOLERANCE_MS = 80
// 人声没有落在拍上（弱起、抢拍）时，收拢落在它之前最近的一拍，最多提前这么多个拍长
const ENTRY_LOOKBACK_BEATS = 0.6

const easeIn = cubicBezier(0.42, 0, 1, 1)
const swellEase = cubicBezier(0.25, 0.1, 0.25, 1)
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

export interface InterludeDot {
  opacity: number
  scale: number
}

/** 一段间奏的时间点（毫秒）：都在拍上，按时间先后排列 */
export interface InterludePlan {
  // 固定快慢时网格的起点（对齐到人声进入的时刻）；跟随节拍时为间奏开始
  origin: number
  // 各点亮满的时刻（第 i 个点从前一个点亮满起逐渐点亮，到这一刻亮满）
  lit: number[]
  // 退场：开始吸气放大、开始缩小淡出、收拢完成（人声进入的那一拍）
  exitAt: number
  vanishAt: number
  entry: number
}

/** 离 t 最近的拍；[lo, hi] 内没有拍时取 t 本身（限制在 [lo, hi] 内） */
function snap(beats: number[], t: number, lo: number, hi: number) {
  let best = Math.min(hi, Math.max(lo, t))
  let distance = Infinity
  for (const beat of beats) {
    if (beat >= lo && beat <= hi && Math.abs(beat - t) < distance) {
      best = beat
      distance = Math.abs(beat - t)
    }
  }
  return best
}

/** 一段间奏 [start, end) 的时间点：end 为下一句人声进入的时刻 */
export function interludePlan(start: number, end: number, count: number, rhythm: RhythmContext): InterludePlan {
  const beatMs = periodOf(rhythm, 0)
  // 固定快慢：网格从人声进入往回排，取呼吸周期（最长的那级）的整数倍，各级网格都经过人声进入的时刻
  const breathMs = periodOf(rhythm, interludeOctave(rhythm))
  const origin = rhythm.model ? start : end - Math.ceil((end - start) / breathMs) * breathMs
  const beats = pulsesIn(rhythm, 0, origin, start, end + ENTRY_TOLERANCE_MS).map(pulse => pulse.t)
  // 人声进入的那一拍
  const near = beats.filter(t => t >= end - ENTRY_LOOKBACK_BEATS * beatMs && t <= end + ENTRY_TOLERANCE_MS)
  const onEntry = near.filter(t => Math.abs(t - end) <= ENTRY_TOLERANCE_MS)
  const entry = Math.max(start, Math.min(end, onEntry.length > 0 ? onEntry[0] : near.length > 0 ? near[near.length - 1] : end))
  const vanishAt = Math.max(start, entry - SHRINK_MS)
  const exitAt = snap(beats, entry - FADE_OUT_LEAD_MS, start, vanishAt)
  // 倒计时：按时间均分后各自吸附到最近的拍，保持先后顺序；最后一个点在退场那一拍亮满
  const lightFrom = Math.min(start + LIGHT_DELAY_MS, exitAt)
  const lit: number[] = []
  for (let i = 0; i < count; i++) {
    const previous = i > 0 ? lit[i - 1] : lightFrom
    lit.push(i === count - 1 ? exitAt : snap(beats, lightFrom + (i + 1) * (exitAt - lightFrom) / count, previous, exitAt))
  }
  return { origin, lit, exitAt, vanishAt, entry }
}

/** 各圆点在 timeMs 时的透明度与缩放（时间点每帧算一次，各点共用）；间奏外为不可见。rhythm 为全曲节奏的演出上下文 */
export function interludeDots(start: number, end: number, timeMs: number, count: number, rhythm: RhythmContext = rhythmContext(undefined, null)): InterludeDot[] {
  if (timeMs < start || timeMs >= end)
    return Array.from({ length: count }, () => ({ opacity: 0, scale: 1 }))
  const plan = interludePlan(start, end, count, rhythm)
  const { exitAt, vanishAt } = plan

  // 呼吸到退场开始；退场：先吸气放大并保持，随后缩小并淡出
  let scale = breathScale(rhythm, start, exitAt, timeMs, plan.origin)
  let fade = 1
  if (timeMs >= exitAt) {
    const base = breathScale(rhythm, start, exitAt, exitAt, plan.origin)
    scale = base + (INHALE_SCALE - base) * swellEase(clamp01((timeMs - exitAt) / Math.max(1, Math.min(SWELL_MS, vanishAt - exitAt))))
    if (timeMs >= vanishAt) {
      const vanish = timeMs - vanishAt
      scale = INHALE_SCALE + (VANISH_SCALE - INHALE_SCALE) * easeIn(clamp01(vanish / Math.max(1, plan.entry - vanishAt)))
      fade = 1 - easeIn(clamp01(vanish / VANISH_FADE_MS))
    }
  }

  return Array.from({ length: count }, (_, index) => {
    // 出场：依次淡入；倒计时：从前一个点亮满起逐渐点亮，到自己的那一拍亮满
    const appear = clamp01((timeMs - start - index * APPEAR_STAGGER_MS) / APPEAR_MS)
    const from = index > 0 ? plan.lit[index - 1] : Math.min(start + LIGHT_DELAY_MS, exitAt)
    const until = plan.lit[index]
    const lit = until > from ? clamp01((timeMs - from) / (until - from)) : timeMs >= until ? 1 : 0
    return { opacity: appear * (UNLIT_OPACITY + (1 - UNLIT_OPACITY) * lit) * fade, scale }
  })
}

/** 第 index 个（共 count 个）圆点在 timeMs 时的透明度与缩放 */
export function interludeDot(start: number, end: number, timeMs: number, index: number, count: number, rhythm?: RhythmContext): InterludeDot {
  return interludeDots(start, end, timeMs, count, rhythm)[index]
}
