import { beforeEach, describe, expect, it } from 'vitest'
import { ANONYMOUS_STORAGE_KEY, hasLoggedInCookie, needsLoginUserFetch, rememberLoginState, shouldFetchLoginUser } from './session-hint'

function clearCookies() {
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0]?.trim()
    if (name)
      document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`
  }
}

beforeEach(() => {
  localStorage.clear()
  clearCookies()
})

describe('session hint', () => {
  it('detects the logged_in marker cookie by exact name', () => {
    expect(hasLoggedInCookie('logged_in=1')).toBe(true)
    expect(hasLoggedInCookie('a=b; logged_in=1; c=d')).toBe(true)
    expect(hasLoggedInCookie('')).toBe(false)
    expect(hasLoggedInCookie('not_logged_in=1; logged_inx=1')).toBe(false)
  })

  it('fetches /user/me with the marker, or once until the browser is known to be anonymous', () => {
    expect(shouldFetchLoginUser({ cookie: 'logged_in=1', knownAnonymous: true })).toBe(true)
    // 标记上线前登录的会话没有标记：还没确认过是访客时探测一次
    expect(shouldFetchLoginUser({ cookie: '', knownAnonymous: false })).toBe(true)
    expect(shouldFetchLoginUser({ cookie: 'theme=dark', knownAnonymous: true })).toBe(false)
  })

  it('remembers anonymous visitors and forgets it after login', () => {
    expect(needsLoginUserFetch()).toBe(true)
    rememberLoginState(false)
    expect(localStorage.getItem(ANONYMOUS_STORAGE_KEY)).toBe('1')
    expect(needsLoginUserFetch()).toBe(false)
    // 其他标签页 / 第三方登录跳转回来后后端写了标记：照常请求
    document.cookie = 'logged_in=1; path=/'
    expect(needsLoginUserFetch()).toBe(true)
    rememberLoginState(true)
    expect(localStorage.getItem(ANONYMOUS_STORAGE_KEY)).toBeNull()
  })

  it('drops a stale marker when the backend says the visitor is anonymous', () => {
    document.cookie = 'logged_in=1; path=/'
    rememberLoginState(false)
    expect(hasLoggedInCookie(document.cookie)).toBe(false)
    expect(needsLoginUserFetch()).toBe(false)
  })
})
