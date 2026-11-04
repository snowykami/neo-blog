import type { RhythmAnalysis } from './analysis'
import { describe, expect, it } from 'vitest'
import { analyzeRhythm } from './analysis'
import { backgroundLevel, breathScale, dissolveFadeMs, envelopeScale, glowLevel, heartbeatLevel, nearestFixedPace, particlePulses, pulsesIn, rhythmContext, shimmerCenter, waveLevels } from './effects'
import { buildRhythmModel, trainOf } from './model'
import { DEFAULT_RHYTHM_PARAMS } from './params'

const RATE = 11025

/** 合成的节拍音轨：每 periodMs 一下短促的噪声击打（第一下在 offsetMs），重拍更响 */
function clickTrack(seconds: number, periodMs: number, offsetMs = 250) {
  const samples = new Float32Array(seconds * RATE)
  let seed = 1
  const noise = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647 * 2 - 1
  }
  for (let k = 0, t = offsetMs; t < seconds * 1000 - 100; k++, t += periodMs) {
    const at = Math.round(t / 1000 * RATE)
    const gain = k % 2 === 0 ? 0.9 : 0.5
    for (let i = 0; i < 400 && at + i < samples.length; i++)
      samples[at + i] += gain * noise() * Math.exp(-i / 60)
  }
  // 微弱的底噪，避免全静音段
  for (let i = 0; i < samples.length; i++)
    samples[i] += 0.002 * noise()
  return samples
}

/** 手工构造的分析结果：拍点 beats（毫秒），响度相同 */
function fakeAnalysis(beats: number[], periodMs: number, confidence = 0.5): RhythmAnalysis {
  return {
    durationMs: (beats.at(-1) ?? 0) + 2000,
    frameMs: 1000 / (RATE / 128),
    frameOffsetMs: 0,
    onset: new Float32Array(0),
    autocorr: new Float32Array(4),
    periodMs,
    basePeriodMs: periodMs,
    bpm: 60000 / periodMs,
    confidence,
    beats: beats.map((t, i) => ({ t, loud: -10, strength: i % 2 === 0 ? 2 : 1 })),
    loudLow: -20,
    loudHigh: -10,
  }
}

describe('节拍分析', () => {
  it('合成的 120 BPM 击打：拍速与拍点都能找准', () => {
    const analysis = analyzeRhythm(clickTrack(30, 500), RATE)
    expect(analysis.bpm).toBeGreaterThan(118)
    expect(analysis.bpm).toBeLessThan(122)
    // 基准周期 τ_F 落在 [0.5, 1) 秒
    expect(analysis.basePeriodMs).toBeGreaterThanOrEqual(480)
    expect(analysis.basePeriodMs).toBeLessThan(1000)
    expect(analysis.confidence).toBeGreaterThan(DEFAULT_RHYTHM_PARAMS.minConfidence)
    // 拍点与击打的偏差在 30ms 内
    const errors = analysis.beats.slice(2, -2).map(beat => Math.abs(((beat.t - 250) % 500 + 750) % 500 - 250))
    expect(Math.max(...errors)).toBeLessThan(30)
  })

  it('太短的音频不分析', () => {
    expect(() => analyzeRhythm(new Float32Array(RATE), RATE)).toThrow()
  })
})

describe('输入信号：冲激串', () => {
  it('补齐空档、逐级二分取强拍、在拍间补中点，各级嵌套', () => {
    // 600ms 一拍，3000 ~ 6000ms 是空档
    const beats = [600, 1200, 1800, 2400, 3000, 6000, 6600, 7200]
    const model = buildRhythmModel(fakeAnalysis(beats, 600), DEFAULT_RHYTHM_PARAMS)
    const level0 = model.trains.get(0)!
    // 空档按拍长补了 4 拍（飞轮），开头补到 50ms 之后
    expect(level0.filter(p => p.synth && p.t > 3000 && p.t < 6000)).toHaveLength(4)
    expect(level0[0].t).toBe(600)
    // 1 级是 0 级的子集，取强拍（偶数下标强度更大）
    const level1 = model.trains.get(1)!
    expect(level1.every(p => level0.includes(p))).toBe(true)
    expect(level1[0].t).toBe(600)
    // −1 级在相邻拍之间插入中点
    expect(model.trains.get(-1)!.map(p => p.t).slice(0, 3)).toEqual([600, 900, 1200])
    expect(trainOf(model, 0)).toBe(level0)
  })

  it('置信度低于阈值或没有拍点时不可信', () => {
    expect(buildRhythmModel(fakeAnalysis([500, 1000], 500, 0.05), DEFAULT_RHYTHM_PARAMS).reliable).toBe(false)
    expect(buildRhythmModel(fakeAnalysis([], 500), DEFAULT_RHYTHM_PARAMS).reliable).toBe(false)
    expect(buildRhythmModel(fakeAnalysis([500, 1000], 500), DEFAULT_RHYTHM_PARAMS).reliable).toBe(true)
  })
})

describe('节奏的解析与回退', () => {
  const model = buildRhythmModel(fakeAnalysis(Array.from({ length: 40 }, (_, i) => 400 + i * 640), 640), DEFAULT_RHYTHM_PARAMS)
  const unreliable = buildRhythmModel(fakeAnalysis([400, 1040], 640, 0.01), DEFAULT_RHYTHM_PARAMS)

  it('跟随节拍：模型可信时用拍点，否则回退到中档；固定快慢直接使用', () => {
    expect(rhythmContext(undefined, model).pace).toBe('beat')
    expect(rhythmContext('beat', model).base).toBe(640)
    expect(rhythmContext('beat', null).pace).toBe('medium')
    expect(rhythmContext('beat', unreliable).pace).toBe('medium')
    expect(rhythmContext('fast', model)).toMatchObject({ pace: 'fast', model: null, base: 520 })
    expect(rhythmContext('slow', null).base).toBe(1000)
  })

  it('时长按基准周期换算：起落曲线、消散淡出；颤音取最接近的档位', () => {
    expect(envelopeScale(rhythmContext('medium', null))).toBe(1)
    expect(envelopeScale(rhythmContext('slow', null))).toBeCloseTo(1.333, 2)
    expect(dissolveFadeMs(rhythmContext('fast', null))).toBeCloseTo(416)
    expect(nearestFixedPace(rhythmContext('beat', model))).toBe('medium')
    expect(nearestFixedPace(rhythmContext('slow', null))).toBe('slow')
  })

  it('固定快慢：从起点起每 T_e 一个脉冲；跟随节拍：取检测到的拍', () => {
    expect(pulsesIn(rhythmContext('medium', null), 0, 1000, 1000, 3000).map(p => p.t)).toEqual([1000, 1750, 2500])
    expect(pulsesIn(rhythmContext('medium', null), 1, 1000, 1000, 3000).map(p => p.t)).toEqual([1000, 2500])
    expect(pulsesIn(rhythmContext('beat', model), 0, 1000, 1000, 3000).map(p => p.t)).toEqual([1040, 1680, 2320, 2960])
  })
})

describe('各动效的输出', () => {
  const beats = Array.from({ length: 40 }, (_, i) => 400 + i * 640)
  const model = buildRhythmModel(fakeAnalysis(beats, 640), DEFAULT_RHYTHM_PARAMS)
  const lead = DEFAULT_RHYTHM_PARAMS.leadMs
  const attack = DEFAULT_RHYTHM_PARAMS.heartbeat.attackMs

  it('心跳：每拍「扑通-扑通」，峰值在拍后 τ_a；跟随节拍时落在检测到的拍上而不是开唱时刻', () => {
    const medium = rhythmContext('medium', null)
    // 中档从开唱（1000ms）起每 750ms 一拍
    expect(heartbeatLevel(medium, 1000, 3000, 1000 + attack - lead)).toBeGreaterThan(0.9)
    expect(heartbeatLevel(medium, 1000, 3000, 1000 + 500)).toBeLessThan(0.15)
    expect(heartbeatLevel(medium, 1000, 3000, 1750 + attack - lead)).toBeGreaterThan(0.9)
    // 跟随节拍：拍在 1040、1680……
    const beat = rhythmContext('beat', model)
    expect(heartbeatLevel(beat, 1000, 3000, 1040 + attack - lead)).toBeGreaterThan(0.9)
    expect(heartbeatLevel(beat, 1000, 3000, 1680 + attack - lead)).toBeGreaterThan(0.9)
    // 开唱时刻（1000ms）还没到拍，不跳
    expect(heartbeatLevel(beat, 1000, 3000, 960)).toBeLessThan(0.05)
  })

  it('柔光：开唱前渐亮、持续到行尾后熄灭，亮度随拍呼吸（峰值落在拍上）', () => {
    const ctx = rhythmContext('beat', model)
    expect(glowLevel(ctx, 1000, 4000, 700).gate).toBe(0)
    expect(glowLevel(ctx, 1000, 4000, 2000).gate).toBe(1)
    expect(glowLevel(ctx, 1000, 4000, 4500).gate).toBe(0)
    // 柔光的周期为 2 拍：拍上最亮
    const onBeat = glowLevel(ctx, 1000, 4000, 1680 - lead).y
    const between = glowLevel(ctx, 1000, 4000, 2000 - lead).y
    expect(onBeat).toBeGreaterThan(between)
  })

  it('波浪：拍后波峰从首字走到末字', () => {
    const ctx = rhythmContext('medium', null)
    const early = waveLevels(ctx, 1000, 3000, 4, 1000 + 80 - lead)
    expect(early[0]).toBeGreaterThan(early[3])
    const late = waveLevels(ctx, 1000, 3000, 4, 1000 + 400 - lead)
    expect(late[3]).toBeGreaterThan(late[0])
  })

  it('流光：从唱到时的第一拍起每拍扫一遍，扫两遍后停止', () => {
    const ctx = rhythmContext('medium', null)
    expect(shimmerCenter(ctx, 1000, 900, 4)).toBeNull()
    expect(shimmerCenter(ctx, 1000, 1000 - lead, 4)).toBe(-1)
    expect(shimmerCenter(ctx, 1000, 1000 + 375 - lead, 4)).toBeCloseTo(2)
    expect(shimmerCenter(ctx, 1000, 1000 + 750 * 1.5 - lead, 4)).toBeCloseTo(2)
    expect(shimmerCenter(ctx, 1000, 1000 + 750 * 2 - lead, 4)).toBeNull()
  })

  it('间奏圆点：每个拍点在吸 / 呼之间翻转一次', () => {
    const ctx = rhythmContext('medium', null)
    // 中档 T_b = 750ms，八度取使 T_e 最接近 2 秒的 1（1500ms）
    expect(breathScale(ctx, 0, 20_000, 0)).toBe(1)
    expect(breathScale(ctx, 0, 20_000, 1400)).toBeCloseTo(1.2, 1)
    expect(breathScale(ctx, 0, 20_000, 2900)).toBeCloseTo(0.9, 1)
  })

  it('背景呼吸与粒子只在跟随节拍时演出', () => {
    const fixed = rhythmContext('medium', null)
    expect(backgroundLevel(fixed, 1100)).toBe(0)
    expect(particlePulses(fixed, 0, 1000, 1100)).toBeNull()
    const beat = rhythmContext('beat', model)
    expect(backgroundLevel(beat, 1040 + 30 - lead)).toBeGreaterThan(0.7)
    expect(particlePulses(beat, 0, 1000, 1100)!.map(p => p.t)).toEqual([1040])
  })
})
