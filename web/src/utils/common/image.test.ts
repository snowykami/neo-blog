import { describe, expect, it, vi } from 'vitest'

vi.stubEnv('NEXT_PUBLIC_IMAGE_OPTIMIZE_HOSTS', 'img.example.com, CDN.Example.com')
const { shouldOptimize } = await import('./image')

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
