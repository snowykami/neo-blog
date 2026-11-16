import type { RhythmAnalysis } from './analysis'
import type { RhythmModel } from './model'
import type { MusicRhythmAnalysis } from '@/api/music'
import { fetchSongRhythm, saveSongRhythm } from '@/api/music'
import { buildRhythmModel } from './model'
import { getRhythmParams, subscribeRhythmParams } from './params'

/**
 * 每首歌的节拍分析（服务端缓存 + IndexedDB 持久化 + 本地 Worker 兜底）：
 * 优先复用 IndexedDB 与服务端缓存（服务端开启 ffmpeg 时自动在后台生成，也可由管理员前端分析后自动上传）；
 * 服务端命中时全站访客无需再次下载音频与 Worker 解码。拿不到结果时动效回退到固定快慢（见 effects.ts 的 rhythmContext）
 */

export const RHYTHM_ALGO_VERSION = 1

export type RhythmUnavailableReason = 'unsupported_source' | 'save_data' | 'unsupported_browser' | 'fetch_failed' | 'decode_failed' | 'analysis_failed'

export interface RhythmRequestOptions {
  isAdmin?: boolean
  expectedDurationMs?: number | null
}

export type RhythmState
  = | { status: 'loading', progress: number }
    | { status: 'ready', model: RhythmModel, elapsedMs: number }
    // retryAt：下载失败（网络抖动、上游临时出错）是暂时的，到这个时间（performance.now()）之后再次请求会重试；其余原因不重试
    | { status: 'unavailable', reason: RhythmUnavailableReason, retryAt?: number, failures?: number }

const SAMPLE_RATE = 11025
const MAX_CACHED_SONGS = 8
// IndexedDB 持久化最近 200 首节拍分析结果，按访问时间 LRU 淘汰
const IDB_NAME = 'neo-music-rhythm-v1'
const IDB_STORE = 'analyses'
const MAX_IDB_SONGS = 200
const ONSET_QUANT_CAP = 10
const SERVER_POLL_MAX = 15

// 下载失败后的重试间隔：30 秒起，每再失败一次翻倍，最长 5 分钟
const FETCH_RETRY_BASE_MS = 30_000
const FETCH_RETRY_MAX_MS = 5 * 60_000

interface StoredRhythmRecord {
  songId: number
  analysis: RhythmAnalysis
  algoVersion?: number
  fromServer?: boolean
  updatedAt: number
}

function roundFloat(value: number, decimals: number): number {
  if (!Number.isFinite(value))
    return 0
  const factor = 10 ** decimals
  const rounded = Math.round(value * factor) / factor
  return rounded === 0 ? 0 : rounded
}

function clamp01(value: number): number {
  if (value <= 0)
    return 0
  if (value >= 1)
    return 1
  return value
}

function uint8ToBase64(bytes: Uint8Array): string {
  if (bytes.length === 0)
    return ''
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function base64ToUint8(encoded: string): Uint8Array | null {
  if (!encoded)
    return null
  try {
    const binary = atob(encoded)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++)
      out[i] = binary.charCodeAt(i)
    return out
  }
  catch {
    return null
  }
}

export function serializeRhythmAnalysis(analysis: RhythmAnalysis): MusicRhythmAnalysis {
  let maxOnset = 0
  for (let i = 0; i < analysis.onset.length; i++) {
    const v = analysis.onset[i]
    if (v > maxOnset)
      maxOnset = v
  }
  const onsetMax = roundFloat(Math.min(maxOnset, ONSET_QUANT_CAP), 4)
  let onsetData = ''
  if (analysis.onset.length > 0 && onsetMax > 0) {
    const quantized = new Uint8Array(analysis.onset.length)
    for (let i = 0; i < analysis.onset.length; i++) {
      quantized[i] = Math.round(clamp01(analysis.onset[i] / onsetMax) * 255)
    }
    onsetData = uint8ToBase64(quantized)
  }
  return {
    algoVersion: RHYTHM_ALGO_VERSION,
    durationMs: roundFloat(analysis.durationMs, 2),
    frameMs: roundFloat(analysis.frameMs, 4),
    frameOffsetMs: roundFloat(analysis.frameOffsetMs, 4),
    periodMs: roundFloat(analysis.periodMs, 4),
    basePeriodMs: roundFloat(analysis.basePeriodMs, 4),
    bpm: roundFloat(analysis.bpm, 4),
    confidence: roundFloat(analysis.confidence, 4),
    loudLow: roundFloat(analysis.loudLow, 4),
    loudHigh: roundFloat(analysis.loudHigh, 4),
    beats: analysis.beats.map(beat => ({
      t: roundFloat(beat.t, 2),
      loud: roundFloat(beat.loud, 2),
      strength: roundFloat(beat.strength, 3),
    })),
    autocorr: Array.from(analysis.autocorr, v => roundFloat(v, 4)),
    onsetMax,
    onsetData,
  }
}

export function deserializeRhythmAnalysis(dto: MusicRhythmAnalysis): RhythmAnalysis {
  const bytes = dto.onsetMax > 0 ? base64ToUint8(dto.onsetData) : null
  let onset: Float32Array
  if (bytes && bytes.length > 0) {
    onset = new Float32Array(bytes.length)
    const scale = dto.onsetMax / 255
    for (let i = 0; i < bytes.length; i++)
      onset[i] = bytes[i] * scale
  }
  else {
    onset = new Float32Array(0)
  }
  return {
    durationMs: dto.durationMs,
    frameMs: dto.frameMs,
    frameOffsetMs: dto.frameOffsetMs,
    onset,
    autocorr: Float32Array.from(dto.autocorr ?? []),
    periodMs: dto.periodMs,
    basePeriodMs: dto.basePeriodMs,
    bpm: dto.bpm,
    confidence: dto.confidence,
    beats: (dto.beats ?? []).map(beat => ({ t: beat.t, loud: beat.loud, strength: beat.strength })),
    loudLow: dto.loudLow,
    loudHigh: dto.loudHigh,
  }
}

export function isCompleteRhythmDuration(durationMs: number, expectedDurationMs?: number | null): boolean {
  if (!Number.isFinite(durationMs) || durationMs < 4000)
    return false
  if (expectedDurationMs && expectedDurationMs > 45_000) {
    return durationMs >= expectedDurationMs * 0.8 || Math.abs(durationMs - expectedDurationMs) <= 10_000
  }
  return true
}

function openRhythmDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined')
    return Promise.resolve(null)
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          const store = db.createObjectStore(IDB_STORE, { keyPath: 'songId' })
          store.createIndex('updatedAt', 'updatedAt', { unique: false })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    }
    catch {
      resolve(null)
    }
  })
}

async function readCachedRecord(songId: number): Promise<StoredRhythmRecord | null> {
  const db = await openRhythmDb()
  if (!db)
    return null
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const req = tx.objectStore(IDB_STORE).get(songId)
      req.onsuccess = () => {
        const record = req.result as StoredRhythmRecord | undefined
        resolve(record?.analysis ? record : null)
      }
      req.onerror = () => resolve(null)
    }
    catch {
      resolve(null)
    }
  })
}

async function writeCachedRecord(songId: number, analysis: RhythmAnalysis, fromServer = false): Promise<void> {
  const db = await openRhythmDb()
  if (!db)
    return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      const store = tx.objectStore(IDB_STORE)
      store.put({
        songId,
        analysis,
        algoVersion: RHYTHM_ALGO_VERSION,
        fromServer,
        updatedAt: Date.now(),
      } satisfies StoredRhythmRecord)
      const countReq = store.count()
      countReq.onsuccess = () => {
        const excess = countReq.result - MAX_IDB_SONGS
        if (excess > 0 && typeof store.index === 'function') {
          let removed = 0
          const cursorReq = store.index('updatedAt').openCursor()
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result
            if (cursor && removed < excess) {
              cursor.delete()
              removed++
              cursor.continue()
            }
          }
        }
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    }
    catch {
      resolve()
    }
  })
}

const states = new Map<number, RhythmState>()
const listeners = new Set<() => void>()
const readyFromServer = new Set<number>()
const syncAttempted = new Set<number>()
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

function sleepAbortable(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted)
    return Promise.resolve(false)
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>
    const onAbort = () => {
      clearTimeout(timer)
      resolve(false)
    }
    timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(!signal.aborted)
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function fetchServerRhythm(songId: number, signal: AbortSignal): Promise<RhythmAnalysis | null> {
  try {
    let resp = await fetchSongRhythm(songId, signal)
    for (let poll = 0; resp?.status === 'pending' && poll < SERVER_POLL_MAX; poll++) {
      const delay = poll === 0 ? 800 : poll === 1 ? 1200 : 2000
      const ok = await sleepAbortable(delay, signal)
      if (!ok)
        return null
      resp = await fetchSongRhythm(songId, signal)
    }
    if (signal.aborted)
      return null
    if (resp?.status === 'ready' && resp.analysis) {
      return deserializeRhythmAnalysis(resp.analysis)
    }
    return null
  }
  catch {
    return null
  }
}

async function uploadRhythmAsAdmin(songId: number, analysis: RhythmAnalysis, expectedDurationMs?: number | null) {
  if (!isCompleteRhythmDuration(analysis.durationMs, expectedDurationMs))
    return
  if (syncAttempted.has(songId))
    return
  syncAttempted.add(songId)
  try {
    const saved = await saveSongRhythm(songId, serializeRhythmAnalysis(analysis))
    if (saved.status === 'ready') {
      readyFromServer.add(songId)
      if (typeof indexedDB !== 'undefined')
        void writeCachedRecord(songId, analysis, true)
    }
  }
  catch {
    // 管理员后台上传失败不影响前台播放与节拍展示
  }
}

async function checkAndSyncForAdmin(songId: number, analysis: RhythmAnalysis, expectedDurationMs?: number | null) {
  if (!isCompleteRhythmDuration(analysis.durationMs, expectedDurationMs))
    return
  if (readyFromServer.has(songId) || syncAttempted.has(songId))
    return
  try {
    const existing = await fetchSongRhythm(songId)
    if (existing?.status === 'ready') {
      readyFromServer.add(songId)
      syncAttempted.add(songId)
      if (typeof indexedDB !== 'undefined')
        void writeCachedRecord(songId, analysis, true)
      return
    }
    if (existing?.status === 'unavailable')
      await uploadRhythmAsAdmin(songId, analysis, expectedDurationMs)
  }
  catch {
    // 忽略后台探测失败
  }
}

/** 登录态水合完成时若当前曲目已在本地完成分析，为管理员静默补传至服务端缓存 */
export function syncRhythmForAdmin(songId: number | null | undefined, expectedDurationMs?: number | null) {
  if (songId == null || readyFromServer.has(songId) || syncAttempted.has(songId))
    return
  const state = states.get(songId)
  if (state?.status !== 'ready')
    return
  void checkAndSyncForAdmin(songId, state.model.analysis, expectedDurationMs)
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
 * 开始分析这首歌（已有结果或正在分析时不重复）：
 * 先查 IndexedDB -> 再查服务端缓存（支持 pending 轮询）-> 未命中时按本地策略（无省流量且浏览器支持）兜底下载与 Worker 分析；
 * 若请求方为管理员，完整歌曲本地分析完成后自动静默上传服务端缓存。
 */
export function requestRhythm(songId: number, audioUrl: string | null | undefined, signal?: AbortSignal, options?: RhythmRequestOptions) {
  if (signal?.aborted)
    return
  if (settled(songId))
    return
  if (!readableSource(audioUrl)) {
    setState(songId, { status: 'unavailable', reason: 'unsupported_source' })
    return
  }
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

  // 之前连续下载失败的次数（重试时接着翻倍等待时间）
  const previous = states.get(songId)
  const failures = previous?.status === 'unavailable' && previous.reason === 'fetch_failed' ? previous.failures ?? 0 : 0

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
    // 1. 优先命中本机 IndexedDB 缓存
    if (typeof indexedDB !== 'undefined') {
      try {
        const record = await readCachedRecord(songId)
        if (own.aborted)
          return
        if (record && (!record.algoVersion || record.algoVersion === RHYTHM_ALGO_VERSION)) {
          if (record.fromServer)
            readyFromServer.add(songId)
          else if (options?.isAdmin)
            void checkAndSyncForAdmin(songId, record.analysis, options.expectedDurationMs)
          void writeCachedRecord(songId, record.analysis, !!record.fromServer)
          finish({ status: 'ready', model: buildRhythmModel(record.analysis, getRhythmParams()), elapsedMs: performance.now() - startedAt })
          return
        }
      }
      catch {
        // IndexedDB 读取失败时回退服务端或本地分析
      }
      if (own.aborted)
        return
    }

    // 2. 查询服务端共享缓存（不受 saveData 或 OfflineAudioContext 限制）
    const serverAnalysis = await fetchServerRhythm(songId, own)
    if (own.aborted)
      return
    if (serverAnalysis) {
      readyFromServer.add(songId)
      if (typeof indexedDB !== 'undefined')
        void writeCachedRecord(songId, serverAnalysis, true)
      finish({ status: 'ready', model: buildRhythmModel(serverAnalysis, getRhythmParams()), elapsedMs: performance.now() - startedAt })
      return
    }

    // 3. 服务端未命中：走本地下载 + 解码 + Worker 兜底
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData
    if (saveData) {
      finish({ status: 'unavailable', reason: 'save_data' })
      return
    }
    if (typeof Worker === 'undefined' || typeof OfflineAudioContext === 'undefined') {
      finish({ status: 'unavailable', reason: 'unsupported_browser' })
      return
    }

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
      if (!own.aborted && typeof indexedDB !== 'undefined')
        await writeCachedRecord(songId, analysis, false)
      finish({ status: 'ready', model: buildRhythmModel(analysis, getRhythmParams()), elapsedMs: performance.now() - startedAt })
      if (!own.aborted && options?.isAdmin)
        void uploadRhythmAsAdmin(songId, analysis, options.expectedDurationMs)
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
