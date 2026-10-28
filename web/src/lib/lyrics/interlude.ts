import { cubicBezier } from './easing'

/**
 * 间奏圆点的动效（参考 StarryPlayer 的间奏倒计时：节奏与参数取自其表现，按时间计算、自行实现）：
 * - 出场：圆点依次淡入（间隔 APPEAR_STAGGER_MS），先以「未点亮」的低透明度出现
 * - 倒计时：间奏开始 LIGHT_DELAY_MS 后按时间依次点亮，到淡出前全部点亮
 * - 呼吸：在吸气（INHALE_SCALE）与呼气（EXHALE_SCALE）之间交替缓动，周期按间奏长度均分
 * - 退场：结束前 FADE_OUT_LEAD_MS 先吸气放大，随后缩小并淡出（两侧的点以中间为原点，收拢到中间，见 lyric-player.css）
 * 全部由当前时间算出，拖动进度或跳转时不需要额外状态
 */

const LIGHT_DELAY_MS = 1000
const FADE_OUT_LEAD_MS = 1800
const UNLIT_OPACITY = 0.1
const APPEAR_MS = 800
const APPEAR_STAGGER_MS = 60
const BREATH_DELAY_MS = 200
const INHALE_SCALE = 1.2
const EXHALE_SCALE = 0.9
const SWELL_MS = 1000
const VANISH_DELAY_MS = 1000
const VANISH_SCALE = 0.2
const SHRINK_MS = 500
const VANISH_FADE_MS = 300

const easeOut = cubicBezier(0, 0, 0.58, 1)
const easeIn = cubicBezier(0.42, 0, 1, 1)
const swellEase = cubicBezier(0.25, 0.1, 0.25, 1)
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

export interface InterludeDot {
  opacity: number
  scale: number
}

/** 呼吸的时间轴：每一拍的时长（按淡出前的时长均分，约每 4 秒两拍） */
function breathMs(start: number, end: number) {
  const span = Math.max(end - FADE_OUT_LEAD_MS - start, 100)
  return span / Math.max(Math.floor((span / 1000) * 0.25), 1) * 0.5
}

/** 某一时刻的呼吸缩放：第 n 拍从上一拍的目标缓动到这一拍的目标（奇数拍吸气、偶数拍呼气） */
function breathScale(start: number, end: number, timeMs: number) {
  const beat = breathMs(start, end)
  const index = Math.max(1, Math.floor((timeMs - start) / beat) + 1)
  const target = index % 2 === 1 ? INHALE_SCALE : EXHALE_SCALE
  const from = index === 1 ? 1 : index % 2 === 1 ? EXHALE_SCALE : INHALE_SCALE
  const local = timeMs - start - (index - 1) * beat
  const progress = clamp01((local - BREATH_DELAY_MS) / Math.max(beat - 400, 50))
  return from + (target - from) * easeOut(progress)
}

/** 第 index 个（共 count 个）圆点在 timeMs 时的透明度与缩放；间奏外为不可见 */
export function interludeDot(start: number, end: number, timeMs: number, index: number, count: number): InterludeDot {
  if (timeMs < start || timeMs >= end)
    return { opacity: 0, scale: 1 }
  const fadeOutAt = end - FADE_OUT_LEAD_MS
  // 出场：依次淡入；倒计时：依次点亮
  const appear = clamp01((timeMs - start - index * APPEAR_STAGGER_MS) / APPEAR_MS)
  const lightMs = Math.max(fadeOutAt - (start + LIGHT_DELAY_MS), 100) / count
  const lit = clamp01((timeMs - (start + LIGHT_DELAY_MS) - index * lightMs) / lightMs)
  let opacity = appear * (UNLIT_OPACITY + (1 - UNLIT_OPACITY) * lit)

  if (timeMs < fadeOutAt)
    return { opacity, scale: breathScale(start, end, timeMs) }

  // 退场：先吸气放大，随后缩小并淡出
  const elapsed = timeMs - fadeOutAt
  const base = breathScale(start, end, fadeOutAt)
  let scale = base + (INHALE_SCALE - base) * swellEase(clamp01(elapsed / SWELL_MS))
  const vanish = elapsed - VANISH_DELAY_MS
  if (vanish > 0) {
    scale = INHALE_SCALE + (VANISH_SCALE - INHALE_SCALE) * easeIn(clamp01(vanish / SHRINK_MS))
    opacity *= 1 - easeIn(clamp01(vanish / VANISH_FADE_MS))
  }
  return { opacity, scale }
}
