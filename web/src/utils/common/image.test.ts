import { describe, expect, it, vi } from 'vitest'

vi.stubEnv('NEXT_PUBLIC_IMAGE_OPTIMIZE_HOSTS', 'img.example.com, CDN.Example.com')
const { shouldOptimize, formatMusicCoverUrl } = await import('./image')

describe('shouldOptimize', () => {
  it.each([
    ['/api/v1/file/1', true],
    ['/logo.png', true],
    ['//cdn.other.com/a.png', false],
    ['https://img.example.com/a.png', true],
    ['https://cdn.example.com/a.png', true],
    ['http://img.example.com/a.png', false],
    ['https://p1.music.126.net/a.jpg', false],
    ['not a url', false],
    ['data:image/png;base64,xx', false],
    ['', false],
  ])('%s → %s', (src, expected) => {
    expect(shouldOptimize(src)).toBe(expected)
  })

  it('静态 import 的图片走优化', () => {
    expect(shouldOptimize({ src: '/_next/static/a.png', width: 1, height: 1 })).toBe(true)
  })
})

describe('formatMusicCoverUrl', () => {
  it('对网易云链接自动添加 param 参数并升级 https', () => {
    expect(formatMusicCoverUrl('http://p1.music.126.net/abc.jpg', 300)).toBe('https://p1.music.126.net/abc.jpg?param=300y300')
    expect(formatMusicCoverUrl('https://p2.music.126.net/xyz.jpg?param=100y100', 80)).toBe('https://p2.music.126.net/xyz.jpg?param=80y80')
  })

  it('非网易云链接保持原样', () => {
    expect(formatMusicCoverUrl('https://example.com/cover.jpg', 300)).toBe('https://example.com/cover.jpg')
    expect(formatMusicCoverUrl('')).toBe('')
    expect(formatMusicCoverUrl(null)).toBe('')
  })
})
