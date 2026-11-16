import type { RhythmAnalysis } from './analysis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchSongRhythmMock, saveSongRhythmMock } = vi.hoisted(() => ({
  fetchSongRhythmMock: vi.fn(),
  saveSongRhythmMock: vi.fn(),
}))

vi.mock('@/api/music', () => ({
  fetchSongRhythm: fetchSongRhythmMock,
  saveSongRhythm: saveSongRhythmMock,
}))

/** 可控的 fetch：每次请求记下 signal，由测试决定何时完成或失败；中止时按浏览器行为以 AbortError 失败 */
interface PendingFetch {
  url: string
  signal: AbortSignal
  resolve: () => void
  reject: () => void
}

let fetches: PendingFetch[]
let workers: FakeWorker[]

function fakeAnalysis(onsetLength = 0): RhythmAnalysis {
  const beats = Array.from({ length: 40 }, (_, i) => ({ t: 500 + i * 500, loud: -10, strength: 1 }))
  const onset = new Float32Array(onsetLength)
  for (let i = 0; i < onsetLength; i++)
    onset[i] = i % 3
  return {
    durationMs: 22000,
    frameMs: 11.6,
    frameOffsetMs: 0,
    onset,
    autocorr: new Float32Array([1, 0.5, 0.25, 0.1]),
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

  reply(onsetLength = 0) {
    this.dispatchEvent(new MessageEvent('message', { data: { id: this.lastId, analysis: fakeAnalysis(onsetLength) } }))
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
  fetchSongRhythmMock.mockReset()
  fetchSongRhythmMock.mockResolvedValue({ status: 'unavailable', reason: 'ffmpeg_unavailable' })
  saveSongRhythmMock.mockReset()
  saveSongRhythmMock.mockResolvedValue({ status: 'ready' })
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
    await flush()
    expect(fetch).toHaveBeenCalledWith(url(1), expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }))
  })

  it('调用方中止时取消下载并撤掉 loading，之后可以重新请求', async () => {
    const source = await loadSource()
    const controller = new AbortController()
    source.requestRhythm(1, url(1), controller.signal)
    expect(source.getRhythmState(1)?.status).toBe('loading')
    await flush()
    controller.abort()
    expect(fetches[0].signal.aborted).toBe(true)
    expect(source.getRhythmState(1)).toBeNull()
    await flush()
    // 中止导致的下载失败不记成 fetch_failed
    expect(source.getRhythmState(1)).toBeNull()
    source.requestRhythm(1, url(1))
    await flush()
    expect(fetches).toHaveLength(2)
    expect(source.getRhythmState(1)?.status).toBe('loading')
  })

  it('同一时间只分析一首：请求另一首时取消上一首（后来的优先）', async () => {
    const source = await loadSource()
    source.requestRhythm(1, url(1))
    await flush()
    source.requestRhythm(2, url(2))
    await flush()
    source.requestRhythm(3, url(3))
    await flush()
    expect(fetches.map(f => f.signal.aborted)).toEqual([true, true, false])
    expect(source.getRhythmState(1)).toBeNull()
    expect(source.getRhythmState(2)).toBeNull()
    expect(source.getRhythmState(3)?.status).toBe('loading')
    // 正在分析的同一首不重复下载
    source.requestRhythm(3, url(3))
    await flush()
    expect(fetches).toHaveLength(3)
  })

  it('分析进行到 Worker 时被取消：终止 Worker，结果不写入，下一次新建 Worker', async () => {
    const source = await loadSource()
    const controller = new AbortController()
    source.requestRhythm(1, url(1), controller.signal)
    await flush()
    fetches[0].resolve()
    await flush()
    expect(workers).toHaveLength(1)
    controller.abort()
    expect(workers[0].terminated).toBe(true)
    workers[0].reply()
    await flush()
    expect(source.getRhythmState(1)).toBeNull()

    source.requestRhythm(2, url(2))
    await flush()
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
    await flush()
    fetches[0].reject()
    await flush()
    const failed = source.getRhythmState(1)
    expect(failed).toMatchObject({ status: 'unavailable', reason: 'fetch_failed', failures: 1 })

    source.requestRhythm(1, url(1))
    await flush()
    expect(fetches).toHaveLength(1)

    vi.advanceTimersByTime(30_000)
    source.requestRhythm(1, url(1))
    await flush()
    expect(fetches).toHaveLength(2)
    fetches[1].reject()
    await flush()
    const second = source.getRhythmState(1)
    expect(second).toMatchObject({ reason: 'fetch_failed', failures: 2 })
    // 第二次失败后等 60 秒
    vi.advanceTimersByTime(30_000)
    source.requestRhythm(1, url(1))
    await flush()
    expect(fetches).toHaveLength(2)
    vi.advanceTimersByTime(30_000)
    source.requestRhythm(1, url(1))
    await flush()
    expect(fetches).toHaveLength(3)
  })

  it('不是站内代理的音频不下载，也不打断正在进行的分析', async () => {
    const source = await loadSource()
    source.requestRhythm(1, url(1))
    await flush()
    source.requestRhythm(2, 'https://example.com/a.mp3')
    expect(source.getRhythmState(2)).toMatchObject({ status: 'unavailable', reason: 'unsupported_source' })
    expect(fetches[0].signal.aborted).toBe(false)
  })

  it('命中 IndexedDB 持久化缓存时直接就绪，不再发起音频下载与 Worker 计算', async () => {
    const records = new Map<number, { songId: number, analysis: RhythmAnalysis, updatedAt: number }>()
    const makeReq = <T>(run: () => T) => {
      const req = { result: undefined as T | undefined, onsuccess: null as (() => void) | null, onerror: null as (() => void) | null }
      queueMicrotask(() => {
        req.result = run()
        req.onsuccess?.()
      })
      return req
    }
    const stubIdb = {
      open: () => {
        const db = {
          objectStoreNames: { contains: () => true },
          transaction: (_name: string, _mode: string) => {
            const tx = {
              oncomplete: null as (() => void) | null,
              onerror: null as (() => void) | null,
              onabort: null as (() => void) | null,
              objectStore: () => ({
                get: (id: number) => makeReq(() => records.get(id)),
                put: (item: { songId: number, analysis: RhythmAnalysis, updatedAt: number }) => {
                  records.set(item.songId, item)
                  queueMicrotask(() => tx.oncomplete?.())
                },
                count: () => makeReq(() => records.size),
              }),
            }
            return tx
          },
        }
        return makeReq(() => db)
      },
    }
    vi.stubGlobal('indexedDB', stubIdb)

    // 首次冷启动：下载 + Worker 分析并写入持久化存储
    const first = await loadSource()
    first.requestRhythm(7, url(7))
    await flush()
    expect(fetches).toHaveLength(1)
    fetches[0].resolve()
    await flush()
    expect(workers).toHaveLength(1)
    workers[0].reply()
    await flush()
    expect(first.getRhythmState(7)?.status).toBe('ready')
    expect(records.has(7)).toBe(true)

    // 模拟刷新重载模块：直接命中持久化缓存，0 fetch / 0 Worker
    const second = await loadSource()
    second.requestRhythm(7, url(7))
    await flush()
    expect(fetches).toHaveLength(1)
    expect(workers).toHaveLength(1)
    expect(second.getRhythmState(7)?.status).toBe('ready')
  })

  it('命中服务端共享缓存时零音频下载、零 Worker，并正确还原 onset 曲线', async () => {
    fetchSongRhythmMock.mockResolvedValueOnce({
      status: 'ready',
      analysis: {
        algoVersion: 1,
        durationMs: 22000,
        frameMs: 11.61,
        frameOffsetMs: 46.44,
        periodMs: 500,
        basePeriodMs: 500,
        bpm: 120,
        confidence: 0.72,
        loudLow: -20,
        loudHigh: -8,
        beats: [{ t: 500, loud: -10, strength: 1.5 }],
        autocorr: [1, 0.5],
        onsetMax: 4,
        onsetData: btoa(String.fromCharCode(0, 128, 255)),
      },
    })
    const source = await loadSource()
    source.requestRhythm(10, url(10))
    await flush()
    const state = source.getRhythmState(10)
    expect(state?.status).toBe('ready')
    if (state?.status === 'ready') {
      expect(state.model.analysis.onset).toHaveLength(3)
      expect(state.model.analysis.onset[0]).toBeCloseTo(0, 3)
      expect(state.model.analysis.onset[1]).toBeCloseTo(128 / 255 * 4, 2)
      expect(state.model.analysis.onset[2]).toBeCloseTo(4, 3)
    }
    expect(fetches).toHaveLength(0)
    expect(workers).toHaveLength(0)
    expect(saveSongRhythmMock).not.toHaveBeenCalled()
  })

  it('服务端返回 pending 时轮询等待就绪，取消时立即停止轮询', async () => {
    vi.useFakeTimers()
    fetchSongRhythmMock
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({
        status: 'ready',
        analysis: {
          algoVersion: 1,
          durationMs: 22000,
          frameMs: 11.61,
          frameOffsetMs: 46.44,
          periodMs: 500,
          basePeriodMs: 500,
          bpm: 120,
          confidence: 0.6,
          loudLow: -20,
          loudHigh: -8,
          beats: [{ t: 500, loud: -10, strength: 1.2 }],
          autocorr: [1, 0.5],
          onsetMax: 2,
          onsetData: btoa(String.fromCharCode(64, 255)),
        },
      })

    const source = await loadSource()
    source.requestRhythm(11, url(11))
    await vi.advanceTimersByTimeAsync(0)
    expect(source.getRhythmState(11)?.status).toBe('loading')
    await vi.advanceTimersByTimeAsync(800)
    expect(source.getRhythmState(11)?.status).toBe('ready')
    expect(fetches).toHaveLength(0)

    fetchSongRhythmMock.mockResolvedValue({ status: 'pending' })
    const callsBeforeAbort = fetchSongRhythmMock.mock.calls.length
    const ctrl = new AbortController()
    source.requestRhythm(12, url(12), ctrl.signal)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchSongRhythmMock.mock.calls.length).toBe(callsBeforeAbort + 1)
    ctrl.abort()
    expect(source.getRhythmState(12)).toBeNull()
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchSongRhythmMock.mock.calls.length).toBe(callsBeforeAbort + 1)
    expect(fetches).toHaveLength(0)
  })

  it('仅管理员完整分析本地兜底后静默上传服务端，试听残片与普通访客不上传', async () => {
    const source = await loadSource()

    // 1. 管理员完整分析 -> 上传
    source.requestRhythm(20, url(20), undefined, { isAdmin: true, expectedDurationMs: 22000 })
    await flush()
    fetches[0].resolve()
    await flush()
    workers[0].reply(12)
    await flush()
    expect(source.getRhythmState(20)?.status).toBe('ready')
    expect(saveSongRhythmMock).toHaveBeenCalledTimes(1)
    expect(saveSongRhythmMock).toHaveBeenCalledWith(20, expect.objectContaining({
      algoVersion: 1,
      durationMs: 22000,
      onsetData: expect.any(String),
    }))

    // 2. 管理员遇到 22s 试听片段（期望 240s）-> 拒绝上传
    saveSongRhythmMock.mockClear()
    source.requestRhythm(21, url(21), undefined, { isAdmin: true, expectedDurationMs: 240000 })
    await flush()
    fetches[1].resolve()
    await flush()
    workers[0].reply(12)
    await flush()
    expect(source.getRhythmState(21)?.status).toBe('ready')
    expect(saveSongRhythmMock).not.toHaveBeenCalled()

    // 3. 普通访客 -> 不上传
    source.requestRhythm(22, url(22), undefined, { isAdmin: false, expectedDurationMs: 22000 })
    await flush()
    fetches[2].resolve()
    await flush()
    workers[0].reply(12)
    await flush()
    expect(source.getRhythmState(22)?.status).toBe('ready')
    expect(saveSongRhythmMock).not.toHaveBeenCalled()
  })
})
