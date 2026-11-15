// @vitest-environment node
// 浏览器环境（happy-dom）的 Headers 会丢掉 Cookie 等受限请求头，这里用 Node 环境
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { proxy } from './proxy'

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(path, 'https://blog.example.com'), { headers })
}

const location = (res: Response) => res.headers.get('location')
const rewrite = (res: Response) => res.headers.get('x-middleware-rewrite')

describe('proxy 语言路由', () => {
  it('不带前缀的前台地址固定为简体中文，改写到内部路径，不按 Cookie 或 Accept-Language 跳转也不写 Cookie', () => {
    const plain = proxy(request('/p/hello'))
    expect(location(plain)).toBeNull()
    expect(rewrite(plain)).toBe('https://blog.example.com/zh-CN/p/hello')
    expect(plain.headers.get('set-cookie')).toBeNull()

    const withCookie = proxy(request('/p/hello?comment=3', { 'cookie': 'NEXT_LOCALE=ja', 'sec-fetch-dest': 'document' }))
    expect(location(withCookie)).toBeNull()
    expect(rewrite(withCookie)).toBe('https://blog.example.com/zh-CN/p/hello?comment=3')
    expect(withCookie.headers.get('set-cookie')).toBeNull()

    const withHeader = proxy(request('/', { 'accept-language': 'zh-TW,en-US;q=0.9', 'sec-fetch-dest': 'document' }))
    expect(location(withHeader)).toBeNull()
    expect(rewrite(withHeader)).toBe('https://blog.example.com/zh-CN')
    expect(withHeader.headers.get('set-cookie')).toBeNull()
  })

  it('带前缀的地址按地址语言处理，不按偏好跳转', () => {
    const enPrefixed = proxy(request('/en/p/hello', { 'cookie': 'NEXT_LOCALE=ja', 'accept-language': 'ko' }))
    expect(location(enPrefixed)).toBeNull()
    expect(rewrite(enPrefixed)).toBeNull()

    const twPrefixed = proxy(request('/zh-tw/p/hello', { 'cookie': 'NEXT_LOCALE=ja', 'accept-language': 'ko' }))
    expect(location(twPrefixed)).toBeNull()
    expect(rewrite(twPrefixed)).toBe('https://blog.example.com/zh-TW/p/hello')
  })

  it('前台整页文档可进 CDN 缓存；后台与客户端路由取数不进 CDN 缓存', () => {
    expect(proxy(request('/p/hello')).headers.get('cdn-cache-control')).toBeNull()
    expect(proxy(request('/p/hello', { 'sec-fetch-dest': 'document' })).headers.get('cdn-cache-control')).toBeNull()
    expect(proxy(request('/en/p/hello', { 'sec-fetch-dest': 'document' })).headers.get('cdn-cache-control')).toBeNull()
    expect(proxy(request('/p/hello', { 'sec-fetch-dest': 'empty' })).headers.get('cdn-cache-control')).toBeNull()
    expect(proxy(request('/p/hello?_rsc=abc', { 'rsc': '1', 'sec-fetch-dest': 'empty' })).headers.get('cdn-cache-control')).toBe('no-store')
    expect(proxy(request('/en/p/hello?_rsc=abc', { 'rsc': '1', 'sec-fetch-dest': 'empty' })).headers.get('cdn-cache-control')).toBe('no-store')
    expect(proxy(request('/console')).headers.get('cdn-cache-control')).toBe('no-store')
    expect(proxy(request('/console?_rsc=abc', { 'rsc': '1', 'sec-fetch-dest': 'empty' })).headers.get('cdn-cache-control')).toBe('no-store')
  })

  it('小写前缀改写到注册表里的语言代码，多余的默认语言前缀跳回规范地址', () => {
    expect(rewrite(proxy(request('/zh-tw/p/hello')))).toBe('https://blog.example.com/zh-TW/p/hello')
    expect(location(proxy(request('/zh-cn/p/hello')))).toBe('https://blog.example.com/p/hello')
  })

  it('后台不带语言前缀，按偏好改写；带了前缀的后台地址跳回不带前缀的地址', () => {
    expect(rewrite(proxy(request('/console/posts', { cookie: 'NEXT_LOCALE=ko' })))).toBe('https://blog.example.com/ko/console/posts')
    expect(rewrite(proxy(request('/console', { 'accept-language': 'en-US,en;q=0.9' })))).toBe('https://blog.example.com/en/console')
    expect(rewrite(proxy(request('/console')))).toBe('https://blog.example.com/zh-CN/console')
    expect(location(proxy(request('/en/console/posts')))).toBe('https://blog.example.com/console/posts')
  })
})
