import type { MusicLyricStreamEvent } from '@/api/music'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('lyrics-cache-bust 歌词缓存清理桥接', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('song-lyrics 尚未加载时通知清理为安全空操作，加载后自动注册并触发清理', async () => {
    const bust = await import('./lyrics-cache-bust')
    expect(() => bust.notifyClientSongLyricsCacheClear()).not.toThrow()
    expect(() => bust.notifyClientSongLyricsCacheClear(123)).not.toThrow()

    const mockClearer = vi.fn()
    bust.registerClientSongLyricsCacheClearer(mockClearer)
    bust.notifyClientSongLyricsCacheClear()
    bust.notifyClientSongLyricsCacheClear(456)

    expect(mockClearer).toHaveBeenNthCalledWith(1, undefined)
    expect(mockClearer).toHaveBeenNthCalledWith(2, 456)
  })

  it('contexts/song-lyrics 模块初始化后注册清理器，通知后可实际清空已缓存的 TTML', async () => {
    const streamSongLyrics = vi.fn((_id: number, { onEvent }: { onEvent: (event: MusicLyricStreamEvent) => void }) => {
      onEvent({ event: 'source', kind: 'ncm', data: { lrc: { lyric: '[00:01.00]a', version: 1 } }, failed: false })
      onEvent({ event: 'source', kind: 'ttml', data: { source: 'amll', ttml: '<tt/>' }, failed: false })
      onEvent({ event: 'source', kind: 'qq', data: null, failed: false })
      onEvent({ event: 'source', kind: 'kugou', data: null, failed: false })
      onEvent({ event: 'decided', version: { kind: 'ttml', source: 'ttml-amll' } })
      onEvent({ event: 'done' })
      return Promise.resolve(true)
    })

    vi.doMock('@/api/music', () => ({
      fetchNcmLyric: vi.fn(),
      fetchTtmlLyric: vi.fn(),
      fetchQqLyric: vi.fn(),
      fetchKugouLyric: vi.fn(),
      fetchLyricCache: vi.fn().mockResolvedValue(null),
      streamSongLyrics,
    }))

    const bust = await import('./lyrics-cache-bust')
    const songLyrics = await import('@/contexts/song-lyrics')

    songLyrics.loadSongLyrics(100)
    await flush()
    // 已有缓存，再次调用不会重复请求
    songLyrics.loadSongLyrics(100)
    expect(streamSongLyrics).toHaveBeenCalledTimes(1)

    // 通过无依赖桥接通知清理后，TTML 状态被清除，再次加载会重新发起请求
    bust.notifyClientSongLyricsCacheClear(100)
    songLyrics.loadSongLyrics(100)
    await flush()
    expect(streamSongLyrics).toHaveBeenCalledTimes(2)
  })
})
