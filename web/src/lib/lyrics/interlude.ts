import type { RhythmContext } from './rhythm/effects'
import { cubicBezier } from './easing'
import { breathScale, rhythmContext } from './rhythm/effects'

/**
 * 间奏圆点的动效（参考 StarryPlayer 的间奏倒计时：节奏与参数取自其表现，按时间计算、自行实现）：
 * - 出场：圆点依次淡入（间隔 APPEAR_STAGGER_MS），先以「未点亮」的低透明度出现
 * - 倒计时：间奏开始 LIGHT_DELAY_MS 后按时间依次点亮，到淡出前全部点亮
 * - 呼吸：在吸气与呼气之间交替缓动，每个拍点翻转一次（跟随节拍；固定快慢时从间奏开始按固定周期，见 rhythm/effects.ts 的 breathScale）
 * - 退场：结束前 FADE_OUT_LEAD_MS 先吸气放大，随后缩小并淡出（两侧的点以中间为原点，收拢到中间，见 lyric-player.css）
 * 全部由当前时间算出，拖动进度或跳转时不需要额外状态
 */

const LIGHT_DELAY_MS = 1000
const FADE_OUT_LEAD_MS = 1800
const UNLIT_OPACITY = 0.1
const APPEAR_MS = 800
const APPEAR_STAGGER_MS = 60
const INHALE_SCALE = 1.2
const SWELL_MS = 1000
const VANISH_DELAY_MS = 1000
const VANISH_SCALE = 0.2
const SHRINK_MS = 500
const VANISH_FADE_MS = 300

const easeIn = cubicBezier(0.42, 0, 1, 1)
const swellEase = cubicBezier(0.25, 0.1, 0.25, 1)
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

export interface InterludeDot {
  opacity: number
  scale: number
}

/** 第 index 个（共 count 个）圆点在 timeMs 时的透明度与缩放；间奏外为不可见。rhythm 为全曲节奏的演出上下文 */
export function interludeDot(start: number, end: number, timeMs: number, index: number, count: number, rhythm: RhythmContext = rhythmContext(undefined, null)): InterludeDot {
  if (timeMs < start || timeMs >= end)
    return { opacity: 0, scale: 1 }
  const fadeOutAt = end - FADE_OUT_LEAD_MS
  // 出场：依次淡入；倒计时：依次点亮
  const appear = clamp01((timeMs - start - index * APPEAR_STAGGER_MS) / APPEAR_MS)
  const lightMs = Math.max(fadeOutAt - (start + LIGHT_DELAY_MS), 100) / count
  const lit = clamp01((timeMs - (start + LIGHT_DELAY_MS) - index * lightMs) / lightMs)
  let opacity = appear * (UNLIT_OPACITY + (1 - UNLIT_OPACITY) * lit)

  if (timeMs < fadeOutAt)
    return { opacity, scale: breathScale(rhythm, start, fadeOutAt, timeMs) }

  // 退场：先吸气放大，随后缩小并淡出
  const elapsed = timeMs - fadeOutAt
  const base = breathScale(rhythm, start, fadeOutAt, fadeOutAt)
  let scale = base + (INHALE_SCALE - base) * swellEase(clamp01(elapsed / SWELL_MS))
  const vanish = elapsed - VANISH_DELAY_MS
  if (vanish > 0) {
    scale = INHALE_SCALE + (VANISH_SCALE - INHALE_SCALE) * easeIn(clamp01(vanish / SHRINK_MS))
    opacity *= 1 - easeIn(clamp01(vanish / VANISH_FADE_MS))
  }
  return { opacity, scale }
}
