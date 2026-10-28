import type { MusicTrack } from '@/models/music'
import { describe, expect, it } from 'vitest'
import { getNextPlayMode } from '@/contexts/music-context'
import { filterPlaylist } from './playlist-filter'

const track = (id: number, name: string, artists: string[], album: string, aliases: string[] = []): MusicTrack => ({ id, name, artists, album, albumPic: '', audio: '', lyric: '', link: '', aliases })

const PLAYLIST = [
  track(1, 'One Last Kiss', ['宇多田ヒカル'], 'One Last Kiss', ['最后一吻']),
  track(2, '晴天', ['周杰伦'], '叶惠美', ['Sunny Day']),
  track(3, 'First Love', ['宇多田ヒカル'], 'First Love'),
  track(4, 'ラブソング', ['Kiss Band'], 'Kiss Me'),
]

describe('播放器页歌单搜索', () => {
  it('空关键词返回完整列表并保留原下标', () => {
    expect(filterPlaylist(PLAYLIST, '  ').map(item => item.index)).toEqual([0, 1, 2, 3])
  })

  it('匹配曲名、歌手、专辑，不区分大小写', () => {
    expect(filterPlaylist(PLAYLIST, 'first').map(item => item.track.id)).toEqual([3])
    expect(filterPlaylist(PLAYLIST, '周杰伦').map(item => item.track.id)).toEqual([2])
    expect(filterPlaylist(PLAYLIST, '叶惠美').map(item => item.index)).toEqual([1])
  })

  it('匹配别名（译名），忽略全半角、标点与空格，平假名与片假名视为相同', () => {
    expect(filterPlaylist(PLAYLIST, '最后一吻').map(item => item.track.id)).toEqual([1])
    expect(filterPlaylist(PLAYLIST, 'ｓｕｎｎｙ　day').map(item => item.track.id)).toEqual([2])
    expect(filterPlaylist(PLAYLIST, 'onelastkiss!').map(item => item.track.id)).toEqual([1])
    expect(filterPlaylist(PLAYLIST, 'らぶ').map(item => item.track.id)).toEqual([4])
  })

  it('按相关度排序：歌名 > 别名 > 艺术家 > 专辑，完全相同与开头匹配优先；输入 id 直接定位', () => {
    expect(filterPlaylist(PLAYLIST, 'kiss').map(item => item.track.id)).toEqual([1, 4])
    expect(filterPlaylist(PLAYLIST, 'love').map(item => item.track.id)).toEqual([3])
    expect(filterPlaylist(PLAYLIST, '2').map(item => item.track.id)).toEqual([2])
  })

  it('多个关键词需全部命中', () => {
    expect(filterPlaylist(PLAYLIST, '宇多田 kiss').map(item => item.track.id)).toEqual([1])
    expect(filterPlaylist(PLAYLIST, '宇多田 晴天')).toEqual([])
  })
})

describe('播放模式', () => {
  it('按 列表循环 → 单曲循环 → 随机 循环切换', () => {
    expect(getNextPlayMode('repeat-all')).toBe('repeat-one')
    expect(getNextPlayMode('repeat-one')).toBe('shuffle')
    expect(getNextPlayMode('shuffle')).toBe('repeat-all')
  })
})
