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
  it('没有偏好时不带前缀的地址就是简体中文，改写到内部路径，不跳转、不写 Cookie', () => {
    const res = proxy(request('/p/hello'))
    expect(location(res)).toBeNull()
    expect(rewrite(res)).toBe('https://blog.example.com/zh-CN/p/hello')
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('浏览器打开页面且偏好别的语言时临时跳转，跳转不进共享缓存', () => {
    const byCookie = proxy(request('/p/hello?comment=3', { 'cookie': 'NEXT_LOCALE=ja', 'sec-fetch-dest': 'document' }))
    expect(byCookie.status).toBe(307)
    expect(location(byCookie)).toBe('https://blog.example.com/ja/p/hello?comment=3')
    expect(byCookie.headers.get('cache-control')).toContain('no-store')

    const byHeader = proxy(request('/', { 'accept-language': 'zh-TW,zh;q=0.9' }))
    expect(location(byHeader)).toBe('https://blog.example.com/zh-tw')
  })

  it('偏好默认语言、客户端路由取数与带前缀的地址都不跳转', () => {
    expect(location(proxy(request('/a', { 'cookie': 'NEXT_LOCALE=zh-CN', 'accept-language': 'en' })))).toBeNull()
    expect(location(proxy(request('/a', { 'accept-language': 'en', 'sec-fetch-dest': 'empty' })))).toBeNull()
    const prefixed = proxy(request('/en/p/hello', { cookie: 'NEXT_LOCALE=ja' }))
    expect(location(prefixed)).toBeNull()
  })

  it('不带前缀的页面因人而异（可能跳转），不让 CDN 存下来；带前缀的地址与客户端路由取数照常缓存', () => {
    expect(proxy(request('/p/hello')).headers.get('cdn-cache-control')).toBe('no-store')
    expect(proxy(request('/p/hello', { 'sec-fetch-dest': 'document' })).headers.get('cdn-cache-control')).toBe('no-store')
    expect(proxy(request('/en/p/hello', { 'sec-fetch-dest': 'document' })).headers.get('cdn-cache-control')).toBeNull()
    expect(proxy(request('/p/hello', { 'sec-fetch-dest': 'empty' })).headers.get('cdn-cache-control')).toBeNull()
  })

  it('小写前缀改写到注册表里的语言代码，多余的默认语言前缀跳回规范地址', () => {
    expect(rewrite(proxy(request('/zh-tw/p/hello')))).toBe('https://blog.example.com/zh-TW/p/hello')
    expect(location(proxy(request('/zh-cn/p/hello')))).toBe('https://blog.example.com/p/hello')
  })

  it('后台不带语言前缀，按偏好改写；带了前缀的后台地址跳回不带前缀的地址', () => {
    expect(rewrite(proxy(request('/console/posts', { cookie: 'NEXT_LOCALE=ko' })))).toBe('https://blog.example.com/ko/console/posts')
    expect(rewrite(proxy(request('/console')))).toBe('https://blog.example.com/zh-CN/console')
    expect(location(proxy(request('/en/console/posts')))).toBe('https://blog.example.com/console/posts')
  })
})
