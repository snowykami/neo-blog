import type { RhythmAnalysis } from './analysis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** 可控的 fetch：每次请求记下 signal，由测试决定何时完成或失败；中止时按浏览器行为以 AbortError 失败 */
interface PendingFetch {
  url: string
  signal: AbortSignal
  resolve: () => void
  reject: () => void
}

let fetches: PendingFetch[]
let workers: FakeWorker[]

function fakeAnalysis(): RhythmAnalysis {
  const beats = Array.from({ length: 40 }, (_, i) => ({ t: 500 + i * 500, loud: -10, strength: 1 }))
  return {
    durationMs: 22000,
    frameMs: 11.6,
    frameOffsetMs: 0,
    onset: new Float32Array(0),
    autocorr: new Float32Array(4),
    periodMs: 500,
    basePeriodMs: 500,
    bpm: 120,
    confidence: 0.5,
    beats,
    loudLow: -20,
    loudHigh: -10,
  }
}

/** 假 Worker：收到样本后不自动回复，由测试调用 reply 完成分析 */
class FakeWorker extends EventTarget {
  terminated = false
  lastId = 0
  constructor() {
    super()
    workers.push(this)
  }

  postMessage(data: { id: number }) {
    this.lastId = data.id
  }

  terminate() {
    this.terminated = true
  }

  reply() {
    this.dispatchEvent(new MessageEvent('message', { data: { id: this.lastId, analysis: fakeAnalysis() } }))
  }
}

class FakeOfflineAudioContext {
  async decodeAudioData() {
    return { numberOfChannels: 1, length: 8, copyFromChannel: () => {} }
  }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

async function loadSource() {
  vi.resetModules()
  return import('./source')
}

beforeEach(() => {
  fetches = []
  workers = []
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext)
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => new Promise((resolve, reject) => {
    const signal = init.signal!
    const pending: PendingFetch = {
      url,
      signal,
      resolve: () => resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }),
      reject: () => reject(new TypeError('network error')),
    }
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    fetches.push(pending)
  })))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const url = (id: number) => `/api/v1/music/song/${id}/audio`

describe('节拍分析的下载：取消与单并发', () => {
  it('下载不经过 HTTP 缓存，并带上可中止的 signal', async () => {
    const source = await loadSource()
    source.requestRhythm(1, url(1))
    expect(fetch).toHaveBeenCalledWith(url(1), expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }))
  })

  it('调用方中止时取消下载并撤掉 loading，之后可以重新请求', async () => {
    const source = await loadSource()
    const controller = new AbortController()
    source.requestRhythm(1, url(1), controller.signal)
    expect(source.getRhythmState(1)?.status).toBe('loading')
    controller.abort()
    expect(fetches[0].signal.aborted).toBe(true)
    expect(source.getRhythmState(1)).toBeNull()
    await flush()
    // 中止导致的下载失败不记成 fetch_failed
    expect(source.getRhythmState(1)).toBeNull()
    source.requestRhythm(1, url(1))
    expect(fetches).toHaveLength(2)
    expect(source.getRhythmState(1)?.status).toBe('loading')
  })

  it('同一时间只分析一首：请求另一首时取消上一首（后来的优先）', async () => {
    const source = await loadSource()
    source.requestRhythm(1, url(1))
    source.requestRhythm(2, url(2))
    source.requestRhythm(3, url(3))
    expect(fetches.map(f => f.signal.aborted)).toEqual([true, true, false])
    expect(source.getRhythmState(1)).toBeNull()
    expect(source.getRhythmState(2)).toBeNull()
    expect(source.getRhythmState(3)?.status).toBe('loading')
    // 正在分析的同一首不重复下载
    source.requestRhythm(3, url(3))
    expect(fetches).toHaveLength(3)
  })

  it('分析进行到 Worker 时被取消：终止 Worker，结果不写入，下一次新建 Worker', async () => {
    const source = await loadSource()
    const controller = new AbortController()
    source.requestRhythm(1, url(1), controller.signal)
    fetches[0].resolve()
    await flush()
    expect(workers).toHaveLength(1)
    controller.abort()
    expect(workers[0].terminated).toBe(true)
    workers[0].reply()
    await flush()
    expect(source.getRhythmState(1)).toBeNull()

    source.requestRhythm(2, url(2))
    fetches[1].resolve()
    await flush()
    expect(workers).toHaveLength(2)
    workers[1].reply()
    await flush()
    expect(source.getRhythmState(2)?.status).toBe('ready')
  })

  it('下载失败不永久缓存：退避期内不重试，过了退避时间重试，连续失败时间隔翻倍', async () => {
    vi.useFakeTimers({ toFake: ['performance'] })
    const source = await loadSource()
    source.requestRhythm(1, url(1))
    fetches[0].reject()
    await flush()
    const failed = source.getRhythmState(1)
    expect(failed).toMatchObject({ status: 'unavailable', reason: 'fetch_failed', failures: 1 })

    source.requestRhythm(1, url(1))
    expect(fetches).toHaveLength(1)

    vi.advanceTimersByTime(30_000)
    source.requestRhythm(1, url(1))
    expect(fetches).toHaveLength(2)
    fetches[1].reject()
    await flush()
    const second = source.getRhythmState(1)
    expect(second).toMatchObject({ reason: 'fetch_failed', failures: 2 })
    // 第二次失败后等 60 秒
    vi.advanceTimersByTime(30_000)
    source.requestRhythm(1, url(1))
    expect(fetches).toHaveLength(2)
    vi.advanceTimersByTime(30_000)
    source.requestRhythm(1, url(1))
    expect(fetches).toHaveLength(3)
  })

  it('不是站内代理的音频不下载，也不打断正在进行的分析', async () => {
    const source = await loadSource()
    source.requestRhythm(1, url(1))
    source.requestRhythm(2, 'https://example.com/a.mp3')
    expect(source.getRhythmState(2)).toMatchObject({ status: 'unavailable', reason: 'unsupported_source' })
    expect(fetches[0].signal.aborted).toBe(false)
  })
})
