import type { LyricEmphasis } from './types'

/**
 * 长音的颤音（shake 组带 hold 时，播放器与导航栏共用）。参考声乐研究：颤音约 5～7 Hz；长音的颤音常在开唱后 0.2～0.5 秒才出现，
 * 约为音长的 12%～20%，且幅度在头几个周期内逐渐变大。因此长音开唱后先只放大（同 swell），延迟「音长 × 20%」
 * （限制在 250～700 毫秒）后整个词开始颤，约两个周期内渐强，长音唱完后在 VIBRATO_RELEASE_MS 内收住
 */
export const VIBRATO_HZ = 5.5
const VIBRATO_DELAY_RATIO = 0.2
const VIBRATO_DELAY_MIN_MS = 250
const VIBRATO_DELAY_MAX_MS = 700
const VIBRATO_RAMP_MS = 360
const VIBRATO_RELEASE_MS = 300

export interface HoldVibrato {
  // 颤音开始的时刻（毫秒）
  onset: number
  // 长音唱完后的收尾：唱完前为 1，之后在 VIBRATO_RELEASE_MS 内降到 0
  release: number
  // 颤音幅度（0 ~ 1）：延迟后渐强，随收尾减弱
  amount: number
}

/** 长音在 timeMs 时的颤音状态 */
export function holdVibrato(hold: NonNullable<LyricEmphasis['hold']>, timeMs: number): HoldVibrato {
  const onset = hold.start + Math.min(VIBRATO_DELAY_MAX_MS, Math.max(VIBRATO_DELAY_MIN_MS, (hold.end - hold.start) * VIBRATO_DELAY_RATIO))
  const release = timeMs < hold.end ? 1 : Math.max(0, 1 - (timeMs - hold.end) / VIBRATO_RELEASE_MS)
  const amount = Math.min(1, Math.max(0, (timeMs - onset) / VIBRATO_RAMP_MS)) * release
  return { onset, release, amount }
}

/** 颤音的起伏（-1 ~ 1）：整个词同步起伏，第 i 个字略有相位差 */
export function vibratoWave(timeMs: number, onset: number, i: number): number {
  return Math.sin(2 * Math.PI * VIBRATO_HZ * (timeMs - onset) / 1000 - i * 0.35)
}
