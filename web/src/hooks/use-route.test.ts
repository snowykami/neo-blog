import { describe, expect, it } from 'vitest'
import { readRedirectBack } from './use-route'

function paramsOf(raw: string): URLSearchParams {
  return new URLSearchParams(raw)
}

describe('readRedirectBack', () => {
  it('完整保留 OAuth 授权页的查询参数并剥离外层语言前缀', () => {
    const oauthTarget = '/oauth/authorize?client_id=nbclient_1&redirect_uri=http%3A%2F%2F127.0.0.1%3A8787%2Fcb&code_challenge=abc&state=xyz'
    expect(readRedirectBack(paramsOf(`redirect_back=${encodeURIComponent(oauthTarget)}`))).toBe(oauthTarget)
    expect(readRedirectBack(paramsOf(`redirect_back=${encodeURIComponent(`/en${oauthTarget}`)}`))).toBe(oauthTarget)
  })

  it('拦截外部绝对地址、协议相对地址与反斜杠绕过，统一回退到首页', () => {
    for (const malicious of [
      'https://evil.example.com/phish',
      '//evil.example.com/phish',
      '/\\evil.example.com',
      '/oauth/authorize\r\nSet-Cookie: evil=1',
      'javascript:alert(1)',
    ]) {
      expect(readRedirectBack(paramsOf(`redirect_back=${encodeURIComponent(malicious)}`)), malicious).toBe('/')
    }
  })
})
