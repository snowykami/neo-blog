import type { FixedLyricPace } from '../pace'

/**
 * 韵律动效的参数（时间均为毫秒）：默认值即线上效果，播放器的调试面板（专业模式）可以临时修改，只在当前页面生效。
 * octave 为各动效相对基准脉冲的八度倍数 n_e（T_e = 2^n·T_b）
 */
export interface RhythmParams {
  // 试听档位：调试面板中临时覆盖整首歌的节奏（固定档），为 null 时按节拍（不可信时回退到 fallback）
  preview: FixedLyricPace | null
  // 动效提前量 t_lead：视觉比声音略早一点更显得对拍
  leadMs: number
  // 节拍置信度低于它时不跟随节拍（自由节奏、纯钢琴、朗诵等），回退到 fallback
  minConfidence: number
  fallback: FixedLyricPace
  // 拍的强弱：a_k = a_min + (1 − a_min)·clamp((L − L10) / (L95 − L10))
  accentMin: number
  heartbeat: { octave: number, attackMs: number, beta: number, delayRatio: number, delayMinMs: number, delayMaxMs: number }
  swell: { octave: number, tauMs: number, gain: number }
  glow: { octave: number }
  wave: { octave: number, widthRatio: number }
  shake: { octave: number, decayMs: number, carrierDivisor: number }
  shimmer: { octave: number, sweeps: number }
  background: { octave: number, attackMs: number, decayMs: number }
  interlude: { targetMs: number, inhale: number, exhale: number }
  particles: { octave: number }
}

export const DEFAULT_RHYTHM_PARAMS: RhythmParams = {
  preview: null,
  leadMs: 20,
  minConfidence: 0.12,
  fallback: 'medium',
  accentMin: 0.55,
  heartbeat: { octave: 0, attackMs: 55, beta: 0.65, delayRatio: 0.3, delayMinMs: 140, delayMaxMs: 300 },
  swell: { octave: 0, tauMs: 70, gain: 0.6 },
  glow: { octave: 1 },
  wave: { octave: 0, widthRatio: 0.5 },
  shake: { octave: -1, decayMs: 120, carrierDivisor: 16 },
  shimmer: { octave: 0, sweeps: 2 },
  background: { octave: 0, attackMs: 30, decayMs: 150 },
  interlude: { targetMs: 2000, inhale: 1.2, exhale: 0.9 },
  particles: { octave: 0 },
}

let current: RhythmParams = DEFAULT_RHYTHM_PARAMS
const listeners = new Set<() => void>()

export function getRhythmParams(): RhythmParams {
  return current
}

/** 修改参数（专业模式）：按分组浅合并 */
export function setRhythmParams(patch: Partial<RhythmParams>) {
  current = { ...current, ...patch }
  listeners.forEach(listener => listener())
}

export function resetRhythmParams() {
  current = DEFAULT_RHYTHM_PARAMS
  listeners.forEach(listener => listener())
}

export function subscribeRhythmParams(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
