import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchKugouLyric, fetchNcmLyric, fetchQqLyric, fetchTtmlLyric } from '@/api/music'
import { loadSongLyrics, refreshSongLyrics, withCachedSources } from './song-lyrics'

vi.mock('@/api/music', () => ({
  fetchNcmLyric: vi.fn(),
  fetchTtmlLyric: vi.fn(),
  fetchQqLyric: vi.fn(),
  fetchKugouLyric: vi.fn(),
  fetchLyricCache: vi.fn(() => Promise.resolve(null)),
  saveLyricCache: vi.fn(() => Promise.resolve()),
}))

const ncm = vi.mocked(fetchNcmLyric)
const ttml = vi.mocked(fetchTtmlLyric)
const qq = vi.mocked(fetchQqLyric)
const kugou = vi.mocked(fetchKugouLyric)
const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const LINE_TIMED = { lrc: { lyric: '[00:01.00]一', version: 1 } }
const WORD_TIMED = { yrc: { lyric: '[1000,1000](1000,1000,0)一', version: 1 } }

describe('全站共用的歌词来源', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    qq.mockResolvedValue(null)
    kugou.mockResolvedValue(null)
  })

  it('网易云只有逐行且没有 TTML 时并发请求 QQ 音乐与酷狗音乐', async () => {
    ncm.mockResolvedValue(LINE_TIMED)
    ttml.mockResolvedValue(null)
    loadSongLyrics(1)
    await flush()
    expect(qq).toHaveBeenCalledWith(1)
    expect(kugou).toHaveBeenCalledWith(1)
  })

  it('网易云有逐字歌词时不请求 QQ 音乐；同一首歌只请求一次', async () => {
    ncm.mockResolvedValue(WORD_TIMED)
    ttml.mockResolvedValue(null)
    loadSongLyrics(2)
    loadSongLyrics(2)
    await flush()
    expect(qq).not.toHaveBeenCalled()
    expect(kugou).not.toHaveBeenCalled()
    expect(ncm).toHaveBeenCalledTimes(1)
  })

  it('tTML 先于网易云命中时不请求兜底来源；固定了兜底来源时仍然请求', async () => {
    let resolveNcm: (value: typeof LINE_TIMED) => void = () => {}
    ncm.mockReturnValue(new Promise((resolve) => {
      resolveNcm = resolve
    }))
    ttml.mockResolvedValue({ source: 'amll', ttml: '<tt/>' })
    loadSongLyrics(3)
    await flush()
    resolveNcm(LINE_TIMED)
    await flush()
    expect(qq).not.toHaveBeenCalled()

    loadSongLyrics(3, { wantFallback: true })
    expect(qq).toHaveBeenCalledWith(3)
    expect(kugou).toHaveBeenCalledWith(3)
  })

  it('请求失败的来源在下次需要时重试', async () => {
    ncm.mockRejectedValueOnce(new Error('network')).mockResolvedValue(WORD_TIMED)
    ttml.mockResolvedValue(null)
    loadSongLyrics(4)
    await flush()
    loadSongLyrics(4)
    await flush()
    expect(ncm).toHaveBeenCalledTimes(2)
  })

  it('兜底来源只重试失败的那个', async () => {
    ncm.mockResolvedValue(LINE_TIMED)
    ttml.mockResolvedValue(null)
    kugou.mockRejectedValueOnce(new Error('network')).mockResolvedValue(null)
    loadSongLyrics(5)
    await flush()
    loadSongLyrics(5)
    await flush()
    expect(qq).toHaveBeenCalledTimes(1)
    expect(kugou).toHaveBeenCalledTimes(2)
  })

  it('歌词缓存：实时来源还在请求中或失败时用快照补位，实时结果优先', () => {
    const cached = { kind: 'ttml' as const, ttml: { source: 'amll' as const, ttml: '<tt/>' }, ncm: LINE_TIMED }
    expect(withCachedSources({ cache: cached })).toMatchObject({ ttml: cached.ttml, ncm: LINE_TIMED, qq: undefined })
    // 失败（null）时也用快照；实时结果到达后以实时为准
    expect(withCachedSources({ cache: cached, ttml: null, ncm: WORD_TIMED })).toMatchObject({ ttml: cached.ttml, ncm: WORD_TIMED })
    expect(withCachedSources({ cache: null, ttml: null })).toEqual({ cache: null, ttml: null })
  })

  it('重新获取歌词：所有来源都带 refresh 重新请求（含原本不需要的兜底来源）', async () => {
    ncm.mockResolvedValue(WORD_TIMED)
    ttml.mockResolvedValue(null)
    loadSongLyrics(30)
    await flush()
    expect(qq).not.toHaveBeenCalled()
    refreshSongLyrics(30)
    await flush()
    expect(ncm).toHaveBeenLastCalledWith(30, undefined, true)
    expect(ttml).toHaveBeenLastCalledWith(30, undefined, true)
    expect(qq).toHaveBeenCalledWith(30, undefined, true)
    expect(kugou).toHaveBeenCalledWith(30, undefined, true)
  })
})
