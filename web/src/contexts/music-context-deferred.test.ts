import type { MusicTrack } from '@/models/music'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_LYRICS } from '@/lib/lyrics/types'
import { MAX_ABNORMAL_AUTO_SKIPS, MAX_MEDIA_SESSION_STORM_SKIPS, MIN_VALID_PLAY_MS, MusicProvider, useMusic } from './music-context'

// 提示文案直接用键名，便于断言
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

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
  localStorage.clear()
  vi.restoreAllMocks()
  vi.mocked(toast.error).mockClear()
})

/** 手动控制何时完成的 Promise */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

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

  it('取不到完整歌单时保留现有歌单、不切歌也不从头重播，提示读者，下次再试', async () => {
    await mount()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const load = vi.fn<() => Promise<MusicTrack[]>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([track(1), track(2)])
    await act(async () => {
      music.replacePlaylist([track(2)], 0)
      music.deferPlaylist(load, true)
    })
    const audio = music.getAudio()!
    audio.currentTime = 30
    await act(async () => music.next())
    expect(music.currentTrack?.id).toBe(2)
    expect(music.playlistComplete).toBe(false)
    // 不再「从头播放当前这首」
    expect(audio.currentTime).toBe(30)
    expect(toast.error).toHaveBeenCalledWith('playlist_load_failed', expect.anything())
    expect(music.pendingStep).toBeNull()
    expect(music.playlistLoading).toBe(false)

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

  it('等歌单补全期间按钮显示忙碌，读者自己选了歌就丢弃排队的下一首', async () => {
    await mount()
    const full = deferred<MusicTrack[]>()
    const load = vi.fn(() => full.promise)
    await act(async () => {
      music.replacePlaylist([track(2)], 0)
      music.deferPlaylist(load, true)
    })
    await act(async () => music.next())
    expect(music.pendingStep).toBe(1)
    expect(music.playlistLoading).toBe(true)

    // 等待期间读者播放了文章里的一首歌（不在歌单内）
    await act(async () => music.playSong(track(9)))
    expect(music.currentTrack?.id).toBe(9)
    expect(music.pendingStep).toBeNull()

    await act(async () => full.resolve([track(1), track(2), track(3)]))
    await vi.waitFor(() => expect(music.playlistComplete).toBe(true))
    // 排队的「下一首」被读者的选择取代，补全后不再把读者选的歌切走
    expect(music.currentTrack?.id).toBe(9)
    expect(music.playlistLoading).toBe(false)
  })

  it('读者在歌单里点歌同样取代排队的上一首', async () => {
    await mount()
    const full = deferred<MusicTrack[]>()
    await act(async () => {
      music.replacePlaylist([track(2), track(5)], 0)
      music.deferPlaylist(() => full.promise, true)
    })
    await act(async () => music.prev())
    expect(music.pendingStep).toBe(-1)
    await act(async () => music.playTrack(1))
    expect(music.currentTrack?.id).toBe(5)
    await act(async () => full.resolve([track(1), track(2), track(3), track(5)]))
    await vi.waitFor(() => expect(music.playlistComplete).toBe(true))
    expect(music.currentTrack?.id).toBe(5)
  })
})

describe('<audio> 出错', () => {
  function fail(audio: HTMLAudioElement, { paused }: { paused: boolean }) {
    Object.defineProperty(audio, 'error', { configurable: true, value: { code: 2, message: 'network' } })
    Object.defineProperty(audio, 'paused', { configurable: true, get: () => paused })
    audio.dispatchEvent(new Event('error'))
  }

  it('播放中出错：停下来、不再显示播放中，并提示一次', async () => {
    await mount()
    await act(async () => music.replacePlaylist([track(1), track(2)], 0))
    const audio = music.getAudio()!
    const pause = vi.spyOn(audio, 'pause').mockImplementation(() => {})
    await act(async () => {
      audio.dispatchEvent(new Event('play'))
    })
    expect(music.isPlaying).toBe(true)
    await act(async () => fail(audio, { paused: false }))
    expect(music.isPlaying).toBe(false)
    expect(pause).toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('playback_failed', expect.anything())
  })

  it('只是预加载出错（读者没要播放）时不打扰；之后点播放会先重新加载', async () => {
    await mount()
    await act(async () => music.replacePlaylist([track(1)], 0))
    const audio = music.getAudio()!
    await act(async () => fail(audio, { paused: true }))
    expect(music.isPlaying).toBe(false)
    expect(toast.error).not.toHaveBeenCalled()

    const load = vi.spyOn(audio, 'load').mockImplementation(() => {})
    await act(async () => music.play())
    expect(load).toHaveBeenCalled()
  })

  it('中止加载（切歌）不算出错', async () => {
    await mount()
    await act(async () => music.replacePlaylist([track(1)], 0))
    const audio = music.getAudio()!
    await act(async () => {
      Object.defineProperty(audio, 'error', { configurable: true, value: { code: 1, message: 'aborted' } })
      Object.defineProperty(audio, 'paused', { configurable: true, get: () => false })
      audio.dispatchEvent(new Event('error'))
    })
    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe('异常自动切歌熔断', () => {
  it('连续未正常播放就触发 ended 达阈值时停播熔断，之后点播放会重新加载', async () => {
    await mount()
    await act(async () => music.replacePlaylist([track(1), track(2), track(3), track(4)], 0))
    const audio = music.getAudio()!
    const pause = vi.spyOn(audio, 'pause').mockImplementation(() => {})
    Object.defineProperty(audio, 'paused', { configurable: true, get: () => false })

    // 前 MAX_ABNORMAL_AUTO_SKIPS - 1 次仍允许自动切歌，兼容偶发单首异常
    for (let i = 1; i < MAX_ABNORMAL_AUTO_SKIPS; i++) {
      await act(async () => {
        audio.dispatchEvent(new Event('play'))
        audio.dispatchEvent(new Event('ended'))
      })
      expect(music.currentTrack?.id).toBe(i + 1)
      expect(toast.error).not.toHaveBeenCalled()
    }

    // 第 MAX_ABNORMAL_AUTO_SKIPS 次触发熔断：停在当前曲目（歌3），不再切到歌4
    await act(async () => {
      audio.dispatchEvent(new Event('play'))
      audio.dispatchEvent(new Event('ended'))
    })
    expect(music.currentTrack?.id).toBe(MAX_ABNORMAL_AUTO_SKIPS)
    expect(music.isPlaying).toBe(false)
    expect(pause).toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('playback_circuit_broken', expect.anything())

    // 熔断后读者手动点播放：重新 load() 并重置计数
    Object.defineProperty(audio, 'paused', { configurable: true, get: () => true })
    const load = vi.spyOn(audio, 'load').mockImplementation(() => {})
    await act(async () => music.play())
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('单曲循环下连续异常 ended 同样熔断，不会在同一首死循环重播', async () => {
    await mount()
    await act(async () => {
      music.replacePlaylist([track(1), track(2)], 0)
      music.setPlayMode('repeat-one')
    })
    const audio = music.getAudio()!
    const playSpy = vi.mocked(audio.play)
    playSpy.mockClear()

    for (let i = 0; i < MAX_ABNORMAL_AUTO_SKIPS; i++) {
      await act(async () => {
        audio.dispatchEvent(new Event('ended'))
      })
    }
    // 前 MAX_ABNORMAL_AUTO_SKIPS - 1 次重播，最后一次熔断不再调用 play()
    expect(playSpy).toHaveBeenCalledTimes(MAX_ABNORMAL_AUTO_SKIPS - 1)
    expect(toast.error).toHaveBeenCalledWith('playback_circuit_broken', expect.anything())
  })

  it('中间有一首正常播放满阈值后清零异常计数，后续继续正常切歌', async () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    await mount()
    await act(async () => music.replacePlaylist([track(1), track(2), track(3), track(4)], 0))
    const audio = music.getAudio()!

    // 歌1、歌2 异常秒切（计数 = 2）
    await act(async () => {
      audio.dispatchEvent(new Event('ended'))
    })
    await act(async () => {
      audio.dispatchEvent(new Event('ended'))
    })
    expect(music.currentTrack?.id).toBe(3)

    // 歌3 正常出声播放满 MIN_VALID_PLAY_MS 后自然结束 -> 清零计数并切到歌4
    await act(async () => {
      audio.dispatchEvent(new Event('playing'))
    })
    now += MIN_VALID_PLAY_MS + 500
    await act(async () => {
      audio.dispatchEvent(new Event('ended'))
    })
    expect(music.currentTrack?.id).toBe(4)
    expect(toast.error).not.toHaveBeenCalled()

    // 歌4 即使再次秒切，也从 1 重新计，不会立刻误熔断
    await act(async () => {
      audio.dispatchEvent(new Event('ended'))
    })
    expect(music.currentTrack?.id).toBe(1)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('读者主动拖动进度条到末尾后触发 ended 不计为异常', async () => {
    await mount()
    await act(async () => music.replacePlaylist([track(1), track(2), track(3), track(4)], 0))
    const audio = music.getAudio()!
    Object.defineProperty(audio, 'duration', { configurable: true, value: 200 })

    for (let i = 0; i < MAX_ABNORMAL_AUTO_SKIPS + 1; i++) {
      await act(async () => {
        music.seek(199)
        audio.dispatchEvent(new Event('ended'))
      })
    }
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('系统 MediaSession 连续快速未出声切歌触发熔断，界面按钮手动切歌不受限', async () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const handlers = new Map<string, MediaSessionActionHandler | null>()
    Object.defineProperty(navigator, 'mediaSession', {
      configurable: true,
      value: {
        metadata: null,
        playbackState: 'none',
        setActionHandler: vi.fn((action: string, handler: MediaSessionActionHandler | null) => {
          handlers.set(action, handler)
        }),
        setPositionState: vi.fn(),
      },
    })

    await mount()
    await act(async () => music.replacePlaylist([track(1), track(2), track(3), track(4), track(5), track(6)], 0))

    // 界面按钮连续快速点下一首：不受熔断限制
    for (let i = 0; i < MAX_MEDIA_SESSION_STORM_SKIPS + 2; i++) {
      now += 100
      await act(async () => music.next())
    }
    expect(toast.error).not.toHaveBeenCalled()

    // 系统 MediaSession 短时间内连续未出声触发 nexttrack：达阈值时熔断
    const nextTrack = handlers.get('nexttrack')!
    for (let i = 0; i < MAX_MEDIA_SESSION_STORM_SKIPS; i++) {
      now += 100
      await act(async () => {
        nextTrack({ action: 'nexttrack' })
      })
    }
    expect(toast.error).toHaveBeenCalledWith('playback_circuit_broken', expect.anything())
  })
})
