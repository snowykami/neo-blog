import { describe, expect, it, vi } from 'vitest'
import { fetchSongAudioURL } from './music'

const client = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('./client', () => ({ default: client }))

describe('播放地址', () => {
  it('取预取的临时播放地址', async () => {
    client.get.mockResolvedValue({ data: { status: 200, message: 'success', data: { url: 'https://m701.music.126.net/1-exhigh.mp3' } } })
    await expect(fetchSongAudioURL(1)).resolves.toBe('https://m701.music.126.net/1-exhigh.mp3')
    // 与 /song/:id/audio 同一音质（不带 level），后端才命中同一份缓存
    expect(client.get).toHaveBeenCalledWith('/music/song/1/audio/url')
  })

  it('失败时抛出，由调用方决定是否重试（预取失败不影响播放）', async () => {
    client.get.mockImplementation(() => Promise.reject(new Error('network')))
    const error = await fetchSongAudioURL(1).then(() => null, (reason: unknown) => reason)
    expect(error).toBeInstanceOf(Error)
  })
})
