/**
 * 拍速八度回归集：合成带真值拍速的鼓 + 乐器音轨（只供测试使用，不依赖其他模块）。
 *
 * 真值约定为乐谱上的四分音符（鼓手数的拍）：流行 / 抒情的军鼓落在 2、4 拍，镲按八分或十六分铺；
 * 半拍 feel 的军鼓只落第 3 拍，真值仍按谱面拍速。"抒情 + 十六分镲"与"两倍拍速的半拍 feel"
 * 在信号上只差一个时间缩放，客观上不可分，所以回归集里两者的拍速区间不重叠（抒情 ≤ 66、半拍 ≥ 150），
 * 不出现同一种信号在相邻拍速上要求相反八度的情况。
 *
 * 写实的部分：人手的时值抖动与力度起伏、摇摆、切分、半拍 feel、强十六分细分、随机漏拍、
 * 底噪、与拍无关的人声长音、按小节换和弦的铺底、低音与钢琴的音高起音。
 */

export const FIXTURE_RATE = 11025

export type TempoStyle
  = | 'pop' // 底鼓 1、3，军鼓 2、4，八分镲
    | 'ballad' // 慢歌：底鼓 1、3⁺，轻军鼓 2、4，很轻的八分镲，钢琴八分分解和弦，铺底按小节换
    | 'ballad16' // 慢歌 + 很轻的十六分镲
    | 'piano_ballad' // 没有鼓：钢琴每拍一个和弦、八分分解，低音每小节两下
    | 'half_time' // 半拍 feel：底鼓 1，军鼓 3，八分镲
    | 'rock16' // 强十六分镲（细分很强），底鼓 1、3、3⁺，军鼓 2、4
    | 'four_floor' // 每拍底鼓，2、4 拍手掌，反拍开镲
    | 'shuffle' // 三连音摇摆的八分镲
    | 'funk' // 切分：底鼓 1、2a、3⁺，军鼓 2、4 + 鬼音，十六分镲
    | 'fast' // 快歌：底鼓 1、3⁺，军鼓 2、4，八分镲（170 ~ 180 BPM）

export interface TempoCaseOptions {
  noise?: number // 底噪幅度（相对底鼓 1.0）
  dropout?: number // 每个击打被漏掉的概率
  jitterMs?: number // 时值抖动的标准差
  vocal?: boolean // 叠一条与拍无关的人声长音
  seconds?: number
}

export interface TempoCase {
  id: string
  bpm: number
  style: TempoStyle
  options: TempoCaseOptions
  /** 曾经判错八度的慢歌（修复前的已知失败） */
  slow: boolean
  render: () => Float32Array
}

function rng(seed: number) {
  let state = (seed % 2147483646) + 1
  const next = () => {
    state = (state * 16807) % 2147483647
    return state / 2147483647
  }
  return {
    next,
    signed: () => next() * 2 - 1,
    gauss: () => {
      const u = Math.max(1e-9, next())
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next())
    },
  }
}

type Hit = 'kick' | 'snare' | 'ghost' | 'hat' | 'open' | 'clap'

interface Pattern {
  bar: number // 每小节几拍
  hits: [Hit, number, number][] // 乐器、位置（拍）、力度
  piano?: number[] // 钢琴音的位置（拍）
  bass?: number[]
  chordEvery?: number // 铺底每几拍换一次和弦
}

function grid(step: number, gain: number, hit: Hit = 'hat', bar = 4): [Hit, number, number][] {
  const out: [Hit, number, number][] = []
  for (let p = 0; p < bar - 1e-9; p += step)
    out.push([hit, p, gain * (Math.abs(p - Math.round(p)) < 1e-9 ? 1 : 0.8)])
  return out
}

const PATTERNS: Record<TempoStyle, Pattern> = {
  pop: { bar: 4, hits: [['kick', 0, 1], ['kick', 2, 0.9], ['snare', 1, 0.6], ['snare', 3, 0.6], ...grid(0.5, 0.12)], bass: [0, 2], chordEvery: 4 },
  ballad: { bar: 4, hits: [['kick', 0, 0.8], ['kick', 2.5, 0.5], ['snare', 1, 0.4], ['snare', 3, 0.4], ...grid(0.5, 0.06)], piano: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], bass: [0, 2], chordEvery: 4 },
  ballad16: { bar: 4, hits: [['kick', 0, 0.8], ['kick', 2.5, 0.5], ['snare', 1, 0.4], ['snare', 3, 0.4], ...grid(0.25, 0.05)], piano: [0, 1, 2, 3], bass: [0, 2], chordEvery: 4 },
  piano_ballad: { bar: 4, hits: [], piano: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], bass: [0, 2], chordEvery: 2 },
  half_time: { bar: 4, hits: [['kick', 0, 1], ['snare', 2, 0.6], ...grid(0.5, 0.13)], bass: [0], chordEvery: 8 },
  rock16: { bar: 4, hits: [['kick', 0, 1], ['kick', 2, 0.9], ['kick', 2.5, 0.7], ['snare', 1, 0.6], ['snare', 3, 0.6], ...grid(0.25, 0.3)], bass: [0, 2, 2.5], chordEvery: 4 },
  four_floor: { bar: 4, hits: [['kick', 0, 1], ['kick', 1, 1], ['kick', 2, 1], ['kick', 3, 1], ['clap', 1, 0.5], ['clap', 3, 0.5], ['open', 0.5, 0.2], ['open', 1.5, 0.2], ['open', 2.5, 0.2], ['open', 3.5, 0.2]], bass: [0.5, 1.5, 2.5, 3.5], chordEvery: 8 },
  shuffle: { bar: 4, hits: [['kick', 0, 1], ['kick', 2, 0.9], ['snare', 1, 0.6], ['snare', 3, 0.6], ...[0, 1, 2, 3].flatMap(b => [['hat', b, 0.13], ['hat', b + 2 / 3, 0.09]] as [Hit, number, number][])], bass: [0, 2, 2 + 2 / 3], chordEvery: 4 },
  funk: { bar: 4, hits: [['kick', 0, 1], ['kick', 1.75, 0.7], ['kick', 2.5, 0.8], ['snare', 1, 0.6], ['snare', 3, 0.6], ['ghost', 1.5, 0.15], ['ghost', 3.25, 0.15], ['ghost', 3.75, 0.2], ...grid(0.25, 0.1)], bass: [0, 0.75, 1.75, 2.5], chordEvery: 4 },
  fast: { bar: 4, hits: [['kick', 0, 1], ['kick', 2.5, 0.8], ['snare', 1, 0.6], ['snare', 3, 0.6], ...grid(0.5, 0.12)], bass: [0, 2.5], chordEvery: 8 },
}

// C 大调的几个和弦（Hz）
const CHORDS = [[261.6, 329.6, 392], [220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7]]

export function renderTempoCase(bpm: number, style: TempoStyle, options: TempoCaseOptions = {}, seed = 1): Float32Array {
  const seconds = options.seconds ?? 30
  const samples = new Float32Array(Math.round(seconds * FIXTURE_RATE))
  const r = rng(seed * 7919 + Math.round(bpm * 10))
  const beatMs = 60000 / bpm
  const pattern = PATTERNS[style]
  const jitter = options.jitterMs ?? 8
  const add = (tMs: number, length: number, render: (t: number) => number) => {
    const start = Math.round(tMs / 1000 * FIXTURE_RATE)
    for (let i = 0; i < length && start + i < samples.length; i++) {
      if (start + i >= 0)
        samples[start + i] += render(i / FIXTURE_RATE)
    }
  }
  const strike = (hit: Hit, tMs: number, gain: number) => {
    switch (hit) {
      case 'kick':
        add(tMs, Math.round(0.16 * FIXTURE_RATE), t => gain * Math.sin(2 * Math.PI * (110 * Math.exp(-t / 0.02) + 50) * t) * Math.exp(-t / 0.045))
        break
      case 'snare':
      case 'ghost':
        add(tMs, Math.round(0.12 * FIXTURE_RATE), t => gain * (Math.sin(2 * Math.PI * 190 * t) * 0.35 + r.signed() * 0.9) * Math.exp(-t / 0.035))
        break
      case 'clap':
        add(tMs, Math.round(0.1 * FIXTURE_RATE), t => gain * r.signed() * (Math.exp(-t / 0.008) + 0.6 * Math.exp(-Math.max(0, t - 0.012) / 0.03) * (t > 0.012 ? 1 : 0)))
        break
      case 'hat':
      case 'open': {
        let last = 0
        const decay = hit === 'open' ? 0.06 : 0.01
        add(tMs, Math.round((hit === 'open' ? 0.2 : 0.06) * FIXTURE_RATE), (t) => {
          const v = r.signed()
          const high = v - last
          last = v
          return gain * high * Math.exp(-t / decay)
        })
        break
      }
    }
  }
  const tone = (tMs: number, freq: number, gain: number, decayS: number, lengthS: number) => {
    const phase = r.next() * Math.PI * 2
    add(tMs, Math.round(lengthS * FIXTURE_RATE), t => gain * Math.min(1, t / 0.004) * Math.exp(-t / decayS) * (Math.sin(2 * Math.PI * freq * t + phase) + 0.3 * Math.sin(4 * Math.PI * freq * t)))
  }

  const startMs = 300 + r.next() * 200
  const barMs = beatMs * pattern.bar
  let chordIndex = 0
  for (let bar = startMs; bar < seconds * 1000 - 100; bar += barMs) {
    // 每小节的力度起伏（乐句）
    const phrase = 0.85 + 0.15 * r.next()
    const at = (position: number) => bar + position * beatMs + r.gauss() * jitter
    for (const [hit, position, gain] of pattern.hits) {
      if (options.dropout && r.next() < options.dropout)
        continue
      strike(hit, at(position), gain * phrase * (0.85 + 0.3 * r.next()))
    }
    const chord = CHORDS[chordIndex % CHORDS.length]
    for (const [i, position] of (pattern.piano ?? []).entries()) {
      if (options.dropout && r.next() < options.dropout)
        continue
      const freq = chord[i % chord.length] * (i % 4 === 3 ? 2 : 1)
      tone(at(position), freq, 0.18 * phrase * (i === 0 ? 1.3 : 0.9 + 0.2 * r.next()), 0.35, 0.6)
    }
    for (const position of pattern.bass ?? [])
      tone(at(position), chord[0] / 4, 0.35 * phrase, 0.25, 0.4)
    // 铺底：每 chordEvery 拍换和弦，起音缓慢（80 ms），持续到下一个和弦
    const every = pattern.chordEvery ?? 4
    for (let p = 0; p < pattern.bar; p += every) {
      const c = CHORDS[(chordIndex + Math.floor(p / every)) % CHORDS.length]
      const length = Math.min(every, pattern.bar - p) * beatMs / 1000
      add(bar + p * beatMs, Math.round(length * FIXTURE_RATE), t => 0.05 * Math.min(1, t / 0.08) * Math.min(1, (length - t) / 0.05) * c.reduce((sum, f) => sum + Math.sin(2 * Math.PI * f * t), 0))
    }
    chordIndex += Math.max(1, Math.floor(pattern.bar / every))
  }

  if (options.vocal) {
    // 人声长音：音高按随机时长（与拍无关）在音阶上跳动，带 5.5 Hz 颤音，起音柔和
    let t = startMs + r.next() * 700
    while (t < seconds * 1000 - 500) {
      const length = 0.4 + r.next() * 1.6
      const freq = [392, 440, 523.3, 587.3, 659.3][Math.floor(r.next() * 5)]
      add(t, Math.round(length * FIXTURE_RATE), u => 0.12 * Math.min(1, u / 0.06) * Math.min(1, (length - u) / 0.1) * Math.sin(2 * Math.PI * freq * u + 0.4 * Math.sin(2 * Math.PI * 5.5 * u)))
      t += length * 1000 + r.next() * 400
    }
  }

  if (options.noise) {
    for (let i = 0; i < samples.length; i++)
      samples[i] += options.noise * r.signed()
  }
  return samples
}

const STYLE_TEMPOS: Record<TempoStyle, number[]> = {
  ballad: [50, 54, 58, 62, 66, 72, 78],
  ballad16: [50, 54, 58, 62, 66],
  piano_ballad: [52, 60, 68, 76, 84],
  pop: [66, 72, 80, 88, 96, 104, 112, 120, 128, 136, 144, 152, 160],
  half_time: [150, 160, 170, 180],
  rock16: [84, 96, 108, 120, 132, 140],
  four_floor: [110, 120, 128, 136, 145],
  shuffle: [72, 84, 96, 108, 120, 132],
  funk: [88, 96, 104, 112, 120],
  fast: [165, 172, 180],
}

/** 每种鼓型 × 拍速，再按序号轮流加上漏拍、底噪、强抖动与人声（每种组合都覆盖到） */
export function tempoRegressionSet(): TempoCase[] {
  const cases: TempoCase[] = []
  let n = 0
  for (const style of Object.keys(STYLE_TEMPOS) as TempoStyle[]) {
    for (const bpm of STYLE_TEMPOS[style]) {
      const variant = n % 4
      const options: TempoCaseOptions = {
        vocal: variant !== 0,
        dropout: variant === 1 ? 0.25 : undefined,
        noise: variant === 2 ? 0.08 : 0.004,
        jitterMs: variant === 3 ? 18 : 8,
      }
      const seed = ++n
      const tags = [variant === 1 && 'dropout', variant === 2 && 'noise', variant === 3 && 'jitter', options.vocal && 'vocal'].filter(Boolean).join('+')
      cases.push({
        id: `${style}@${bpm}${tags ? ` [${tags}]` : ''}`,
        bpm,
        style,
        options,
        slow: bpm < 64,
        render: () => renderTempoCase(bpm, style, options, seed),
      })
    }
  }
  return cases
}
