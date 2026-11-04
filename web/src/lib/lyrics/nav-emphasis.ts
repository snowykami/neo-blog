import type { RhythmModel } from './rhythm/model'
import type { LyricEmphasis } from './types'
import { LYRIC_COLORS } from './colors'
import { swellCurve } from './easing'
import { dissolveFadeMs, envelopeScale, glowLevel, heartbeatLevel, nearestFixedPace, rhythmContext, shakeCarrierMs, shakeLevel, shimmerCenter, swellAccent, waveLevels } from './rhythm/effects'
import { holdVibrato, vibratoWave } from './vibrato'
import { dissolveState, shatterState } from './word-effects'

/**
 * 导航栏与单曲卡的单行逐字歌词的简化强调特效（见 spec 8.2）：沿用播放器的强调分组（规则 + 歌词标注），
 * 但只做轻量的动效，幅度比播放器小，避免在一行高的导航栏里溢出：
 * - swell 放大 + 辉光；glow 辉光；wave 上浮；shake 抖动（带长音时为延迟的颤音，见 vibrato.ts）；focus 由虚到实；
 *   heartbeat 随双拍轻跳；shimmer 光带经过的词依次亮起；dissolve 唱完后变淡、变虚并向右飘（不生成颗粒），之后恢复；
 *   shatter 碎之前细微地颤，碎时整个词迅速下坠、淡出（不生成碎片），之后恢复；拖动进度后落点之前的不消散、不破碎（seekAt，同播放器）
 * - 指定了颜色时随演唱上色，唱过后保留部分颜色；factor 为 0 或减少动态效果时只上色
 */

// 演出时长下限与字间错开比例（同播放器）；随节奏变化的部分由节拍驱动，见 rhythm/effects.ts
const MIN_MS = 1000
const STAGGER_RATIO = 1 / 2.5
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

/**
 * 一组强调中第 i 个词（共 count 个）在 timeMs 时的样式；motion 为 false 时只上色；seekAt 为最近一次跳转的落点；
 * rhythm 为这首歌的节拍模型（没有时回退到固定快慢），lineEnd 为所在行结束的时刻（柔光持续到行尾）
 */
export function navEmphasisStyle(group: LyricEmphasis, i: number, count: number, timeMs: number, motion: boolean, seekAt = Number.NEGATIVE_INFINITY, rhythm: RhythmModel | null = null, lineEnd = group.end): NavWordStyle {
  const ctx = rhythmContext(group.pace, rhythm)
  const duration = Math.max(MIN_MS, group.end - group.start) * envelopeScale(ctx)
  const begin = group.start + (duration * STAGGER_RATIO / Math.max(1, count)) * i
  const hold = group.effect === 'shake' && group.hold ? holdVibrato(group.hold, timeMs, nearestFixedPace(ctx)) : null
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
    // 起落曲线上叠加拍上的重音
    const accent = swellAccent(ctx, group.start, timeMs)
    const k = v * (1 + ctx.params.swell.gain * accent)
    scale = 1 + k * 0.08 * f
    glow = v * (0.3 + 0.4 * f) * (1 + 0.4 * accent)
  }
  else if (group.effect === 'glow') {
    // 从开唱到行尾随拍呼吸
    const { gate, y: breath } = glowLevel(ctx, group.start, lineEnd, timeMs)
    scale = 1 + gate * breath * 0.03 * f
    glow = gate * (0.4 + 0.4 * f) * (0.3 + 0.7 * breath)
  }
  else if (group.effect === 'wave') {
    // 一拍内波峰从首词走到末词
    y = -(waveLevels(ctx, group.start, group.end, count, timeMs)[i] ?? 0) * 0.12 * f
  }
  else if (group.effect === 'shake' && hold) {
    const wobble = vibratoWave(timeMs, hold.onset, i, nearestFixedPace(ctx))
    scale = 1 + v * 0.08 * f + wobble * hold.amount * 0.015 * f
    y = -wobble * hold.amount * 0.03 * f
    glow = v * (0.3 + 0.4 * f) + hold.amount * 0.1 * f
  }
  else if (group.effect === 'shake') {
    // 抖动幅度随拍「踢」一下再衰减
    const amp = v * (0.35 + 0.65 * shakeLevel(ctx, group.start, group.start + duration, timeMs))
    const phase = (timeMs - begin) / shakeCarrierMs(ctx)
    x = Math.sin(phase * 2.3 + i * 1.7) * 0.03 * f * amp
    y = Math.cos(phase * 1.9 + i * 1.3) * 0.02 * f * amp
    scale = 1 + amp * 0.04 * f
    glow = amp * (0.2 + 0.25 * f)
  }
  else if (group.effect === 'focus') {
    const clear = Math.min(1, Math.max(0, (timeMs - begin) / (duration * 0.6)))
    const blur = (1 - clear) * (0.02 + 0.03 * f)
    if (blur > 0.002)
      filter = `blur(${blur.toFixed(3)}em)`
    glow = v * (0.2 + 0.3 * f)
  }
  else if (group.effect === 'heartbeat') {
    const beat = heartbeatLevel(ctx, group.start, group.end, timeMs)
    scale = 1 + v * 0.03 * f + beat * 0.1 * f
    x = (i - (count - 1) / 2) * beat * 0.04 * f
    glow = beat * (0.3 + 0.3 * f)
  }
  else if (group.effect === 'shimmer') {
    // 导航栏的字很小，不画光带：光带经过的词依次亮起
    const shine = shimmerCenter(ctx, group.start, timeMs, count)
    glow = shine == null ? v * 0.3 * f : Math.max(0, 1 - Math.abs(shine - i - 0.5)) * 0.9
    scale = 1 + v * 0.03 * f
  }
  let opacity = ''
  if (group.effect === 'dissolve') {
    const amount = dissolveState(group.start, group.end, i, count, timeMs, seekAt, dissolveFadeMs(ctx)).amount
    if (amount > 0.002) {
      opacity = (1 - amount).toFixed(3)
      filter = `blur(${(amount * 0.06).toFixed(3)}em)`
      x += amount * 0.12
    }
    scale = 1 + v * 0.03 * f
  }
  else if (group.effect === 'shatter') {
    const shatter = shatterState(group.end, timeMs, seekAt)
    if (shatter.crack > 0) {
      x += Math.sin(timeMs * 0.09 + i * 1.7) * 0.025 * shatter.crack
      y += Math.cos(timeMs * 0.11 + i) * 0.015 * shatter.crack
    }
    // 碎后的 0.2 秒内下坠并淡出（之后保持隐去，恢复时原地淡入）
    const fall = Math.min(1, Math.max(0, (timeMs - shatter.at) / 200))
    if (shatter.amount > 0.002) {
      opacity = (1 - shatter.amount * fall).toFixed(3)
      y += shatter.amount === 1 ? fall * 0.25 : 0
    }
    scale = 1 + v * 0.03 * f
  }

  const moved = Math.abs(scale - 1) > 0.0005 || Math.abs(x) > 0.0005 || Math.abs(y) > 0.0005
  return {
    transform: moved ? `translate(${x.toFixed(3)}em, ${y.toFixed(3)}em) scale(${scale.toFixed(3)})` : '',
    // 按整数百分比写入，细微变化不重写 text-shadow
    textShadow: Math.round(glow * 100) > 0 ? `0 0 0.35em color-mix(in srgb, ${tintColor ?? 'currentColor'} ${Math.round(glow * 100)}%, transparent)` : '',
    filter,
    opacity,
    color,
  }
}
