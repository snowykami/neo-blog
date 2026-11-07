/**
 * 音频节拍分析（纯函数，在 Web Worker 中运行，见 rhythm.worker.ts）：
 * 1. 谱通量起音强度（log 压缩幅度谱的半波整流差分），减去 0.4 秒滑动平均后归一化；同时记录响度
 * 2. 拍速：起音强度的自相关 R(τ)，按八度族 F(τ) = R(τ/2) + R(τ) + ½R(2τ) 在 [0.5, 1) 秒内找基准周期 τ_F，
 *    再从 {τ_F/2, τ_F, 2τ_F} 中按"整数倍谐波的梳状和 × 对数高斯先验（中心 0.5 秒）"选出音乐拍长 T*；
 *    置信度 c = R(T*) / R(0)。自相关在 T 的每个整数倍上都可能有峰，梳状和与先验一起判八度
 * 3. 拍点：动态规划（Ellis 2007）在起音强度上找间隔接近 T* 的拍点序列，去掉静音段的拍点
 * 输入为单声道、采样率 sampleRate 的样本（建议 11025 Hz），时间均以毫秒为单位
 */

export interface RhythmBeat {
  t: number // 毫秒
  loud: number // 平滑后的响度（dB）
  strength: number // 起音强度
}

export interface RhythmAnalysis {
  durationMs: number
  // 起音强度的帧间隔与第 0 帧中心对应的时刻（毫秒）
  frameMs: number
  frameOffsetMs: number
  onset: Float32Array
  // 起音强度的自相关（按帧数为滞后），用于拍速图
  autocorr: Float32Array
  // 音乐拍长 T* 与八度族在 [0.5, 1) 秒内的代表 τ_F（毫秒）
  periodMs: number
  basePeriodMs: number
  bpm: number
  confidence: number
  beats: RhythmBeat[]
  // 响度的 10% / 95% 分位，用于换算拍的强弱
  loudLow: number
  loudHigh: number
}

const FFT_SIZE = 1024
const HOP = 128
const FLUX_GAMMA = 10
const DP_ALPHA = 100
// 拍点步长的允许范围（周期的倍数）：过宽会让拍点序列在歌曲中途漂到两倍/一半的网格
const DP_WINDOW = 1.35
// 拍速先验：人跟着数拍子最舒服在 0.5 秒（120 BPM）附近，偏一个八度就明显不自然。
// 标准差按八度算：0.7 表示差一倍时权重降到 0.36，仍能被足够强的自相关峰压过去
const TEMPO_PRIOR_PERIOD_S = 0.5
const TEMPO_PRIOR_SIGMA = 0.7

function makeFFT(n: number) {
  const rev = new Uint32Array(n)
  const bits = Math.log2(n)
  for (let i = 0; i < n; i++) {
    let r = 0
    for (let b = 0; b < bits; b++)
      r |= ((i >> b) & 1) << (bits - 1 - b)
    rev[i] = r
  }
  const cos = new Float64Array(n / 2)
  const sin = new Float64Array(n / 2)
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos(2 * Math.PI * i / n)
    sin[i] = Math.sin(2 * Math.PI * i / n)
  }
  return (re: Float64Array, im: Float64Array) => {
    for (let i = 0; i < n; i++) {
      const j = rev[i]
      if (j > i) {
        let t = re[i]
        re[i] = re[j]
        re[j] = t
        t = im[i]
        im[i] = im[j]
        im[j] = t
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1
      const step = n / size
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half
          const tre = re[l] * cos[k] + im[l] * sin[k]
          const tim = im[l] * cos[k] - re[l] * sin[k]
          re[l] = re[j] - tre
          im[l] = im[j] - tim
          re[j] += tre
          im[j] += tim
        }
      }
    }
  }
}

/** 滑动平均（半宽 half 帧） */
function movingAverage(values: Float32Array, half: number): Float32Array {
  const prefix = new Float64Array(values.length + 1)
  for (let i = 0; i < values.length; i++)
    prefix[i + 1] = prefix[i] + values[i]
  const out = new Float32Array(values.length)
  for (let i = 0; i < values.length; i++) {
    const a = Math.max(0, i - half)
    const b = Math.min(values.length, i + half + 1)
    out[i] = (prefix[b] - prefix[a]) / (b - a)
  }
  return out
}

export function percentile(values: ArrayLike<number>, q: number): number {
  if (values.length === 0)
    return 0
  const sorted = Float32Array.from(values).sort()
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
}

/** 各声道取平均混成单声道（同 Web Audio 的 0.5·(L+R)）；只有一个声道时直接返回 */
export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1)
    return channels[0]
  const length = channels.reduce((min, channel) => Math.min(min, channel.length), Infinity)
  const mono = new Float32Array(Number.isFinite(length) ? length : 0)
  const scale = 1 / channels.length
  for (const channel of channels) {
    for (let i = 0; i < mono.length; i++)
      mono[i] += channel[i] * scale
  }
  return mono
}

/**
 * 动态规划找拍点（Ellis 2007）：score(t) = x(t) + max over τ of score(τ) − λ·log²((t−τ)/T)，
 * 步长限制在 T / DP_WINDOW ~ T · DP_WINDOW 之间：原来允许 T/2 ~ 2T，序列容易在歌曲中途漂到
 * 两倍或一半的网格上，导致"面板显示 100 BPM、实际按 50 BPM 跳"
 */
function trackBeats(onset: Float32Array, period: number, frames: number): number[] {
  const score = new Float64Array(frames)
  const back = new Int32Array(frames).fill(-1)
  const longest = Math.max(1, Math.round(period * DP_WINDOW))
  const shortest = Math.max(1, Math.round(period / DP_WINDOW))
  for (let t = 0; t < frames; t++) {
    let best = -Infinity
    let arg = -1
    for (let tau = Math.max(0, t - longest); tau <= t - shortest; tau++) {
      const s = score[tau] - DP_ALPHA * Math.log((t - tau) / period) ** 2
      if (s > best) {
        best = s
        arg = tau
      }
    }
    score[t] = onset[t] + Math.max(0, best)
    back[t] = best > 0 ? arg : -1
  }
  let end = frames - 1
  for (let t = Math.max(0, frames - Math.round(period)); t < frames; t++) {
    if (score[t] > score[end])
      end = t
  }
  const beatFrames: number[] = []
  for (let t = end; t >= 0; t = back[t])
    beatFrames.push(t)
  return beatFrames.reverse()
}

export function analyzeRhythm(samples: Float32Array, sampleRate: number, onProgress?: (progress: number) => void): RhythmAnalysis {
  const frameRate = sampleRate / HOP
  const frames = Math.max(0, Math.floor((samples.length - FFT_SIZE) / HOP) + 1)
  const durationMs = samples.length / sampleRate * 1000
  const frameMs = 1000 / frameRate
  const frameOffsetMs = FFT_SIZE / 2 / sampleRate * 1000
  if (frames < frameRate * 4)
    throw new Error('audio too short')

  // 1. 谱通量起音强度 + 响度
  const win = new Float64Array(FFT_SIZE).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / FFT_SIZE))
  const fft = makeFFT(FFT_SIZE)
  const re = new Float64Array(FFT_SIZE)
  const im = new Float64Array(FFT_SIZE)
  const prev = new Float64Array(FFT_SIZE / 2 + 1)
  const flux = new Float32Array(frames)
  const loud = new Float32Array(frames)
  for (let m = 0; m < frames; m++) {
    const off = m * HOP
    let energy = 0
    for (let i = 0; i < FFT_SIZE; i++) {
      const v = samples[off + i]
      re[i] = v * win[i]
      im[i] = 0
      energy += v * v
    }
    loud[m] = 10 * Math.log10(energy / FFT_SIZE + 1e-10)
    fft(re, im)
    let sum = 0
    for (let k = 1; k <= FFT_SIZE / 2; k++) {
      const y = Math.log1p(FLUX_GAMMA * Math.hypot(re[k], im[k]))
      const d = y - prev[k]
      if (d > 0 && m > 0)
        sum += d
      prev[k] = y
    }
    flux[m] = sum
    if (onProgress && m % 4000 === 0)
      onProgress(m / frames * 0.85)
  }

  // 去掉缓慢变化（0.4 秒滑动平均），半波整流并按均方根归一化
  const trend = movingAverage(flux, Math.round(0.4 * frameRate))
  const onset = new Float32Array(frames)
  let squares = 0
  for (let m = 0; m < frames; m++) {
    onset[m] = Math.max(0, flux[m] - trend[m])
    squares += onset[m] * onset[m]
  }
  const rms = Math.sqrt(squares / frames) || 1
  for (let m = 0; m < frames; m++)
    onset[m] /= rms
  const loudSmooth = movingAverage(loud, Math.round(0.25 * frameRate))

  // 2. 拍速：自相关后按八度族折叠
  onProgress?.(0.88)
  const maxLag = Math.ceil(frameRate * 4)
  const autocorr = new Float32Array(maxLag + 2)
  for (let tau = 0; tau <= maxLag + 1; tau++) {
    let sum = 0
    for (let m = 0; m + tau < frames; m++)
      sum += onset[m] * onset[m + tau]
    autocorr[tau] = sum / (frames - tau)
  }
  const R = (tau: number) => {
    const i = Math.floor(tau)
    const f = tau - i
    return i + 1 < autocorr.length ? autocorr[i] * (1 - f) + autocorr[i + 1] * f : 0
  }
  const family = (tau: number) => R(tau / 2) + R(tau) + 0.5 * R(2 * tau)
  let familyBest = frameRate * 0.5
  for (let tau = frameRate * 0.5; tau < frameRate; tau += 0.25) {
    if (family(tau) > family(familyBest))
      familyBest = tau
  }
  const prior = (tau: number) => Math.exp(-0.5 * (Math.log2(tau / frameRate / TEMPO_PRIOR_PERIOD_S) / TEMPO_PRIOR_SIGMA) ** 2)
  // 只数整数倍谐波的梳状和：真拍长在 T、2T、3T、4T 上都有能量，两倍的候选只有 2T、4T（缺 T 与 3T），
  // 一半的候选只有 T/2、T、3T/2（缺 3T 与 4T）——这个不对称正是判八度的依据
  const comb = (tau: number) => R(tau) + R(2 * tau) / 2 + R(3 * tau) / 3 + R(4 * tau) / 4
  const members = [familyBest / 2, familyBest, familyBest * 2].filter(tau => tau >= frameRate * 0.25 && tau <= frameRate * 1.5)
  const tempoScore = (tau: number) => prior(tau) * comb(tau)
  const period = members.reduce((best, tau) => (tempoScore(tau) > tempoScore(best) ? tau : best))
  const confidence = autocorr[0] > 0 ? R(period) / autocorr[0] : 0

  // 3. 节拍：动态规划
  onProgress?.(0.94)
  const beatFrames = trackBeats(onset, period, frames)
  // 静音段（低于 5% 分位 + 6 dB）的拍点去掉，由飞轮补拍（见 model.ts）。母带压得很狠（整首只有
  // 两三 dB 动态）时这个门槛会高过所有拍点、整首一个都不剩，所以再夹一道"不高于中位数 − 3 dB"
  const loudFloor = Math.min(percentile(loudSmooth, 0.05) + 6, percentile(loudSmooth, 0.5) - 3)
  const beats = beatFrames
    .filter(b => loudSmooth[b] > loudFloor)
    .map(b => ({ t: b * frameMs + frameOffsetMs, loud: loudSmooth[b], strength: onset[b] }))

  onProgress?.(1)
  return {
    durationMs,
    frameMs,
    frameOffsetMs,
    onset,
    autocorr,
    periodMs: period * frameMs,
    basePeriodMs: familyBest * frameMs,
    bpm: 60000 / (period * frameMs),
    confidence,
    beats,
    loudLow: percentile(loudSmooth, 0.1),
    loudHigh: percentile(loudSmooth, 0.95),
  }
}
