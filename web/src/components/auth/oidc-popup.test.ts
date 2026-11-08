import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { notifyOidcPopupDone, OIDC_POPUP_MESSAGE, openOidcPopup } from './oidc-popup'

// 小窗对象只用到 closed 与 location.href，其余不重要
function fakePopup(href = 'http://localhost:3000/auth/oidc-callback') {
  return { closed: false, location: { href } } as unknown as Window
}

// 把消息事件直接派发到本页，模拟回调页 postMessage
function dispatchMessage(source: unknown, data: unknown, origin = window.location.origin) {
  const event = new Event('message') as MessageEvent
  Object.assign(event, { origin, source, data })
  window.dispatchEvent(event)
}

describe('openOidcPopup', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('小窗被拦截时返回 blocked，调用方可以退回整页跳转', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    await expect(openOidcPopup({ name: 'github' })).resolves.toEqual({ ok: false, blocked: true })
  })

  it('小窗打开的是身份提供商的授权地址，redirect_back 用回调页', () => {
    const popup = fakePopup()
    const open = vi.spyOn(window, 'open').mockReturnValue(popup)
    openOidcPopup({ name: 'github' })
    const url = new URL(open.mock.calls[0][0] as string, window.location.origin)
    expect(url.pathname).toBe('/api/v1/user/oidc/authorize/github')
    expect(url.searchParams.get('redirect_back')).toBe('/auth/oidc-callback')
  })

  it('回调页 postMessage 后 resolve 为已登录', async () => {
    const popup = fakePopup()
    vi.spyOn(window, 'open').mockReturnValue(popup)
    const result = openOidcPopup({ name: 'github' })
    dispatchMessage(popup, { type: OIDC_POPUP_MESSAGE })
    await expect(result).resolves.toEqual({ ok: true })
  })

  it('忽略其他窗口、外站与其他类型的消息', async () => {
    const popup = fakePopup()
    vi.spyOn(window, 'open').mockReturnValue(popup)
    let done = false
    const result = openOidcPopup({ name: 'github' }).then((value) => {
      done = true
      return value
    })
    dispatchMessage({ other: true }, { type: OIDC_POPUP_MESSAGE })
    dispatchMessage(popup, { type: OIDC_POPUP_MESSAGE }, 'https://evil.example')
    dispatchMessage(popup, { type: 'other' })
    await Promise.resolve()
    expect(done).toBe(false)
    // 收尾：正常完成，避免 promise 悬空
    dispatchMessage(popup, { type: OIDC_POPUP_MESSAGE })
    await expect(result).resolves.toEqual({ ok: true })
  })

  it('用户关掉小窗时 resolve 为未登录', async () => {
    const popup = fakePopup()
    vi.spyOn(window, 'open').mockReturnValue(popup)
    const result = openOidcPopup({ name: 'github' })
    ;(popup as { closed: boolean }).closed = true
    vi.advanceTimersByTime(500)
    await expect(result).resolves.toEqual({ ok: false })
  })

  it('后端带着错误码回到登录页时关掉小窗并带回错误码', async () => {
    const popup = fakePopup('http://localhost:3000/auth/login?oidc_error=invalid_oidc_state')
    popup.close = vi.fn()
    vi.spyOn(window, 'open').mockReturnValue(popup)
    const result = openOidcPopup({ name: 'github' })
    vi.advanceTimersByTime(500)
    await expect(result).resolves.toEqual({ ok: false, error: 'invalid_oidc_state' })
    expect(popup.close).toHaveBeenCalled()
  })
})

describe('notifyOidcPopupDone', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(window, 'opener', { value: null, configurable: true })
  })

  it('不是小窗打开时返回 false', () => {
    Object.defineProperty(window, 'opener', { value: null, configurable: true })
    expect(notifyOidcPopupDone()).toBe(false)
  })

  it('小窗打开时通知发起页面并返回 true', () => {
    const postMessage = vi.fn()
    Object.defineProperty(window, 'opener', { value: { closed: false, postMessage }, configurable: true })
    expect(notifyOidcPopupDone()).toBe(true)
    expect(postMessage).toHaveBeenCalledWith({ type: OIDC_POPUP_MESSAGE }, window.location.origin)
  })

  it('小窗已经被关掉时返回 false', () => {
    const postMessage = vi.fn()
    Object.defineProperty(window, 'opener', { value: { closed: true, postMessage }, configurable: true })
    expect(notifyOidcPopupDone()).toBe(false)
    expect(postMessage).not.toHaveBeenCalled()
  })
})
