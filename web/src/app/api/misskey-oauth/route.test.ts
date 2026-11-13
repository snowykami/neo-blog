import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

const { getSiteInfoMock, listOidcConfigsMock } = vi.hoisted(() => ({
  getSiteInfoMock: vi.fn(),
  listOidcConfigsMock: vi.fn(),
}))

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return {
    ...actual,
    connection: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock('@/api/misc', () => ({
  getSiteInfo: getSiteInfoMock,
}))

vi.mock('@/api/user', () => ({
  listOidcConfigs: listOidcConfigsMock,
}))

describe('misskey-oauth route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSiteInfoMock.mockResolvedValue({
      data: {
        baseUrl: 'https://blog.example.com/',
        metadata: { name: 'Alice\'s <Blog> & Notes' },
      },
    })
    listOidcConfigsMock.mockResolvedValue({ data: [] })
  })

  it('uses explicit ?name= parameter and escapes HTML entities in app name and URLs', async () => {
    const req = new NextRequest('https://blog.example.com/api/misskey-oauth?name=misskey_io')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('href="https://blog.example.com/api/v1/user/oidc/login/misskey_io"')
    expect(html).toContain('>Alice&#39;s &lt;Blog&gt; &amp; Notes</a>')
    expect(html).not.toContain('<Blog>')
  })

  it('supports ?provider= alias', async () => {
    const req = new NextRequest('https://blog.example.com/api/misskey-oauth?provider=fediverse-1')
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('/api/v1/user/oidc/login/fediverse-1"')
  })

  it('rejects invalid provider names with 400', async () => {
    for (const bad of ['', 'evil"><script>', '../admin', 'a'.repeat(65)]) {
      const req = new NextRequest(`https://blog.example.com/api/misskey-oauth?name=${encodeURIComponent(bad)}`)
      const res = await GET(req)
      expect(res.status).toBe(400)
    }
  })

  it('falls back to first enabled OIDC config when query param is omitted, then to liteyuki-lab', async () => {
    listOidcConfigsMock.mockResolvedValueOnce({
      data: [{ id: 1, name: 'custom-misskey', displayName: 'Custom', icon: '' }],
    })
    const res1 = await GET(new NextRequest('https://blog.example.com/api/misskey-oauth'))
    expect(res1.status).toBe(200)
    expect(await res1.text()).toContain('/api/v1/user/oidc/login/custom-misskey"')

    listOidcConfigsMock.mockRejectedValueOnce(new Error('offline'))
    getSiteInfoMock.mockResolvedValueOnce({ data: { baseUrl: 'https://blog.example.com', metadata: { name: '   ' } } })
    const res2 = await GET(new NextRequest('https://blog.example.com/api/misskey-oauth'))
    expect(res2.status).toBe(200)
    const html2 = await res2.text()
    expect(html2).toContain('/api/v1/user/oidc/login/liteyuki-lab"')
    expect(html2).toContain('>Neo Blog</a>')
  })
})
