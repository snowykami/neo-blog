import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchNcmPlaylist, fetchPlaylist, fetchPlaylistVersion } from './music'

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

  it('fetchPlaylist 对网易云歌单只返回曲目', async () => {
    client.get.mockResolvedValue({ data: { status: 200, message: 'success', data: tracks }, headers: { 'x-playlist-version': 'abc123' } })
    await expect(fetchPlaylist({ type: 'ncm' })).resolves.toEqual(tracks)
  })

  it('歌单版本接口返回字符串版本', async () => {
    client.get.mockResolvedValue({ data: { status: 200, message: 'success', data: 'abc123' } })
    await expect(fetchPlaylistVersion()).resolves.toBe('abc123')
    expect(client.get).toHaveBeenCalledWith('/music/playlist/version')
  })
})
