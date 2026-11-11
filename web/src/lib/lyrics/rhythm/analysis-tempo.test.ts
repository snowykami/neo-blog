import type { RhythmAnalysis } from './analysis'
import { describe, expect, it } from 'vitest'
import { analyzeRhythm } from './analysis'

const RATE = 11025

/** 确定性白噪声（只用来合成鼓声，不参与统计） */
function noiseSource(seed: number) {
  let state = seed
  return () => {
    state = (state * 16807) % 2147483647
    return state / 2147483647 * 2 - 1
  }
}

type Instrument = 'kick' | 'snare' | 'hat'

/** 每小节（4/4）里各乐器的击打位置，单位为拍（0 = 第一拍） */
const PATTERNS: Record<string, { beats: Record<Instrument, number[]>, gain: Record<Instrument, number> }> = {
  // 常见的流行鼓点：底鼓 1、3；军鼓 2、4；八分音符的镲（响度明显低于鼓）
  pop: { beats: { kick: [0, 2], snare: [1, 3], hat: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5] }, gain: { kick: 1, snare: 0.55, hat: 0.12 } },
  // 半拍 feel：底鼓每小节一下、军鼓落第 3 拍，同样铺八分镲
  half_time: { beats: { kick: [0], snare: [2], hat: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5] }, gain: { kick: 1, snare: 0.5, hat: 0.13 } },
  // 没有底鼓，只有军鼓与八分镲
  hat_led: { beats: { kick: [], snare: [1, 3], hat: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5] }, gain: { kick: 0, snare: 0.5, hat: 0.16 } },
}

/** 合成一段鼓：按 bpm 的小节网格逐乐器叠加（底鼓为低频扫频正弦，军鼓为噪声 + 190 Hz 鼓身，镲为高通噪声） */
function drumTrack(bpm: number, pattern: keyof typeof PATTERNS, seconds = 24) {
  const samples = new Float32Array(Math.round(seconds * RATE))
  const rand = noiseSource(1)
  const beatMs = 60000 / bpm
  const { beats, gain } = PATTERNS[pattern]
  const add = (tMs: number, length: number, render: (t: number) => number) => {
    const start = Math.round(tMs / 1000 * RATE)
    for (let i = 0; i < length && start + i < samples.length; i++) {
      if (start + i >= 0)
        samples[start + i] += render(i / RATE)
    }
  }
  for (let barStart = 400; barStart < seconds * 1000 - 200; barStart += beatMs * 4) {
    for (const position of beats.kick) {
      add(barStart + position * beatMs, Math.round(0.16 * RATE), t => gain.kick * Math.sin(2 * Math.PI * (110 * Math.exp(-t / 0.02) + 50) * t) * Math.exp(-t / 0.045))
    }
    for (const position of beats.snare) {
      add(barStart + position * beatMs, Math.round(0.12 * RATE), t => gain.snare * (Math.sin(2 * Math.PI * 190 * t) * 0.35 + rand() * 0.9) * Math.exp(-t / 0.035))
    }
    for (const position of beats.hat) {
      // 相邻样本差分充当高通，突出高频；偶数拍的镲稍晚一点，模拟人耳的轻微摇摆
      const swing = Number.isInteger(position) && position % 2 === 1 ? beatMs * 0.02 : 0
      let last = 0
      add(barStart + position * beatMs + swing, Math.round(0.06 * RATE), (t) => {
        const v = rand()
        const high = v - last
        last = v
        return gain.hat * high * Math.exp(-t / 0.01)
      })
    }
  }
  return samples
}

/** 八度误差：0 = 与真值一致，+1 = 判成两倍，−1 = 判成一半 */
function octaveError(analysis: RhythmAnalysis, bpm: number) {
  // `|| 0` 把 −0 归一成 0，免得 Object.is 判成不相等
  return Math.round(Math.log2(analysis.bpm / bpm)) || 0
}

const TEMPOS = [74, 88, 96, 100, 120, 140, 160, 172, 180]
const NAMES = Object.keys(PATTERNS) as (keyof typeof PATTERNS)[]

// 每个用例都要合成并分析几十段不同鼓型、不同拍速的音频，空闲时也要 4 秒左右，机器繁忙时会超过默认的 5 秒；给足时间，避免偶发超时
describe('拍速估计', { timeout: 30_000 }, () => {
  it('常速（88 ~ 160 BPM）在三种鼓型下都能给对 BPM', () => {
    for (const pattern of NAMES) {
      for (const bpm of TEMPOS.filter(v => v >= 88 && v <= 160)) {
        const analysis = analyzeRhythm(drumTrack(bpm, pattern), RATE)
        expect(octaveError(analysis, bpm), `${pattern} ${bpm} BPM → ${analysis.bpm.toFixed(0)}`).toBe(0)
      }
    }
  })

  it('范围两端（65 ~ 80、165 ~ 185 BPM）最多差一个八度，不会越界到两倍', () => {
    // 自相关在 T 的每个整数倍上都有峰，这两个区间客观上就是"数拍还是数半拍"的取舍；
    // 现在是 74 → 148、172 → 86、180 → 90 这种一倍的偏差，见下面的注释
    for (const pattern of NAMES) {
      for (const bpm of TEMPOS) {
        const analysis = analyzeRhythm(drumTrack(bpm, pattern), RATE)
        expect(Math.abs(octaveError(analysis, bpm)), `${pattern} ${bpm} BPM → ${analysis.bpm.toFixed(0)}`).toBeLessThanOrEqual(1)
      }
    }
  })

  it('母带压得很狠（整首只有两三 dB 动态）时仍然有拍点', () => {
    // 静音门槛是"低分位 + 6 dB"，压平的曲子这个门槛会高过所有拍点，曾经整首一个拍点都不剩（全交给飞轮）
    const flat = drumTrack(120, 'pop').map(v => Math.tanh(v * 6) * 0.9)
    const analysis = analyzeRhythm(Float32Array.from(flat), RATE)
    expect(analysis.beats.length).toBeGreaterThan(30)
    expect(octaveError(analysis, 120)).toBe(0)
  })

  it('整首一致：BPM 只在一个八度族里取值，基准周期 τ_F 始终落在 [0.5, 1) 秒', () => {
    for (const pattern of NAMES) {
      for (const bpm of TEMPOS) {
        const analysis = analyzeRhythm(drumTrack(bpm, pattern), RATE)
        expect(analysis.basePeriodMs).toBeGreaterThanOrEqual(480)
        expect(analysis.basePeriodMs).toBeLessThan(1000)
        // T* 与 τ_F 相差不超过一个八度
        expect(Math.abs(Math.log2(analysis.basePeriodMs / analysis.periodMs))).toBeLessThanOrEqual(1.05)
      }
    }
  })
})
