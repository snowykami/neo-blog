import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchNcmPlaylist, fetchPlaylistTrack, fetchPlaylistVersion } from './music'

const client = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('./client', () => ({ default: client }))

const tracks = [{
  id: 1,
  name: '空中散歩',
  artists: ['CIEL'],
  album: '空想少女',
  album_pic: 'https://p4.music.126.net/x.jpg',
  audio: '/api/v1/music/song/1/audio',
  lyric: '/api/v1/music/song/1/lyric',
  link: 'https://music.163.com/#/song?id=1',
  aliases: ['空中散步'],
}]

describe('网易云歌单', () => {
  beforeEach(() => client.get.mockReset())

  it('读取响应头里的歌单版本', async () => {
    client.get.mockResolvedValue({ data: { status: 200, message: 'success', data: tracks }, headers: { 'x-playlist-version': 'abc123' } })
    await expect(fetchNcmPlaylist()).resolves.toEqual({ tracks, version: 'abc123' })
    expect(client.get).toHaveBeenCalledWith('/music/playlist', { timeout: 60000 })
  })

  it('后端没有给出版本时为空字符串（本地缓存不据此判断，只按时间兜底）', async () => {
    client.get.mockResolvedValue({ data: { status: 200, message: 'success', data: tracks }, headers: {} })
    await expect(fetchNcmPlaylist()).resolves.toEqual({ tracks, version: '' })
  })

  it('歌单版本接口返回字符串版本；与完整歌单一样等后端现拉歌单（60 秒超时）', async () => {
    client.get.mockResolvedValue({ data: { status: 200, message: 'success', data: 'abc123' } })
    await expect(fetchPlaylistVersion()).resolves.toBe('abc123')
    expect(client.get).toHaveBeenCalledWith('/music/playlist/version', { timeout: 60000 })
  })

  it('恢复播放只取一首：候选 id 用逗号连起来，没有候选时不带参数', async () => {
    client.get.mockResolvedValue({ data: { status: 200, message: 'success', data: tracks[0] } })
    await expect(fetchPlaylistTrack([3, 1])).resolves.toEqual(tracks[0])
    expect(client.get).toHaveBeenCalledWith('/music/playlist/track', { params: { ids: '3,1' }, timeout: 60000 })
    await fetchPlaylistTrack([])
    expect(client.get).toHaveBeenLastCalledWith('/music/playlist/track', { params: undefined, timeout: 60000 })
  })

  it('歌单为空时为 null', async () => {
    client.get.mockResolvedValue({ data: { status: 200, message: 'success', data: null } })
    await expect(fetchPlaylistTrack([1])).resolves.toBeNull()
  })
})
