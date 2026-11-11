import { describe, expect, it } from 'vitest'
import { absoluteSiteUrl, absolutizeHtmlUrls } from './siteinfo'

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
