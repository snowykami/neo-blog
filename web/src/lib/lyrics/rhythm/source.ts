import type { RhythmAnalysis } from './analysis'
import type { RhythmModel } from './model'
import { buildRhythmModel } from './model'
import { getRhythmParams, subscribeRhythmParams } from './params'

/**
 * 每首歌的节拍分析（只在前端进行，后端不存）：播放时下载同一份音频，以 11025 Hz 单声道解码后交给 Worker 分析，结果按歌曲缓存在内存中。
 * 桌面端与移动端行为一致，只在开启歌词特效时分析（见 music-context.tsx）。
 * 拿不到结果时（不是站内代理的音频、浏览器开启了省流量、下载或解码失败、节拍不可信）动效回退到固定快慢（见 effects.ts 的 rhythmContext）
 */

export type RhythmUnavailableReason = 'unsupported_source' | 'save_data' | 'unsupported_browser' | 'fetch_failed' | 'decode_failed' | 'analysis_failed'

export type RhythmState
  = | { status: 'loading', progress: number }
    | { status: 'ready', model: RhythmModel, elapsedMs: number }
    | { status: 'unavailable', reason: RhythmUnavailableReason }

const SAMPLE_RATE = 11025
const MAX_CACHED_SONGS = 8

const states = new Map<number, RhythmState>()
const listeners = new Set<() => void>()
let worker: Worker | null = null
let requestId = 0

function emit() {
  listeners.forEach(listener => listener())
}

function setState(songId: number, state: RhythmState) {
  states.delete(songId)
  states.set(songId, state)
  // 按插入顺序淘汰最早的（正在分析的不淘汰）
  for (const [id, entry] of states) {
    if (states.size <= MAX_CACHED_SONGS)
      break
    if (entry.status !== 'loading')
      states.delete(id)
  }
  emit()
}

export function subscribeRhythm(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getRhythmState(songId: number | null | undefined): RhythmState | null {
  return songId == null ? null : states.get(songId) ?? null
}

/** 可用于跟随节拍的模型（分析完成；是否可信见 model.reliable） */
export function rhythmModelFor(songId: number | null | undefined): RhythmModel | null {
  const state = getRhythmState(songId)
  return state?.status === 'ready' ? state.model : null
}

/** 站内代理的网易云音频（同源请求，302 到支持 CORS 的 CDN），可以读取样本 */
function readableSource(audioUrl: string | null | undefined) {
  return !!audioUrl && audioUrl.startsWith('/api/v1/music/song/')
}

/** 各声道的样本交给 Worker 混成单声道再分析（混音也不占主线程），样本的内存直接移交、不复制 */
function analyzeInWorker(channels: Float32Array[], onProgress: (progress: number) => void): Promise<RhythmAnalysis> {
  worker ??= new Worker(new URL('./rhythm.worker.ts', import.meta.url), { type: 'module' })
  const id = ++requestId
  const current = worker
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<{ id: number, progress?: number, analysis?: RhythmAnalysis, error?: string }>) => {
      if (event.data.id !== id)
        return
      if (event.data.progress != null) {
        onProgress(event.data.progress)
        return
      }
      current.removeEventListener('message', onMessage)
      if (event.data.analysis)
        resolve(event.data.analysis)
      else reject(new Error(event.data.error ?? 'analysis failed'))
    }
    current.addEventListener('message', onMessage)
    current.postMessage({ id, channels, sampleRate: SAMPLE_RATE }, channels.map(channel => channel.buffer))
  })
}

/**
 * 解码并重采样到 11025 Hz（浏览器在后台线程解码），取出各声道的样本。
 * 主线程上只有 copyFromChannel 的原生内存复制（几毫秒）；混成单声道放到 Worker 里做（原来在主线程逐个样本累加，切歌时有一段约 100ms 的长任务）
 */
async function decodeChannels(buffer: ArrayBuffer): Promise<Float32Array[]> {
  const context = new OfflineAudioContext(1, 1, SAMPLE_RATE)
  const decoded = await context.decodeAudioData(buffer)
  return Array.from({ length: decoded.numberOfChannels }, (_, c) => {
    const channel = new Float32Array(decoded.length)
    decoded.copyFromChannel(channel, c)
    return channel
  })
}

/** 开始分析这首歌（已有结果或正在分析时不重复）；只分析站内代理的音频，浏览器开启省流量时不再额外下载一份音频 */
export function requestRhythm(songId: number, audioUrl: string | null | undefined) {
  if (states.has(songId))
    return
  if (!readableSource(audioUrl)) {
    setState(songId, { status: 'unavailable', reason: 'unsupported_source' })
    return
  }
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData
  if (saveData) {
    setState(songId, { status: 'unavailable', reason: 'save_data' })
    return
  }
  if (typeof Worker === 'undefined' || typeof OfflineAudioContext === 'undefined') {
    setState(songId, { status: 'unavailable', reason: 'unsupported_browser' })
    return
  }
  setState(songId, { status: 'loading', progress: 0 })
  const startedAt = performance.now()
  const progress = (value: number) => {
    const state = states.get(songId)
    if (state?.status === 'loading') {
      state.progress = value
      emit()
    }
  }
  void (async () => {
    let buffer: ArrayBuffer
    try {
      const response = await fetch(audioUrl!)
      if (!response.ok)
        throw new Error(String(response.status))
      buffer = await response.arrayBuffer()
    }
    catch {
      setState(songId, { status: 'unavailable', reason: 'fetch_failed' })
      return
    }
    progress(0.1)
    let channels: Float32Array[]
    try {
      channels = await decodeChannels(buffer)
    }
    catch {
      setState(songId, { status: 'unavailable', reason: 'decode_failed' })
      return
    }
    try {
      const analysis = await analyzeInWorker(channels, value => progress(0.1 + value * 0.9))
      setState(songId, { status: 'ready', model: buildRhythmModel(analysis, getRhythmParams()), elapsedMs: performance.now() - startedAt })
    }
    catch {
      setState(songId, { status: 'unavailable', reason: 'analysis_failed' })
    }
  })()
}

// 专业模式修改了参数（拍的强弱、置信度阈值）时，用同一份分析结果重建模型
subscribeRhythmParams(() => {
  for (const [id, state] of states) {
    if (state.status === 'ready')
      states.set(id, { ...state, model: buildRhythmModel(state.model.analysis, getRhythmParams()) })
  }
  emit()
})
