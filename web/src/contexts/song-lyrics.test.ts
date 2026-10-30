import type { MusicLyricStreamEvent } from '@/api/music'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// 每个用例重新加载模块（歌词流是否可用是模块内的状态），mock 函数在各次加载间共用
const api = vi.hoisted(() => ({
  fetchNcmLyric: vi.fn(),
  fetchTtmlLyric: vi.fn(),
  fetchQqLyric: vi.fn(),
  fetchKugouLyric: vi.fn(),
  fetchLyricCache: vi.fn(),
  streamSongLyrics: vi.fn(),
}))
vi.mock('@/api/music', () => api)

let lyrics: typeof import('./song-lyrics')
const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const LINE_TIMED = { lrc: { lyric: '[00:01.00]一', version: 1 } }
const WORD_TIMED = { yrc: { lyric: '[1000,1000](1000,1000,0)一', version: 1 } }

interface StreamOptions {
  refresh?: boolean
  onEvent: (event: MusicLyricStreamEvent) => void
}

/** 歌词流按顺序推送 events；done 为是否收到 done（false 模拟中途断开） */
function streamWith(events: MusicLyricStreamEvent[], done = true) {
  return (_id: number, { onEvent }: StreamOptions) => {
    events.forEach(onEvent)
    return Promise.resolve(done)
  }
}

const SOURCES_OK: MusicLyricStreamEvent[] = [
  { event: 'source', kind: 'ncm', data: WORD_TIMED, failed: false },
  { event: 'source', kind: 'ttml', data: null, failed: false },
  { event: 'source', kind: 'qq', data: null, failed: false },
  { event: 'source', kind: 'kugou', data: null, failed: false },
  { event: 'decided', version: { kind: 'ncm', source: 'ncm-yrc' } },
  { event: 'done' },
]

beforeEach(async () => {
  vi.resetAllMocks()
  vi.resetModules()
  api.fetchLyricCache.mockResolvedValue(null)
  api.fetchNcmLyric.mockResolvedValue(LINE_TIMED)
  api.fetchTtmlLyric.mockResolvedValue(null)
  api.fetchQqLyric.mockResolvedValue(null)
  api.fetchKugouLyric.mockResolvedValue(null)
  lyrics = await import('./song-lyrics')
})

describe('歌词流', () => {
  it('一个请求取到所有来源，不再单独请求各来源；同一首歌只请求一次', async () => {
    api.streamSongLyrics.mockImplementation(streamWith(SOURCES_OK))
    lyrics.loadSongLyrics(1)
    lyrics.loadSongLyrics(1)
    await flush()
    lyrics.loadSongLyrics(1)
    expect(api.streamSongLyrics).toHaveBeenCalledTimes(1)
    expect(api.fetchNcmLyric).not.toHaveBeenCalled()
    expect(api.fetchLyricCache).not.toHaveBeenCalled()
  })

  it('获取失败的来源在下次需要时重新用歌词流获取', async () => {
    api.streamSongLyrics.mockImplementation(streamWith(SOURCES_OK.map(event => event.event === 'source' && event.kind === 'qq' ? { ...event, failed: true } : event)))
    lyrics.loadSongLyrics(2)
    await flush()
    lyrics.loadSongLyrics(2)
    await flush()
    expect(api.streamSongLyrics).toHaveBeenCalledTimes(2)
    expect(api.fetchQqLyric).not.toHaveBeenCalled()
  })

  it('还没收到任何事件就失败：改用各来源的接口，本页之后不再尝试歌词流', async () => {
    api.streamSongLyrics.mockResolvedValue(false)
    api.fetchNcmLyric.mockResolvedValue(LINE_TIMED)
    api.fetchTtmlLyric.mockResolvedValue(null)
    lyrics.loadSongLyrics(3)
    await flush()
    expect(api.fetchLyricCache).toHaveBeenCalledWith(3)
    for (const fetch of [api.fetchNcmLyric, api.fetchTtmlLyric, api.fetchQqLyric, api.fetchKugouLyric])
      expect(fetch).toHaveBeenCalledWith(3)
    // 下一首歌直接并发请求各来源
    lyrics.loadSongLyrics(4)
    expect(api.fetchKugouLyric).toHaveBeenCalledWith(4)
    expect(api.streamSongLyrics).toHaveBeenCalledTimes(1)
  })

  it('中途断开：只为没到达的来源改用各来源的接口', async () => {
    api.streamSongLyrics.mockImplementation(streamWith([
      { event: 'cache', cache: { kind: 'ncm', ncm: LINE_TIMED } },
      { event: 'source', kind: 'ncm', data: WORD_TIMED, failed: false },
    ], false))
    api.fetchTtmlLyric.mockResolvedValue(null)
    lyrics.loadSongLyrics(5)
    await flush()
    expect(api.fetchNcmLyric).not.toHaveBeenCalled()
    expect(api.fetchLyricCache).not.toHaveBeenCalled()
    expect(api.fetchTtmlLyric).toHaveBeenCalledWith(5)
    expect(api.fetchQqLyric).toHaveBeenCalledWith(5)
    // 收到过事件的失败不视为歌词流不可用
    api.streamSongLyrics.mockImplementation(streamWith(SOURCES_OK))
    lyrics.loadSongLyrics(6)
    expect(api.streamSongLyrics).toHaveBeenCalledTimes(2)
  })

  it('重新获取歌词：歌词流带 refresh', async () => {
    api.streamSongLyrics.mockImplementation(streamWith(SOURCES_OK))
    lyrics.loadSongLyrics(30)
    await flush()
    lyrics.refreshSongLyrics(30)
    await flush()
    expect(api.streamSongLyrics).toHaveBeenLastCalledWith(30, expect.objectContaining({ refresh: true }))
  })
})

describe('歌词流不可用时并发请求各来源', () => {
  beforeEach(async () => {
    // 第一次歌词流失败后，本页改用各来源的接口
    api.streamSongLyrics.mockResolvedValue(false)
    lyrics.loadSongLyrics(999)
    await flush()
    vi.clearAllMocks()
  })

  it('所有来源都并发请求：网易云有逐字歌词也照样请求 QQ 音乐与酷狗音乐；同一首歌只请求一次', async () => {
    api.fetchNcmLyric.mockResolvedValue(WORD_TIMED)
    api.fetchTtmlLyric.mockResolvedValue({ source: 'amll', ttml: '<tt/>' })
    lyrics.loadSongLyrics(2)
    lyrics.loadSongLyrics(2)
    // 不等网易云与 TTML 的结果，一开始就全部发出
    expect(api.fetchQqLyric).toHaveBeenCalledWith(2)
    expect(api.fetchKugouLyric).toHaveBeenCalledWith(2)
    await flush()
    expect(api.fetchNcmLyric).toHaveBeenCalledTimes(1)
    expect(api.fetchTtmlLyric).toHaveBeenCalledTimes(1)
    expect(api.fetchQqLyric).toHaveBeenCalledTimes(1)
    expect(api.fetchKugouLyric).toHaveBeenCalledTimes(1)
  })

  it('请求失败的来源在下次需要时重试', async () => {
    api.fetchNcmLyric.mockRejectedValueOnce(new Error('network')).mockResolvedValue(WORD_TIMED)
    api.fetchTtmlLyric.mockResolvedValue(null)
    lyrics.loadSongLyrics(4)
    await flush()
    lyrics.loadSongLyrics(4)
    await flush()
    expect(api.fetchNcmLyric).toHaveBeenCalledTimes(2)
  })

  it('只重试失败的来源', async () => {
    api.fetchNcmLyric.mockResolvedValue(LINE_TIMED)
    api.fetchTtmlLyric.mockResolvedValue(null)
    api.fetchKugouLyric.mockRejectedValueOnce(new Error('network')).mockResolvedValue(null)
    lyrics.loadSongLyrics(5)
    await flush()
    lyrics.loadSongLyrics(5)
    await flush()
    expect(api.fetchQqLyric).toHaveBeenCalledTimes(1)
    expect(api.fetchKugouLyric).toHaveBeenCalledTimes(2)
  })

  it('重新获取歌词：所有来源都带 refresh 重新请求', async () => {
    api.fetchNcmLyric.mockResolvedValue(WORD_TIMED)
    api.fetchTtmlLyric.mockResolvedValue(null)
    lyrics.loadSongLyrics(30)
    await flush()
    expect(api.fetchQqLyric).toHaveBeenLastCalledWith(30)
    lyrics.refreshSongLyrics(30)
    await flush()
    expect(api.fetchNcmLyric).toHaveBeenLastCalledWith(30, undefined, true)
    expect(api.fetchTtmlLyric).toHaveBeenLastCalledWith(30, undefined, true)
    expect(api.fetchQqLyric).toHaveBeenCalledWith(30, undefined, true)
    expect(api.fetchKugouLyric).toHaveBeenCalledWith(30, undefined, true)
  })
})

it('歌词缓存：实时来源还在请求中或失败时用快照补位，实时结果优先', () => {
  const cached = { kind: 'ttml' as const, ttml: { source: 'amll' as const, ttml: '<tt/>' }, ncm: LINE_TIMED }
  expect(lyrics.withCachedSources({ cache: cached })).toMatchObject({ ttml: cached.ttml, ncm: LINE_TIMED, qq: undefined })
  // 失败（null）时也用快照；实时结果到达后以实时为准
  expect(lyrics.withCachedSources({ cache: cached, ttml: null, ncm: WORD_TIMED })).toMatchObject({ ttml: cached.ttml, ncm: WORD_TIMED })
  expect(lyrics.withCachedSources({ cache: null, ttml: null })).toEqual({ cache: null, ttml: null })
})
