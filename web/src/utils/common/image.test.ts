import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.stubEnv('NEXT_PUBLIC_IMAGE_OPTIMIZE_HOSTS', 'img.example.com, CDN.Example.com')
const {
  defaultAvatarQuality,
  formatMusicCoverUrl,
  getImageOptimizeHosts,
  IMAGE_QUALITIES,
  parseImageOptimizeHosts,
  setRuntimeImageOptimizeHosts,
  shouldOptimize,
} = await import('./image')
const { getServerImageOptimizeHosts } = await import('./image.server')

afterEach(() => {
  setRuntimeImageOptimizeHosts(null)
  delete process.env.IMAGE_OPTIMIZE_HOSTS
  process.env.NEXT_PUBLIC_IMAGE_OPTIMIZE_HOSTS = 'img.example.com, CDN.Example.com'
})

describe('parseImageOptimizeHosts', () => {
  it('规范化逗号分隔域名：去重、小写并自动提取 URL 主机名或剥离路径', () => {
    expect(parseImageOptimizeHosts(' img.example.com , HTTPS://CDN.Example.com/path/a , cdn.example.com , r2.liteyuki.org/bucket , invalid host , '))
      .toEqual(['img.example.com', 'cdn.example.com', 'r2.liteyuki.org'])
    expect(parseImageOptimizeHosts('')).toEqual([])
    expect(parseImageOptimizeHosts(null)).toEqual([])
    expect(parseImageOptimizeHosts(undefined)).toEqual([])
  })
})

describe('shouldOptimize', () => {
  it.each([
    ['/api/v1/file/1', true],
    ['/logo.png', true],
    ['/favicon.ico', false],
    ['/logo.svg', false],
    ['//cdn.other.com/a.png', false],
    ['https://img.example.com/a.png', true],
    ['https://img.example.com:443/a.png', true],
    ['https://img.example.com:8443/a.png', false],
    ['https://cdn.example.com/a.png', true],
    ['https://img.example.com/logo.SVG?v=1', false],
    ['https://img.example.com/favicon.ico#v2', false],
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

  it('支持显式传入白名单与运行时全局快照覆盖/重置', () => {
    expect(shouldOptimize('https://r2.example.org/a.png')).toBe(false)
    expect(shouldOptimize('https://r2.example.org/a.png', ['r2.example.org'])).toBe(true)

    setRuntimeImageOptimizeHosts(['r2.example.org'])
    expect(getImageOptimizeHosts()).toEqual(['r2.example.org'])
    expect(shouldOptimize('https://r2.example.org/a.png')).toBe(true)
    expect(shouldOptimize('https://img.example.com/a.png')).toBe(false)

    setRuntimeImageOptimizeHosts(null)
    expect(getImageOptimizeHosts()).toEqual(['img.example.com', 'cdn.example.com'])
    expect(shouldOptimize('https://r2.example.org/a.png')).toBe(false)
    expect(shouldOptimize('https://img.example.com/a.png')).toBe(true)
  })
})

describe('getServerImageOptimizeHosts', () => {
  it('运行时 IMAGE_OPTIMIZE_HOSTS 优先于构建期配置', () => {
    process.env.IMAGE_OPTIMIZE_HOSTS = 'https://sfkm-blog.r2.liteyuki.org/, extra.cdn.net'
    expect(getServerImageOptimizeHosts()).toEqual(['sfkm-blog.r2.liteyuki.org', 'extra.cdn.net'])
  })

  it('显式设置空串时清空白名单而不回退构建期默认值', () => {
    process.env.IMAGE_OPTIMIZE_HOSTS = ''
    expect(getServerImageOptimizeHosts()).toEqual([])
  })

  it('运行时变量均未设置时回退到构建期默认值', () => {
    delete process.env.IMAGE_OPTIMIZE_HOSTS
    delete process.env.NEXT_PUBLIC_IMAGE_OPTIMIZE_HOSTS
    expect(getServerImageOptimizeHosts()).toEqual(['img.example.com', 'cdn.example.com'])
  })
})

describe('formatMusicCoverUrl', () => {
  it('对网易云链接自动添加 param 参数并升级 https', () => {
    expect(formatMusicCoverUrl('http://p1.music.126.net/abc.jpg', 300)).toBe('https://p1.music.126.net/abc.jpg?imageView=1&thumbnail=300y300&type=webp')
    expect(formatMusicCoverUrl('https://p2.music.126.net/xyz.jpg?param=100y100', 80)).toBe('https://p2.music.126.net/xyz.jpg?imageView=1&thumbnail=80y80&type=webp')
  })

  it('非网易云链接保持原样', () => {
    expect(formatMusicCoverUrl('https://example.com/cover.jpg', 300)).toBe('https://example.com/cover.jpg')
    expect(formatMusicCoverUrl('')).toBe('')
    expect(formatMusicCoverUrl(null)).toBe('')
  })
})

describe('defaultAvatarQuality', () => {
  it('按头像显示宽度映射到 45 / 60 / 75 三档压缩质量', () => {
    expect(IMAGE_QUALITIES).toEqual([45, 60, 75])
    expect(defaultAvatarQuality('24px')).toBe(45)
    expect(defaultAvatarQuality('48px')).toBe(45)
    expect(defaultAvatarQuality('64px')).toBe(45)
    expect(defaultAvatarQuality('80px')).toBe(60)
    expect(defaultAvatarQuality('120px')).toBe(60)
    expect(defaultAvatarQuality('128px')).toBe(75)
    expect(defaultAvatarQuality('(max-width: 1024px) 192px, 280px')).toBe(75)
  })
})
