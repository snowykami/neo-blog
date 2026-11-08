import type { RhythmAnalysis } from './analysis'
import type { RhythmParams } from './params'
import { basePeriodOf } from './params'

/**
 * 输入信号：由分析得到的拍点构造各八度的冲激串 x(t) = Σ a_k δ(t − t_k)（时间为毫秒）。
 * 0 级为补齐空档后的全部拍点（拍长 T*）；k > 0 级逐级二分，每级取起音强度之和较大的那一组（通常是强拍），保证各级嵌套；
 * k < 0 级在相邻拍之间插入中点。动效 e 使用 baseK + n_e 级，baseK 使 0 级落到基准周期 τ_F
 */

export interface RhythmPulse {
  t: number
  // 强弱 a_k（0 ~ 1）
  a: number
  // 飞轮补的拍（前奏、间奏、尾奏的静音段）
  synth: boolean
}

export interface RhythmModel {
  analysis: RhythmAnalysis
  trains: Map<number, RhythmPulse[]>
  baseK: number
  // 节拍是否可信（置信度达到阈值）
  reliable: boolean
}

const MAX_LEVEL = 4

function clamp01(x: number) {
  return Math.min(1, Math.max(0, x))
}

export function buildRhythmModel(analysis: RhythmAnalysis, params: RhythmParams): RhythmModel {
  const T = analysis.periodMs
  const accent = (loud: number) => params.accentMin + (1 - params.accentMin) * clamp01((loud - analysis.loudLow) / Math.max(1e-6, analysis.loudHigh - analysis.loudLow))
  const synthA = params.accentMin * 0.8
  const strengths = new Map<RhythmPulse, number>()
  const source = analysis.beats.map((beat) => {
    const pulse = { t: beat.t, a: accent(beat.loud), synth: false }
    strengths.set(pulse, beat.strength)
    return pulse
  })
  const filled: RhythmPulse[] = []
  if (source.length > 0) {
    // 空档外推（飞轮）：开头、结尾与拍距超过 1.5T* 的空档按 T* 补拍，保持相位连续
    const head: RhythmPulse[] = []
    for (let t = source[0].t - T; t > 50; t -= T)
      head.push({ t, a: synthA, synth: true })
    filled.push(...head.reverse())
    for (let i = 0; i < source.length; i++) {
      filled.push(source[i])
      const next = source[i + 1]
      if (!next)
        break
      const gap = next.t - source[i].t
      if (gap > 1.5 * T) {
        const m = Math.round(gap / T)
        for (let j = 1; j < m; j++)
          filled.push({ t: source[i].t + gap * j / m, a: synthA, synth: true })
      }
    }
    for (let t = source[source.length - 1].t + T; t < analysis.durationMs - 50; t += T)
      filled.push({ t, a: synthA, synth: true })
  }
  const trains = new Map<number, RhythmPulse[]>([[0, filled]])
  for (let k = 1; k <= MAX_LEVEL; k++) {
    const prev = trains.get(k - 1)!
    let even = 0
    let odd = 0
    prev.forEach((pulse, i) => {
      if (i % 2)
        odd += strengths.get(pulse) ?? 0
      else even += strengths.get(pulse) ?? 0
    })
    const keep = odd > even ? 1 : 0
    trains.set(k, prev.filter((_, i) => i % 2 === keep))
  }
  for (let k = -1; k >= -MAX_LEVEL; k--) {
    const prev = trains.get(k + 1)!
    const out: RhythmPulse[] = []
    for (let i = 0; i < prev.length; i++) {
      out.push(prev[i])
      const next = prev[i + 1]
      if (next)
        out.push({ t: (prev[i].t + next.t) / 2, a: prev[i].a * 0.85, synth: prev[i].synth })
    }
    trains.set(k, out)
  }
  return {
    analysis,
    trains,
    // 0 级落在基准脉冲 T_b 上：T_b 被 pulseOctave 改判后，k_b 跟着平移，各动效的层级不变
    baseK: Math.round(Math.log2(basePeriodOf(analysis.basePeriodMs, params) / analysis.periodMs)),
    reliable: analysis.confidence >= params.minConfidence && source.length > 0,
  }
}

/** 第一个 t >= at 的下标（二分） */
export function firstAtOrAfter(pulses: RhythmPulse[], at: number): number {
  let lo = 0
  let hi = pulses.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (pulses[mid].t < at)
      lo = mid + 1
    else hi = mid
  }
  return lo
}

export function trainOf(model: RhythmModel, octave: number): RhythmPulse[] {
  return model.trains.get(Math.min(MAX_LEVEL, Math.max(-MAX_LEVEL, model.baseK + octave))) ?? []
}
