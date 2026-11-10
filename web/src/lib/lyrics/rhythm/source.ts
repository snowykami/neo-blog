import type { RhythmAnalysis } from './analysis'
import type { RhythmModel } from './model'
import { buildRhythmModel } from './model'
import { getRhythmParams, subscribeRhythmParams } from './params'

/**
 * 每首歌的节拍分析（只在前端进行，后端不存）：播放时另外下载一份同样的音频（不经过 HTTP 缓存），以 11025 Hz 单声道解码后交给 Worker 分析，结果按歌曲缓存在内存中。
 * 桌面端与移动端行为一致，只在开启歌词特效、这首歌已经出声且页面可见时分析（见 music-context.tsx）；同一时间只分析一首，切歌时取消上一首（见 requestRhythm）。
 * 拿不到结果时（不是站内代理的音频、浏览器开启了省流量、下载或解码失败、节拍不可信）动效回退到固定快慢（见 effects.ts 的 rhythmContext）
 */

export type RhythmUnavailableReason = 'unsupported_source' | 'save_data' | 'unsupported_browser' | 'fetch_failed' | 'decode_failed' | 'analysis_failed'

export type RhythmState
  = | { status: 'loading', progress: number }
    | { status: 'ready', model: RhythmModel, elapsedMs: number }
    // retryAt：下载失败（网络抖动、上游临时出错）是暂时的，到这个时间（performance.now()）之后再次请求会重试；其余原因不重试
    | { status: 'unavailable', reason: RhythmUnavailableReason, retryAt?: number, failures?: number }

const SAMPLE_RATE = 11025
const MAX_CACHED_SONGS = 8
// 下载失败后的重试间隔：30 秒起，每再失败一次翻倍，最长 5 分钟
const FETCH_RETRY_BASE_MS = 30_000
const FETCH_RETRY_MAX_MS = 5 * 60_000

const states = new Map<number, RhythmState>()
const listeners = new Set<() => void>()
let worker: Worker | null = null
let requestId = 0

/**
 * 正在进行的分析（同一时间只有一个，后来的优先）：快速切歌时每首歌都要下载整首音频（无损的有几十 MB）、解码出几十 MB 的样本再交给 Worker，
 * 旧的不停下来会和新曲目 <audio> 的 Range 请求抢带宽（切歌后迟迟不出声、系统媒体控制断开，见 spec 5.2），iOS 上还可能因内存不足让页面崩溃。
 * 开始分析另一首歌或调用方取消（切歌、关闭特效）时中止下载、丢弃解码结果、终止 Worker，并撤掉 loading 状态，下次播放到这首歌时重新分析
 */
let active: { songId: number, controller: AbortController } | null = null

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

/**
 * 各声道的样本交给 Worker 混成单声道再分析（混音也不占主线程），样本的内存直接移交、不复制。
 * Worker 里的分析是一段同步计算，中途收不到消息：取消时直接终止 Worker，下次分析再新建
 */
function analyzeInWorker(channels: Float32Array[], onProgress: (progress: number) => void, signal: AbortSignal): Promise<RhythmAnalysis> {
  worker ??= new Worker(new URL('./rhythm.worker.ts', import.meta.url), { type: 'module' })
  const id = ++requestId
  const current = worker
  return new Promise((resolve, reject) => {
    // 先声明再赋值：cleanup 与 onAbort 互相引用，const 顺序会触发 use-before-define
    let onMessage: (event: MessageEvent<{ id: number, progress?: number, analysis?: RhythmAnalysis, error?: string }>) => void
    let onAbort: () => void
    const cleanup = () => {
      current.removeEventListener('message', onMessage)
      signal.removeEventListener('abort', onAbort)
    }
    onMessage = (event) => {
      if (event.data.id !== id)
        return
      if (event.data.progress != null) {
        onProgress(event.data.progress)
        return
      }
      cleanup()
      if (event.data.analysis)
        resolve(event.data.analysis)
      else reject(new Error(event.data.error ?? 'analysis failed'))
    }
    onAbort = () => {
      cleanup()
      current.terminate()
      if (worker === current)
        worker = null
      reject(signal.reason)
    }
    current.addEventListener('message', onMessage)
    signal.addEventListener('abort', onAbort)
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

/** 下载失败的状态：记下连续失败的次数与下次可以重试的时间 */
function fetchFailedState(failures: number): RhythmState {
  const delay = Math.min(FETCH_RETRY_BASE_MS * 2 ** (failures - 1), FETCH_RETRY_MAX_MS)
  return { status: 'unavailable', reason: 'fetch_failed', failures, retryAt: performance.now() + delay }
}

/** 已有结果、正在分析或失败原因不会自己消失时不再请求；下载失败的过了重试时间可以再试 */
function settled(songId: number) {
  const state = states.get(songId)
  if (!state)
    return false
  if (state.status === 'unavailable' && state.retryAt != null)
    return performance.now() < state.retryAt
  return true
}

/**
 * 开始分析这首歌（已有结果或正在分析时不重复）；只分析站内代理的音频，浏览器开启省流量时不再额外下载一份音频。
 * 同一时间只分析一首：请求另一首歌时先取消正在进行的那首。signal 中止时（调用方切歌、关闭特效）取消这次分析，
 * 撤掉 loading 状态，之后可以重新请求
 */
export function requestRhythm(songId: number, audioUrl: string | null | undefined, signal?: AbortSignal) {
  if (signal?.aborted)
    return
  if (settled(songId))
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
  // 之前连续下载失败的次数（重试时接着翻倍等待时间）
  const previous = states.get(songId)
  const failures = previous?.status === 'unavailable' && previous.reason === 'fetch_failed' ? previous.failures ?? 0 : 0
  // 后来的优先：先停掉正在分析的另一首
  active?.controller.abort()
  const controller = new AbortController()
  const job = { songId, controller }
  active = job
  const own = controller.signal
  const onCallerAbort = () => controller.abort(signal!.reason)
  signal?.addEventListener('abort', onCallerAbort, { once: true })
  own.addEventListener('abort', () => {
    signal?.removeEventListener('abort', onCallerAbort)
    if (active === job)
      active = null
    // 撤掉这次的 loading 状态，下次请求立即重新分析，通知订阅者
    if (states.get(songId)?.status === 'loading') {
      states.delete(songId)
      emit()
    }
  }, { once: true })
  const finish = (state: RhythmState) => {
    if (own.aborted)
      return
    signal?.removeEventListener('abort', onCallerAbort)
    if (active === job)
      active = null
    setState(songId, state)
  }

  setState(songId, { status: 'loading', progress: 0 })
  const startedAt = performance.now()
  const progress = (value: number) => {
    const state = states.get(songId)
    if (!own.aborted && state?.status === 'loading') {
      state.progress = value
      emit()
    }
  }
  void (async () => {
    let buffer: ArrayBuffer
    try {
      // 不经过 HTTP 缓存：Chrome 对同一地址的请求排队（缓存锁），整首下载完之前 <audio> 的 Range 请求一直等着，
      // 切歌后要等这一整首下载完才出声（实测 1～15 秒），期间媒体会话没有在播的播放器，系统媒体控制随之断开
      const response = await fetch(audioUrl!, { cache: 'no-store', signal: own })
      if (!response.ok)
        throw new Error(String(response.status))
      buffer = await response.arrayBuffer()
    }
    catch {
      finish(fetchFailedState(failures + 1))
      return
    }
    if (own.aborted)
      return
    progress(0.1)
    let channels: Float32Array[]
    try {
      // 解码本身无法中止：解码完成后发现已取消就丢掉结果
      channels = await decodeChannels(buffer)
    }
    catch {
      finish({ status: 'unavailable', reason: 'decode_failed' })
      return
    }
    if (own.aborted)
      return
    try {
      const analysis = await analyzeInWorker(channels, value => progress(0.1 + value * 0.9), own)
      finish({ status: 'ready', model: buildRhythmModel(analysis, getRhythmParams()), elapsedMs: performance.now() - startedAt })
    }
    catch {
      finish({ status: 'unavailable', reason: 'analysis_failed' })
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
