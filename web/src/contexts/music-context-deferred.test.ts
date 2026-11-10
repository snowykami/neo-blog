import type { MusicTrack } from '@/models/music'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_LYRICS } from '@/lib/lyrics/types'
import { MusicProvider, useMusic } from './music-context'

vi.mock('@/api/music', () => ({ fetchSongAudioURL: vi.fn(() => Promise.resolve('')) }))
vi.mock('@/lib/lyrics/rhythm/source', () => ({ requestRhythm: vi.fn() }))
vi.mock('./song-lyrics', () => ({
  refreshSongLyrics: vi.fn(),
  useResolvedSongLyrics: () => ({ lyrics: EMPTY_LYRICS, candidates: [], kind: null, pending: false, status: 'none', ncmParsed: null, siteKind: null, isSiteVersion: true }),
}))
vi.mock('./lyric-annotations', () => ({
  requestLyricAnnotations: vi.fn(),
  useLyricAnnotations: () => null,
  useLyricAnnotationsGenerating: () => false,
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

function track(id: number): MusicTrack {
  return { id, name: `歌${id}`, artists: ['歌手'], album: '专辑', albumPic: '', audio: `/api/v1/music/song/${id}/audio`, lyric: '', link: '', aliases: [] }
}

let music: ReturnType<typeof useMusic>
function Probe() {
  music = useMusic()
  return null
}

let root: ReturnType<typeof createRoot> | null = null
async function mount({ audible = false } = {}) {
  // 默认不真的出声：出声后会在后台补全歌单（见预取下一首的 effect），其余用例只验证切歌与打开播放器时的补全
  if (!audible)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  root = createRoot(document.createElement('div'))
  await act(async () => {
    root!.render(createElement(MusicProvider, null, createElement(Probe)))
  })
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.restoreAllMocks()
})

describe('恢复播放只取一首，完整歌单之后再取', () => {
  it('只有恢复的那一首时，下一首 / 上一首先取完整歌单再按完整歌单切歌，只取一次', async () => {
    await mount()
    const full = [track(1), track(2), track(3)]
    const load = vi.fn(() => Promise.resolve(full))
    await act(async () => {
      music.replacePlaylist([track(2)], 0, 30)
      music.deferPlaylist(load, true)
    })
    expect(music.playlistComplete).toBe(false)
    expect(music.currentTrack?.id).toBe(2)

    await act(async () => {
      music.next()
      music.next()
    })
    await vi.waitFor(() => expect(music.playlistComplete).toBe(true))
    expect(load).toHaveBeenCalledTimes(1)
    expect(music.playlist.map(t => t.id)).toEqual([1, 2, 3])
    // 两次「下一首」都等完整歌单：2 → 3 → 1（列表循环）
    expect(music.currentTrack?.id).toBe(1)

    await act(async () => music.prev())
    expect(music.currentTrack?.id).toBe(3)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('打开播放器时补全：不换歌，当前曲目定位到完整歌单中的位置', async () => {
    await mount()
    const load = vi.fn(() => Promise.resolve([track(1), track(2), track(3)]))
    await act(async () => {
      music.replacePlaylist([track(3)], 0)
      music.deferPlaylist(load, true)
    })
    await act(async () => music.ensurePlaylist())
    expect(music.currentTrack?.id).toBe(3)
    expect(music.currentIndex).toBe(2)
    // 已取全时不再请求
    await act(async () => music.ensurePlaylist())
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('取不到完整歌单时保留现有歌单，按钮不失灵，下次再试', async () => {
    await mount()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const load = vi.fn<() => Promise<MusicTrack[]>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([track(1), track(2)])
    await act(async () => {
      music.replacePlaylist([track(2)], 0)
      music.deferPlaylist(load, true)
    })
    await act(async () => music.next())
    expect(music.currentTrack?.id).toBe(2)
    expect(music.playlistComplete).toBe(false)

    await act(async () => music.next())
    await vi.waitFor(() => expect(music.playlistComplete).toBe(true))
    expect(load).toHaveBeenCalledTimes(2)
    expect(music.currentTrack?.id).toBe(1)
    errorSpy.mockRestore()
  })

  it('本地缓存的版本过期：现有歌单照常切歌（不等），补全后换上新版本', async () => {
    await mount()
    const load = vi.fn(() => Promise.resolve([track(1), track(2), track(4)]))
    await act(async () => {
      music.replacePlaylist([track(1), track(2), track(3)], 0)
      music.deferPlaylist(load, false)
    })
    expect(music.playlistComplete).toBe(true)
    await act(async () => music.next())
    expect(music.currentTrack?.id).toBe(2)
    expect(load).not.toHaveBeenCalled()

    await act(async () => music.ensurePlaylist())
    expect(music.playlist.map(t => t.id)).toEqual([1, 2, 4])
    expect(music.currentTrack?.id).toBe(2)
  })

  it('开始出声后在后台补全歌单，之后的切歌不用再等', async () => {
    await mount({ audible: true })
    const load = vi.fn(() => Promise.resolve([track(1), track(2), track(3)]))
    await act(async () => {
      music.replacePlaylist([track(2)], 0)
      music.deferPlaylist(load, true)
    })
    expect(load).not.toHaveBeenCalled()
    await act(async () => {
      music.play()
      music.getAudio()?.dispatchEvent(new Event('playing'))
    })
    await vi.waitFor(() => expect(music.playlistComplete).toBe(true))
    expect(load).toHaveBeenCalledTimes(1)
    expect(music.currentTrack?.id).toBe(2)
  })

  it('恢复用的那一首还没到就打开了播放器：登记获取函数时立即补全', async () => {
    await mount()
    const load = vi.fn(() => Promise.resolve([track(1), track(2)]))
    await act(async () => music.ensurePlaylist())
    expect(load).not.toHaveBeenCalled()
    await act(async () => {
      music.replacePlaylist([track(2)], 0)
      music.deferPlaylist(load, true)
    })
    await vi.waitFor(() => expect(music.playlistComplete).toBe(true))
    expect(load).toHaveBeenCalledTimes(1)
    expect(music.currentIndex).toBe(1)
  })
})
