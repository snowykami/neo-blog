// @vitest-environment node
import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return {
    ...actual,
    connection: vi.fn(() => Promise.resolve()),
  }
})

describe('forwardWellKnownOAuth', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('转发受保护资源与授权服务器发现路径到后端，并拦截非 OAuth 路径', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      return new Response(JSON.stringify({ proxiedTo: String(input) }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      })
    })

    const { forwardWellKnownOAuth } = await import('./well-known-oauth')

    const res1 = await forwardWellKnownOAuth(
      new NextRequest(new URL('https://blog.sfkm.me/.well-known/oauth-protected-resource/api/v1/mcp')),
      { params: Promise.resolve({ path: ['oauth-protected-resource', 'api', 'v1', 'mcp'] }) },
    )
    expect(res1.status).toBe(200)
    expect(res1.headers.get('cache-control')).toBe('no-store')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(String(fetchSpy.mock.calls[0]?.[0])).toMatch(/\/\.well-known\/oauth-protected-resource\/api\/v1\/mcp$/)

    const res2 = await forwardWellKnownOAuth(
      new NextRequest(new URL('https://blog.sfkm.me/.well-known/oauth-authorization-server')),
      { params: Promise.resolve({ path: ['oauth-authorization-server'] }) },
    )
    expect(res2.status).toBe(200)
    expect(String(fetchSpy.mock.calls[1]?.[0])).toMatch(/\/\.well-known\/oauth-authorization-server$/)

    const blocked = await forwardWellKnownOAuth(
      new NextRequest(new URL('https://blog.sfkm.me/.well-known/security.txt')),
      { params: Promise.resolve({ path: ['security.txt'] }) },
    )
    expect(blocked.status).toBe(404)
  })
})
