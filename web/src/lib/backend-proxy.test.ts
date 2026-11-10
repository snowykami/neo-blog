import type { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { backendRequestHeaders } from './backend-proxy'

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
