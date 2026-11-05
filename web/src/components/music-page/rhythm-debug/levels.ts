import type { DebugEffect } from './formulas'
import type { RhythmContext } from '@/lib/lyrics/rhythm/effects'
import type { RhythmPulse } from '@/lib/lyrics/rhythm/model'
import type { LyricEmphasis } from '@/lib/lyrics/types'
import { LYRIC_EMPHASIS_MIN_MS } from '@/lib/lyrics/config'
import { cubicBezier, swellCurve } from '@/lib/lyrics/easing'
import { interludeDots, interludePlan } from '@/lib/lyrics/interlude'
import {
  backgroundLevel,
  envelopeScale,
  glowLevel,
  heartbeatLevel,
  interludeOctave,
  kernels,
  periodOf,
  pulsesIn,
  shakeLevel,
  shimmerCenter,
  swellAccent,
  waveLevels,
  windowPulses,
} from '@/lib/lyrics/rhythm/effects'
import { octaveOf } from './formulas'

/** 调试面板：各动效的标量输出（画输出波形用，与播放器的映射一致）与它使用的脉冲 */

export interface EffectTrace {
  value: (t: number) => number
  min: number
  max: number
  stems: (t0: number, t1: number) => RhythmPulse[]
}

/** 强调组的输出：count 为字数，lineEnd 为所在行结束的时刻 */
export function emphasisTrace(effect: DebugEffect, ctx: RhythmContext, group: LyricEmphasis, count: number, lineEnd: number): EffectTrace {
  const duration = Math.max(LYRIC_EMPHASIS_MIN_MS, group.end - group.start) * envelopeScale(ctx)
  const envelope = (t: number) => swellCurve((t - group.start) / duration)
  const n = octaveOf(effect, ctx)
  const window = (end: number) => () => windowPulses(ctx, n, group.start, group.start - 60, end)
  switch (effect) {
    case 'heartbeat':
      return { value: t => heartbeatLevel(ctx, group.start, group.end, t), min: 0, max: 1.2, stems: window(group.end) }
    case 'swell':
      return { value: t => envelope(t) * (1 + ctx.params.swell.gain * swellAccent(ctx, group.start, t)), min: 0, max: 1 + ctx.params.swell.gain, stems: (t0, t1) => pulsesIn(ctx, n, group.start, t0, t1) }
    case 'glow':
      return {
        value: (t) => {
          const { gate, y } = glowLevel(ctx, group.start, lineEnd, t)
          return gate * (0.3 + 0.7 * y)
        },
        min: 0,
        max: 1,
        stems: window(lineEnd),
      }
    case 'wave':
      return { value: t => waveLevels(ctx, group.start, group.end, count, t)[0] ?? 0, min: 0, max: 1.2, stems: window(group.end) }
    case 'shake':
      return { value: t => envelope(t) * (0.35 + 0.65 * shakeLevel(ctx, group.start, group.start + duration, t)), min: 0, max: 1, stems: window(group.start + duration) }
    case 'shimmer':
      return {
        value: (t) => {
          const center = shimmerCenter(ctx, group.start, t, count)
          return center == null ? 0 : (center + 1) / (count + 2)
        },
        min: 0,
        max: 1,
        stems: (t0, t1) => pulsesIn(ctx, n, group.start, Math.max(t0, group.start - 120), t1),
      }
    default:
      return backgroundTrace(ctx)
  }
}

export function backgroundTrace(ctx: RhythmContext): EffectTrace {
  return { value: t => backgroundLevel(ctx, t), min: 0, max: 1, stems: (t0, t1) => (ctx.model ? pulsesIn(ctx, ctx.params.background.octave, 0, t0, t1) : []) }
}

/** 间奏圆点的呼吸（缩放换算到 0 ~ 1 显示，到退场开始为止）；竖线为翻转呼吸的拍（固定快慢时网格对齐到人声进入的时刻，见 interlude.ts） */
export function interludeTrace(ctx: RhythmContext, start: number, end: number): EffectTrace {
  const plan = interludePlan(start, end, 3, ctx)
  return {
    value: t => (t < start || t > plan.exitAt ? 0 : (interludeDots(start, end, t, 3, ctx)[1].scale - 0.85) / 0.4),
    min: 0,
    max: 1,
    stems: (t0, t1) => pulsesIn(ctx, interludeOctave(ctx), plan.origin, Math.max(t0, start), Math.min(t1, plan.exitAt)),
  }
}

const easeOut = cubicBezier(0, 0, 0.58, 1)

/** 冲激响应 h(t) 的小多图（t = 0 为拍点）：标题由调用方按语言给出 */
export function kernelCurves(ctx: RhythmContext): Record<DebugEffect, { curves: ((t: number) => number)[], min: number, max: number, Te: number }> {
  const p = ctx.params
  const te = (effect: DebugEffect) => periodOf(ctx, octaveOf(effect, ctx))
  const waveTe = te('wave')
  const delta = 0.5 * waveTe / 5
  const interludeTe = te('interlude')
  return {
    heartbeat: { curves: [t => kernels.heartbeat(t, te('heartbeat'), p.heartbeat)], min: 0, max: 1.1, Te: te('heartbeat') },
    swell: { curves: [t => kernels.swell(t, p.swell)], min: 0, max: 1.1, Te: te('swell') },
    glow: { curves: [t => kernels.glow(t, te('glow'))], min: 0, max: 1.1, Te: te('glow') },
    wave: { curves: [0, 3, 6].map(i => (t: number) => kernels.wave(t - i * delta, waveTe, p.wave)), min: 0, max: 1.1, Te: waveTe },
    shake: { curves: [t => kernels.shake(t, p.shake)], min: 0, max: 1.1, Te: te('shake') },
    shimmer: { curves: [(t) => {
      const Te = te('shimmer')
      return t >= 0 && t < p.shimmer.sweeps * Te ? (t % Te) / Te : 0
    }], min: 0, max: 1.1, Te: te('shimmer') },
    background: { curves: [t => kernels.background(t, p.background)], min: 0, max: 1.1, Te: te('background') },
    interlude: { curves: [(t) => {
      if (t < 0)
        return 1
      const k = Math.floor(t / interludeTe) + 1
      const target = k % 2 === 1 ? p.interlude.inhale : p.interlude.exhale
      const from = k === 1 ? 1 : k % 2 === 1 ? p.interlude.exhale : p.interlude.inhale
      return from + (target - from) * easeOut(Math.min(1, Math.max(0, (t - (k - 1) * interludeTe - 30) / (0.8 * interludeTe))))
    }], min: 0.8, max: 1.3, Te: interludeTe },
  }
}
