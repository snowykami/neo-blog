'use client'

import { getOidcAuthorizeUrl } from '@/api/user'
import { loginPath } from '@/hooks/use-route'

/** 小窗登录完成（成功或取消）后由 /auth/oidc-callback 在关窗前发给本页 */
export const OIDC_POPUP_MESSAGE = 'neo-blog:oidc-login-done'

/** 小窗登录完成后的去向：后端只允许站内路径，所以统一回到这个页面再关窗通知本页 */
export const OIDC_POPUP_CALLBACK_PATH = '/auth/oidc-callback'

export interface OidcPopupResult {
  // 已登录（后端在小窗里写好了 Cookie）
  ok: boolean
  // 小窗被拦截，调用方应退回到整页跳转
  blocked?: boolean
  // 身份提供商回调失败的错误码（后端跳回登录页时带上）
  error?: string
}

// 后端 state 校验失败等情况会带着错误码回到登录页，而不是我们的回调页
const pollIntervalMs = 400

/**
 * 回调页调用：小窗打开时通知发起页面（它据此重新拉取登录状态），返回是否是小窗打开。
 * 不是小窗时返回 false，调用方按普通跳转处理
 */
export function notifyOidcPopupDone(): boolean {
  const opener = window.opener as Window | null
  if (!opener || opener.closed)
    return false
  opener.postMessage({ type: OIDC_POPUP_MESSAGE }, window.location.origin)
  return true
}

/**
 * 在小窗里完成第三方登录：与整页跳转拿到的是同一份 Cookie，完成后关窗并用 postMessage 通知本页，
 * 本页不用离开（也要重新拉一次登录状态）。用户中途关窗时 resolve 为 ok=false。
 */
export function openOidcPopup({ name, bind = false }: { name: string, bind?: boolean }): Promise<OidcPopupResult> {
  const url = getOidcAuthorizeUrl({ name, redirectBack: OIDC_POPUP_CALLBACK_PATH, bind })
  // 必须在点击回调里同步打开，否则会被浏览器拦截
  const popup = window.open(url, 'neo-blog-oidc', 'popup=yes,width=520,height=680')
  if (!popup)
    return Promise.resolve({ ok: false, blocked: true })

  return new Promise((resolve) => {
    let timer: number | null = null
    let settled = false
    // 先声明、后赋值：cleanup 与 onMessage 互相引用
    let onMessage: (event: MessageEvent) => void

    const cleanup = () => {
      settled = true
      window.removeEventListener('message', onMessage)
      if (timer != null)
        window.clearInterval(timer)
    }
    const finish = (result: OidcPopupResult) => {
      if (settled)
        return
      cleanup()
      resolve(result)
    }
    onMessage = (event: MessageEvent) => {
      // 只认同源、同一个窗口发来的通知
      if (event.origin !== window.location.origin || event.source !== popup)
        return
      if ((event.data as { type?: string } | null)?.type !== OIDC_POPUP_MESSAGE)
        return
      finish({ ok: true })
    }

    window.addEventListener('message', onMessage)
    timer = window.setInterval(() => {
      if (popup.closed) {
        finish({ ok: false })
        return
      }
      // 小窗被导航到身份提供商时读不到地址（跨域），回到本站后才能读到
      try {
        const { pathname, searchParams } = new URL(popup.location.href)
        const error = pathname === loginPath ? searchParams.get('oidc_error') : null
        if (error) {
          popup.close()
          finish({ ok: false, error })
        }
      }
      catch {}
    }, pollIntervalMs)
  })
}
