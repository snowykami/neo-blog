import type { LyricEmphasis } from './types'
import { LYRIC_COLORS } from './colors'
import { swellCurve } from './easing'
import { holdVibrato, vibratoWave } from './vibrato'
import { dissolveState, heartbeatLevel, shimmerCenter } from './word-effects'

/**
 * 导航栏与单曲卡的单行逐字歌词的简化强调特效（见 spec 8.2）：沿用播放器的强调分组（规则 + 歌词标注），
 * 但只做轻量的动效，幅度比播放器小，避免在一行高的导航栏里溢出：
 * - swell 放大 + 辉光；glow 辉光；wave 上浮；shake 抖动（带长音时为延迟的颤音，见 vibrato.ts）；focus 由虚到实；
 *   heartbeat 随双拍轻跳；shimmer 光带经过的词依次亮起；dissolve 唱完后变淡、变虚并向右飘（不生成颗粒），之后恢复，
 *   拖动进度后落点之前的不消散（seekAt，同播放器）
 * - 指定了颜色时随演唱上色，唱过后保留部分颜色；factor 为 0 或减少动态效果时只上色
 */

// 演出时长下限与字间错开比例（同播放器）、shake 的抖动周期
const MIN_MS = 1000
const STAGGER_RATIO = 1 / 2.5
const SHAKE_PERIOD_MS = 45
// 上色的峰值与唱过后保留的比例：导航栏背景有深有浅，比播放器略淡
const TINT_PEAK = 0.8
const TINT_HOLD = 0.55

export interface NavWordStyle {
  // 写在词元素上
  transform: string
  textShadow: string
  filter: string
  opacity: string
  // 写在已唱部分（高亮层）上
  color: string
}

const NONE: NavWordStyle = { transform: '', textShadow: '', filter: '', opacity: '', color: '' }

/** 一组强调中第 i 个词（共 count 个）在 timeMs 时的样式；motion 为 false 时只上色；seekAt 为最近一次跳转的落点 */
export function navEmphasisStyle(group: LyricEmphasis, i: number, count: number, timeMs: number, motion: boolean, seekAt = Number.NEGATIVE_INFINITY): NavWordStyle {
  const duration = Math.max(MIN_MS, group.end - group.start)
  const begin = group.start + (duration * STAGGER_RATIO / Math.max(1, count)) * i
  const hold = group.effect === 'shake' && group.hold ? holdVibrato(group.hold, timeMs) : null
  let v = swellCurve((timeMs - begin) / duration)
  // 长音：放大到峰值后保持到长音唱完
  if (hold && timeMs >= begin + duration / 2)
    v = Math.max(v, hold.release)

  const tintColor = group.color ? LYRIC_COLORS[group.color] : null
  let color = ''
  if (tintColor) {
    const tint = Math.max(v * TINT_PEAK, timeMs >= begin ? TINT_HOLD : 0)
    if (tint > 0.005)
      color = `color-mix(in srgb, ${tintColor} ${(tint * 100).toFixed(1)}%, currentColor)`
  }
  const f = group.factor
  if (!motion || f <= 0)
    return color ? { ...NONE, color } : NONE

  let scale = 1
  let x = 0
  let y = 0
  let glow = 0
  let filter = ''
  if (group.effect === 'swell') {
    scale = 1 + v * 0.08 * f
    glow = v * (0.3 + 0.4 * f)
  }
  else if (group.effect === 'glow') {
    scale = 1 + v * 0.03 * f
    glow = v * (0.4 + 0.4 * f)
  }
  else if (group.effect === 'wave') {
    y = -v * 0.12 * f
  }
  else if (group.effect === 'shake' && hold) {
    const wobble = vibratoWave(timeMs, hold.onset, i)
    scale = 1 + v * 0.08 * f + wobble * hold.amount * 0.015 * f
    y = -wobble * hold.amount * 0.03 * f
    glow = v * (0.3 + 0.4 * f) + hold.amount * 0.1 * f
  }
  else if (group.effect === 'shake') {
    const phase = (timeMs - begin) / SHAKE_PERIOD_MS
    x = Math.sin(phase * 2.3 + i * 1.7) * 0.03 * f * v
    y = Math.cos(phase * 1.9 + i * 1.3) * 0.02 * f * v
    scale = 1 + v * 0.04 * f
    glow = v * (0.2 + 0.25 * f)
  }
  else if (group.effect === 'focus') {
    const clear = Math.min(1, Math.max(0, (timeMs - begin) / (duration * 0.6)))
    const blur = (1 - clear) * (0.02 + 0.03 * f)
    if (blur > 0.002)
      filter = `blur(${blur.toFixed(3)}em)`
    glow = v * (0.2 + 0.3 * f)
  }
  else if (group.effect === 'heartbeat') {
    const beat = heartbeatLevel(group.start, group.end, timeMs)
    scale = 1 + v * 0.03 * f + beat * 0.1 * f
    x = (i - (count - 1) / 2) * beat * 0.04 * f
    glow = beat * (0.3 + 0.3 * f)
  }
  else if (group.effect === 'shimmer') {
    // 导航栏的字很小，不画光带：光带经过的词依次亮起
    const shine = shimmerCenter(group.start, timeMs, count)
    glow = shine == null ? v * 0.3 * f : Math.max(0, 1 - Math.abs(shine - i - 0.5)) * 0.9
    scale = 1 + v * 0.03 * f
  }
  let opacity = ''
  if (group.effect === 'dissolve') {
    const amount = dissolveState(group.start, group.end, i, count, timeMs, seekAt).amount
    if (amount > 0.002) {
      opacity = (1 - amount).toFixed(3)
      filter = `blur(${(amount * 0.06).toFixed(3)}em)`
      x += amount * 0.12
    }
    scale = 1 + v * 0.03 * f
  }

  const moved = Math.abs(scale - 1) > 0.0005 || Math.abs(x) > 0.0005 || Math.abs(y) > 0.0005
  return {
    transform: moved ? `translate(${x.toFixed(3)}em, ${y.toFixed(3)}em) scale(${scale.toFixed(3)})` : '',
    textShadow: glow > 0.005 ? `0 0 0.35em color-mix(in srgb, ${tintColor ?? 'currentColor'} ${(glow * 100).toFixed(1)}%, transparent)` : '',
    filter,
    opacity,
    color,
  }
}
