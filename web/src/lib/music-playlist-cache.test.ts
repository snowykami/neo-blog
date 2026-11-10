import type { MusicTrack } from '@/models/music'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readPlaylistCache, touchPlaylistCache, writePlaylistCache } from './music-playlist-cache'

function track(id: number): MusicTrack {
  return {
    id,
    name: `歌${id}`,
    artists: ['歌手'],
    album: '专辑',
    albumPic: 'https://p1.music.126.net/a.jpg',
    audio: `/api/v1/music/song/${id}/audio`,
    lyric: `/api/v1/music/song/${id}/lyric`,
    link: `https://music.163.com/#/song?id=${id}`,
    aliases: [],
  }
}

describe('歌单本地缓存', () => {
  beforeEach(() => localStorage.clear())

  it('写入后能读回同一份歌单与版本', () => {
    writePlaylistCache('abc', [track(1), track(2)])
    expect(readPlaylistCache()).toEqual({ version: 'abc', tracks: [track(1), track(2)] })
  })

  it('没有缓存时返回 null', () => {
    expect(readPlaylistCache()).toBeNull()
  })

  it('超过一天不再使用，并清掉本地副本', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      writePlaylistCache('abc', [track(1)])
      vi.setSystemTime(new Date('2026-01-02T01:00:00Z'))
      expect(readPlaylistCache()).toBeNull()
      expect(localStorage.getItem('music-playlist')).toBeNull()
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('数据损坏或形状不对时返回 null', () => {
    localStorage.setItem('music-playlist', '{oops')
    expect(readPlaylistCache()).toBeNull()

    localStorage.setItem('music-playlist', JSON.stringify({ version: 'abc', savedAt: Date.now(), tracks: [{ id: 'x' }] }))
    expect(readPlaylistCache()).toBeNull()
  })

  it('写不进存储（容量不足）时不抛错', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    try {
      expect(() => writePlaylistCache('abc', [track(1)])).not.toThrow()
    }
    finally {
      spy.mockRestore()
    }
  })

  it('版本校验通过时刷新保存时间：每天都来的读者不会每 24 小时重新下载', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      writePlaylistCache('abc', [track(1)])
      vi.setSystemTime(new Date('2026-01-01T20:00:00Z'))
      touchPlaylistCache('abc')
      vi.setSystemTime(new Date('2026-01-02T10:00:00Z'))
      expect(readPlaylistCache()).toEqual({ version: 'abc', tracks: [track(1)] })
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('版本不一致或没有缓存时不刷新', () => {
    vi.useFakeTimers()
    try {
      touchPlaylistCache('abc')
      expect(localStorage.getItem('music-playlist')).toBeNull()
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      writePlaylistCache('abc', [track(1)])
      vi.setSystemTime(new Date('2026-01-01T20:00:00Z'))
      touchPlaylistCache('def')
      vi.setSystemTime(new Date('2026-01-02T01:00:00Z'))
      expect(readPlaylistCache()).toBeNull()
    }
    finally {
      vi.useRealTimers()
    }
  })
})
