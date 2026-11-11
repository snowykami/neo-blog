import type { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { backendRequestHeaders, backendResponse } from './backend-proxy'

function fakeRequest(headers: Record<string, string>) {
  return {
    headers: new Headers(headers),
    nextUrl: new URL('https://blog.example.com/api/v1/posts'),
  } as unknown as NextRequest
}

describe('backendRequestHeaders', () => {
  it('要求后端返回原文，不转发浏览器的 accept-encoding', () => {
    const headers = backendRequestHeaders(fakeRequest({ 'accept-encoding': 'gzip, deflate, br, zstd', 'host': 'blog.example.com' }))
    expect(headers.get('accept-encoding')).toBe('identity')
  })

  it('浏览器没带 accept-encoding 时也显式声明 identity', () => {
    expect(backendRequestHeaders(fakeRequest({})).get('accept-encoding')).toBe('identity')
  })

  it('去掉逐跳头并补上 X-Forwarded-*', () => {
    const headers = backendRequestHeaders(fakeRequest({ host: 'blog.example.com', connection: 'keep-alive', range: 'bytes=0-' }))
    expect(headers.has('connection')).toBe(false)
    expect(headers.has('host')).toBe(false)
    expect(headers.get('range')).toBe('bytes=0-')
    expect(headers.get('x-forwarded-host')).toBe('blog.example.com')
    expect(headers.get('x-forwarded-proto')).toBe('https')
  })
})

// 先发出一段数据、随后出错的上游响应体（模拟 SSE 中途断开）
function brokenStream() {
  let sent = false
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent) {
        controller.error(new Error('terminated'))
        return
      }
      sent = true
      controller.enqueue(new TextEncoder().encode('data: hi\n\n'))
    },
  })
}

describe('backendResponse', () => {
  it('事件流上游断开时正常结束，已收到的数据照常交给浏览器', async () => {
    const res = backendResponse(new Response(brokenStream(), { headers: { 'content-type': 'text/event-stream' } }))
    expect(await res.text()).toBe('data: hi\n\n')
  })

  it('其他响应的上游错误照常抛出', async () => {
    const res = backendResponse(new Response(brokenStream(), { headers: { 'content-type': 'application/octet-stream' } }))
    await expect(res.text()).rejects.toThrow()
  })

  it('去掉编码相关的响应头', () => {
    const res = backendResponse(new Response('x', { headers: { 'content-encoding': 'gzip', 'content-length': '1', 'x-a': '1' } }))
    expect(res.headers.has('content-encoding')).toBe(false)
    expect(res.headers.has('content-length')).toBe(false)
    expect(res.headers.get('x-a')).toBe('1')
  })
})
