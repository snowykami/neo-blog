import type { FixedLyricPace } from '../pace'
import type { RhythmModel, RhythmPulse } from './model'
import type { RhythmParams } from './params'
import { cubicBezier } from '../easing'
import { PACE } from '../pace'
import { firstAtOrAfter, trainOf } from './model'
import { getRhythmParams } from './params'

/**
 * 韵律动效（信号与系统）：节拍决定「什么时候动」，歌词决定「哪里动、动多少」。
 * 输入为冲激串 x_e(t) = Σ a_k δ(t − t_k)：跟随节拍时为检测到的拍点（见 model.ts），固定快慢（回退或调试覆盖）时为从 origin 起每 T_e 一个；
 * 输出 y_e(t) = Σ_{t_k ∈ W_e} a_k h_e(t + t_lead − t_k)，再由各消费方（lyric-player.ts、stage-effects.ts）映射到位移、缩放与辉光。
 * 时间均为毫秒；参数见 params.ts，公式与图示见播放器的调试面板
 */

/** 生效的节奏：跟随节拍可用时为 beat，否则为固定快慢 */
export type EffectivePace = 'beat' | FixedLyricPace

export interface RhythmContext {
  pace: EffectivePace
  // 跟随节拍时的节拍模型
  model: RhythmModel | null
  params: RhythmParams
  // 基准脉冲周期 T_b
  base: number
}

/**
 * 解析生效的节奏：节拍模型可用且可信时跟随节拍，否则回退到 params.fallback；
 * 调试面板的试听档位（params.preview）优先。歌词标注里的 pace 不再参与（节拍是唯一的速度来源）
 */
export function rhythmContext(model: RhythmModel | null | undefined, params = getRhythmParams()): RhythmContext {
  const wanted: EffectivePace = params.preview ?? (model?.reliable ? 'beat' : params.fallback)
  if (wanted !== 'beat')
    return { pace: wanted, model: null, params, base: PACE.basePeriod[wanted] }
  if (!model)
    return { pace: params.fallback, model: null, params, base: PACE.basePeriod[params.fallback] }
  return { pace: 'beat', model, params, base: model.analysis.basePeriodMs }
}

/** 动效的周期 T_e = 2^n·T_b */
export function periodOf(ctx: RhythmContext, octave: number) {
  return ctx.base * 2 ** octave
}

/** 起落曲线的时长倍数 T_b / 750ms（中档为 1，慢 1.33，快 0.69） */
export function envelopeScale(ctx: RhythmContext) {
  return ctx.base / PACE.basePeriod.medium
}

/** 与 T_b 最接近的固定快慢（长音颤音模拟人声，不跟随节拍，只取相近的档位） */
export function nearestFixedPace(ctx: RhythmContext): FixedLyricPace {
  if (ctx.pace !== 'beat')
    return ctx.pace
  const tiers: FixedLyricPace[] = ['slow', 'medium', 'fast']
  return tiers.reduce((best, tier) => (Math.abs(PACE.basePeriod[tier] - ctx.base) < Math.abs(PACE.basePeriod[best] - ctx.base) ? tier : best))
}

/** [t0, t1] 内的脉冲：跟随节拍时取检测到的拍点（按八度重采样），固定快慢时为从 origin 起每 T_e 一个 */
export function pulsesIn(ctx: RhythmContext, octave: number, origin: number, t0: number, t1: number): RhythmPulse[] {
  if (ctx.model) {
    const train = trainOf(ctx.model, octave)
    const out: RhythmPulse[] = []
    for (let i = firstAtOrAfter(train, t0); i < train.length && train[i].t <= t1; i++)
      out.push(train[i])
    return out
  }
  const T = periodOf(ctx, octave)
  const out: RhythmPulse[] = []
  for (let k = Math.max(0, Math.ceil((t0 - origin) / T - 1e-9)); origin + k * T <= t1; k++)
    out.push({ t: origin + k * T, a: 1, synth: false })
  return out
}

/** 加窗的脉冲：窗 [a, b] 内一拍都没有时取 a 之后的第一拍，保证至少动一次 */
export function windowPulses(ctx: RhythmContext, octave: number, origin: number, a: number, b: number): RhythmPulse[] {
  const list = pulsesIn(ctx, octave, origin, a, b)
  if (list.length > 0)
    return list
  const first = pulsesIn(ctx, octave, origin, a, a + 2.2 * periodOf(ctx, octave))[0]
  return first ? [first] : []
}

/** 卷积 y(t) = Σ a_k h(t − t_k) */
export function convolve(pulses: RhythmPulse[], t: number, h: (dt: number) => number) {
  let y = 0
  for (const pulse of pulses)
    y += pulse.a * h(t - pulse.t)
  return y
}

// ---------------- 冲激响应 h_e(t) ----------------

/** g_τ(t) = (t/τ)·e^(1 − t/τ)·u(t)：临界阻尼二阶，t = τ 处峰值 1 */
export function alpha(t: number, tau: number) {
  return t <= 0 ? 0 : (t / tau) * Math.exp(1 - t / tau)
}

function clamp(x: number, min: number, max: number) {
  return Math.min(max, Math.max(min, x))
}

function clamp01(x: number) {
  return clamp(x, 0, 1)
}

export const kernels = {
  /** 心跳：g(t) + β·g(t − Δ)，Δ = clamp(r·T_e, Δmin, Δmax)，「扑通-扑通」 */
  heartbeat: (t: number, Te: number, p: RhythmParams['heartbeat']) => alpha(t, p.attackMs) + p.beta * alpha(t - clamp(p.delayRatio * Te, p.delayMinMs, p.delayMaxMs), p.attackMs),
  /** 放大的拍上重音：g_τ(t) */
  swell: (t: number, p: RhythmParams['swell']) => alpha(t, p.tauMs),
  /** 柔光：cos²(πt/T_e)，|t| < T_e/2（非因果，峰值落在拍上） */
  glow: (t: number, Te: number) => (Math.abs(t) < Te / 2 ? Math.cos(Math.PI * t / Te) ** 2 : 0),
  /** 波浪：sin(πt/w)，0 ≤ t < w，w = r·T_e */
  wave: (t: number, Te: number, p: RhythmParams['wave']) => {
    const w = p.widthRatio * Te
    return t >= 0 && t < w ? Math.sin(Math.PI * t / w) : 0
  },
  /** 抖动的调幅包络：e^(−t/τ)·u(t) */
  shake: (t: number, p: RhythmParams['shake']) => (t < 0 ? 0 : Math.exp(-t / p.decayMs)),
  /** 背景呼吸：min(1, t/τ_a)·e^(−t/τ_d)·u(t) */
  background: (t: number, p: RhythmParams['background']) => (t < 0 ? 0 : Math.min(1, t / p.attackMs) * Math.exp(-t / p.decayMs)),
}

// ---------------- 各动效的输出 ----------------

/** 心跳强度 y（0 ~ 1.2）：短语 [开唱 − 60ms, 唱完] 内的拍经过心跳系统 */
export function heartbeatLevel(ctx: RhythmContext, start: number, end: number, timeMs: number) {
  const p = ctx.params.heartbeat
  const Te = periodOf(ctx, p.octave)
  const list = windowPulses(ctx, p.octave, start, start - 60, end)
  return Math.min(1.2, convolve(list, timeMs + ctx.params.leadMs, dt => kernels.heartbeat(dt, Te, p)))
}

/** 放大的拍上重音 y（约 0 ~ 1）：最近的拍经过 g_τ，起落曲线乘以 (1 + gain·y) */
export function swellAccent(ctx: RhythmContext, start: number, timeMs: number) {
  const p = ctx.params.swell
  const at = timeMs + ctx.params.leadMs
  return convolve(pulsesIn(ctx, p.octave, start, at - 8 * p.tauMs, at), at, dt => kernels.swell(dt, p))
}

/** 柔光：门控 gate（开唱前 150ms 起 0.3 秒淡入，这一行结束后 0.4 秒淡出）与随拍呼吸 y（0 ~ 1） */
export function glowLevel(ctx: RhythmContext, start: number, lineEnd: number, timeMs: number) {
  const octave = ctx.params.glow.octave
  const Te = periodOf(ctx, octave)
  const gate = clamp01((timeMs - start + 150) / 300) * clamp01(1 - (timeMs - lineEnd) / 400)
  if (gate <= 0)
    return { gate: 0, y: 0 }
  const y = Math.min(1, convolve(windowPulses(ctx, octave, start, start - 60, lineEnd), timeMs + ctx.params.leadMs, dt => kernels.glow(dt, Te)))
  return { gate, y }
}

/** 波浪：第 i 个字的上浮 y_i（0 ~ 1.2）；一拍内波峰从首字走到末字 */
export function waveLevels(ctx: RhythmContext, start: number, end: number, count: number, timeMs: number): number[] {
  const p = ctx.params.wave
  const Te = periodOf(ctx, p.octave)
  const delta = count > 1 ? 0.5 * Te / (count - 1) : 0
  const list = windowPulses(ctx, p.octave, start, start - 60, end)
  const at = timeMs + ctx.params.leadMs
  return Array.from({ length: count }, (_, i) => Math.min(1.2, convolve(list, at - i * delta, dt => kernels.wave(dt, Te, p))))
}

/** 抖动的调幅 y（0 ~ 1）：[开唱, until] 内的拍让抖动「踢」一下再衰减 */
export function shakeLevel(ctx: RhythmContext, start: number, until: number, timeMs: number) {
  const p = ctx.params.shake
  return Math.min(1, convolve(windowPulses(ctx, p.octave, start, start - 60, until), timeMs + ctx.params.leadMs, dt => kernels.shake(dt, p)))
}

/** 抖动的载波周期 T_b / d */
export function shakeCarrierMs(ctx: RhythmContext) {
  return ctx.base / ctx.params.shake.carrierDivisor
}

/** 流光：光带中心在词上的位置（以字为单位，从 −1 扫到 count + 1）；从开唱前 120ms 内或之后的第一拍起每拍扫一遍，不在扫动时为 null */
export function shimmerCenter(ctx: RhythmContext, start: number, timeMs: number, count: number): number | null {
  const p = ctx.params.shimmer
  const at = timeMs + ctx.params.leadMs
  const list = pulsesIn(ctx, p.octave, start, start - 120, start + (p.sweeps + 2) * periodOf(ctx, p.octave) * 1.5)
  for (let k = 0; k < p.sweeps && k + 1 < list.length; k++) {
    if (at >= list[k].t && at < list[k + 1].t)
      return ((at - list[k].t) / (list[k + 1].t - list[k].t)) * (count + 2) - 1
  }
  return null
}

/** 消散的淡出时长 0.8·T_b */
export function dissolveFadeMs(ctx: RhythmContext) {
  return 0.8 * ctx.base
}

const easeOut = cubicBezier(0, 0, 0.58, 1)

/** 间奏圆点呼吸的八度：使 T_e 最接近 params.interlude.targetMs（0 ~ 2） */
export function interludeOctave(ctx: RhythmContext) {
  return clamp(Math.round(Math.log2(ctx.params.interlude.targetMs / ctx.base)), 0, 2)
}

/**
 * 间奏圆点的呼吸缩放：交替符号的冲激串经过「平滑阶跃」，每个拍点把目标在吸 / 呼之间翻转一次（缓出 0.8·T_e）；
 * 间奏开始之后还没有拍时保持 1。固定快慢的网格从 origin 起（间奏圆点让网格对齐到人声进入的时刻，见 interlude.ts）
 */
export function breathScale(ctx: RhythmContext, start: number, until: number, timeMs: number, origin = start) {
  const { inhale, exhale } = ctx.params.interlude
  const octave = interludeOctave(ctx)
  const now = Math.min(timeMs, until)
  const list = pulsesIn(ctx, octave, origin, start, now)
  const j = list.length
  if (j === 0)
    return 1
  const target = j % 2 === 1 ? inhale : exhale
  const from = j === 1 ? 1 : j % 2 === 1 ? exhale : inhale
  const progress = clamp01((now - list[j - 1].t - 30) / (0.8 * periodOf(ctx, octave)))
  return from + (target - from) * easeOut(progress)
}

/** 背景呼吸（0 ~ 1）：全曲的拍经过背景系统；只在跟随节拍时演出（固定快慢没有真实的拍，不呼吸） */
export function backgroundLevel(ctx: RhythmContext, timeMs: number) {
  if (!ctx.model)
    return 0
  const p = ctx.params.background
  const at = timeMs + ctx.params.leadMs
  return Math.min(1, convolve(pulsesIn(ctx, p.octave, 0, at - 1000, at), at, dt => kernels.background(dt, p)))
}

/** 爱心粒子随拍的缩放 y（0 ~ 1.2）：全曲的拍经过心跳系统；不跟随节拍时为 null（粒子用自己的缓慢起伏） */
export function particleHeartLevel(ctx: RhythmContext, timeMs: number): number | null {
  if (!ctx.model)
    return null
  const p = ctx.params.heartbeat
  const Te = periodOf(ctx, p.octave)
  const at = timeMs + ctx.params.leadMs
  return Math.min(1.2, convolve(pulsesIn(ctx, p.octave, 0, at - 1000, at), at, dt => kernels.heartbeat(dt, Te, p)))
}

/** 粒子在 (t0, t1] 内经过的拍（点过程）；不跟随节拍时为 null（粒子均匀生成） */
export function particlePulses(ctx: RhythmContext, octave: number, t0: number, t1: number): RhythmPulse[] | null {
  if (!ctx.model)
    return null
  const lead = ctx.params.leadMs
  return pulsesIn(ctx, ctx.params.particles.octave + octave, 0, t0 + lead + 1e-6, t1 + lead)
}
