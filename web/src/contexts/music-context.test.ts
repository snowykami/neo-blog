import type { MusicTrack } from '@/models/music'
import { describe, expect, it } from 'vitest'
import { PREFETCH_TTL_MS, rebasePlaylist, shouldPrefetch } from './music-context'

function track(id: number): MusicTrack {
  return { id, name: `歌${id}`, artists: ['歌手'], album: '专辑', albumPic: '', audio: `/api/v1/music/song/${id}/audio`, lyric: '', link: '', aliases: [] }
}

describe('换上新版本歌单（rebasePlaylist）', () => {
  it('当前曲目还在新歌单中：按 id 定位到新位置，用新歌单的数据', () => {
    const fresh = [track(9), track(1), track(2), track(3)]
    const result = rebasePlaylist(fresh, track(2), 1)
    expect(result.tracks).toBe(fresh)
    expect(result.index).toBe(2)
    expect(result.tracks[result.index!].id).toBe(2)
  })

  it('当前曲目被移出歌单：留在原来的位置继续放，不跳到第一首', () => {
    const current = track(2)
    const result = rebasePlaylist([track(1), track(3), track(4)], current, 1)
    expect(result.tracks.map(t => t.id)).toEqual([1, 2, 3, 4])
    expect(result.index).toBe(1)
    expect(result.tracks[1]).toBe(current)
  })

  it('当前曲目被移出且原位置超出新歌单长度：放到末尾', () => {
    const result = rebasePlaylist([track(1)], track(5), 4)
    expect(result.tracks.map(t => t.id)).toEqual([1, 5])
    expect(result.index).toBe(1)
  })

  it('没有当前曲目时从第一首开始，空歌单时为 null', () => {
    expect(rebasePlaylist([track(1)], null, null).index).toBe(0)
    expect(rebasePlaylist([], null, null).index).toBeNull()
  })
})

describe('预取下一首的播放地址（shouldPrefetch）', () => {
  it('没预取过时预取，10 分钟内不重复，过期后再次预取', () => {
    const prefetched = new Map<number, number>()
    expect(shouldPrefetch(prefetched, 1, 0)).toBe(true)
    prefetched.set(1, 0)
    expect(shouldPrefetch(prefetched, 1, PREFETCH_TTL_MS - 1)).toBe(false)
    expect(shouldPrefetch(prefetched, 1, PREFETCH_TTL_MS)).toBe(true)
  })

  it('清掉过期的记录，表不会一直变大', () => {
    const prefetched = new Map([[1, 0], [2, 0], [3, PREFETCH_TTL_MS]])
    shouldPrefetch(prefetched, 4, PREFETCH_TTL_MS + 1)
    expect([...prefetched.keys()]).toEqual([3])
  })
})
