import { describe, expect, it } from 'vitest'
import {
  absoluteSiteUrl,
  absolutizeHtmlUrls,
  DEFAULT_SITE_ICON_RADIUS,
  fallbackSiteInfo,
  getSiteFaviconUrl,
  getSiteMetadataIcons,
  isCommentEnabled,
  isInteractionEnabled,
  isLikeEnabled,
  normalizeSiteIconRadius,
} from './siteinfo'

describe('absoluteSiteUrl', () => {
  it('站内相对地址按站点地址补成绝对地址', () => {
    expect(absoluteSiteUrl('/api/v1/file/f/10', 'https://blog.example.com')).toBe('https://blog.example.com/api/v1/file/f/10')
    expect(absoluteSiteUrl('/api/v1/file/f/10/a%20b.webp', 'https://blog.example.com/')).toBe('https://blog.example.com/api/v1/file/f/10/a%20b.webp')
  })

  it('已是绝对地址、为空或站点地址无效时原样返回', () => {
    expect(absoluteSiteUrl('https://cdn.example.com/a.png', 'https://blog.example.com')).toBe('https://cdn.example.com/a.png')
    expect(absoluteSiteUrl('data:image/png;base64,AAAA', 'https://blog.example.com')).toBe('data:image/png;base64,AAAA')
    expect(absoluteSiteUrl('', 'https://blog.example.com')).toBe('')
    expect(absoluteSiteUrl(undefined, 'https://blog.example.com')).toBe('')
    expect(absoluteSiteUrl('/favicon.ico', '')).toBe('/favicon.ico')
  })
})

describe('absolutizeHtmlUrls', () => {
  it('正文里以 / 开头的 src / href / poster 补成绝对地址', () => {
    const html = '<p><img src="/api/v1/file/f/10" alt="a"><a href=\'/p/hello\'>x</a><video poster="/api/v1/file/f/11"></video></p>'
    expect(absolutizeHtmlUrls(html, 'https://blog.example.com')).toBe(
      '<p><img src="https://blog.example.com/api/v1/file/f/10" alt="a"><a href=\'https://blog.example.com/p/hello\'>x</a><video poster="https://blog.example.com/api/v1/file/f/11"></video></p>',
    )
  })

  it('绝对地址、协议相对地址、锚点与站点地址无效时不变', () => {
    const html = '<img src="https://cdn.example.com/a.png"><img src="//cdn.example.com/b.png"><a href="#top">t</a><p data-src="/x">/y</p>'
    expect(absolutizeHtmlUrls(html, 'https://blog.example.com')).toBe(html)
    expect(absolutizeHtmlUrls('<img src="/a.png">', '')).toBe('<img src="/a.png">')
  })
})

describe('interaction siteInfo switches', () => {
  it('defaults to enabled when interaction is missing or fallback is used', () => {
    expect(isCommentEnabled(fallbackSiteInfo)).toBe(true)
    expect(isLikeEnabled(fallbackSiteInfo)).toBe(true)
    expect(isInteractionEnabled(fallbackSiteInfo)).toBe(true)

    expect(isCommentEnabled(undefined)).toBe(true)
    expect(isLikeEnabled(null)).toBe(true)
    expect(isInteractionEnabled({})).toBe(true)
  })

  it('respects individual comment and like switches when master switch is on', () => {
    const onlyLikes = { interaction: { enabled: true, comment: false, like: true } }
    expect(isCommentEnabled(onlyLikes)).toBe(false)
    expect(isLikeEnabled(onlyLikes)).toBe(true)
    expect(isInteractionEnabled(onlyLikes)).toBe(true)

    const onlyComments = { interaction: { enabled: true, comment: true, like: false } }
    expect(isCommentEnabled(onlyComments)).toBe(true)
    expect(isLikeEnabled(onlyComments)).toBe(false)
    expect(isInteractionEnabled(onlyComments)).toBe(true)

    const bothOff = { interaction: { enabled: true, comment: false, like: false } }
    expect(isCommentEnabled(bothOff)).toBe(false)
    expect(isLikeEnabled(bothOff)).toBe(false)
    expect(isInteractionEnabled(bothOff)).toBe(false)
  })

  it('disables everything when master switch is false even if sub-switches are true', () => {
    const masterOff = { interaction: { enabled: false, comment: true, like: true } }
    expect(isCommentEnabled(masterOff)).toBe(false)
    expect(isLikeEnabled(masterOff)).toBe(false)
    expect(isInteractionEnabled(masterOff)).toBe(false)
  })
})

describe('site icon radius & favicon URL', () => {
  it('normalizes icon radius into 0..50 integer with default fallback', () => {
    expect(normalizeSiteIconRadius(undefined)).toBe(DEFAULT_SITE_ICON_RADIUS)
    expect(normalizeSiteIconRadius(null)).toBe(DEFAULT_SITE_ICON_RADIUS)
    expect(normalizeSiteIconRadius(Number.NaN)).toBe(DEFAULT_SITE_ICON_RADIUS)
    expect(normalizeSiteIconRadius(-5)).toBe(0)
    expect(normalizeSiteIconRadius(0)).toBe(0)
    expect(normalizeSiteIconRadius(24.6)).toBe(25)
    expect(normalizeSiteIconRadius(80)).toBe(50)
  })

  it('returns raw icon when radius is 0 and cached route URL when radius > 0', () => {
    expect(getSiteFaviconUrl({ metadata: { name: 'Blog', icon: '', description: '' } })).toBeUndefined()
    expect(getSiteFaviconUrl({ metadata: { name: 'Blog', icon: '/api/v1/file/f/1', iconRadius: 0, description: '' } })).toBe('/api/v1/file/f/1')

    const url22 = getSiteFaviconUrl({ metadata: { name: 'Blog', icon: '/api/v1/file/f/1', iconRadius: 22, description: '' } })
    const url50 = getSiteFaviconUrl({ metadata: { name: 'Blog', icon: '/api/v1/file/f/1', iconRadius: 50, description: '' } })
    const urlOtherIcon = getSiteFaviconUrl({ metadata: { name: 'Blog', icon: '/api/v1/file/f/2', iconRadius: 22, description: '' } })

    expect(url22).toMatch(/^\/api\/site-icon\?r=22&v=[0-9a-z]+$/)
    expect(url50).toMatch(/^\/api\/site-icon\?r=50&v=[0-9a-z]+$/)
    expect(url22).not.toBe(urlOtherIcon)

    expect(getSiteMetadataIcons({ metadata: { name: 'Blog', icon: '/api/v1/file/f/1', iconRadius: 22, description: '' } })).toEqual([
      { rel: 'icon', url: url22, type: 'image/png', sizes: '64x64' },
    ])
  })
})
