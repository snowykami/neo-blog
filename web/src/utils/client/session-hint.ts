/**
 * 浏览器端判断「要不要请求 /user/me」。
 *
 * 页面外壳对所有人一致，服务端不再读登录 Cookie、不再查当前用户，登录状态由浏览器自己取。
 * 登录凭据（token / refresh_token）是 HttpOnly 的，脚本读不到，所以后端登录时另写一个不含凭据的标记 Cookie
 * `logged_in`（与刷新令牌同时到期，登出时清掉，见后端 ctxutils.Set2Tokens）：
 *   - 有标记：可能已登录，请求 /user/me
 *   - 没有标记：大概率是访客，不请求，避免每个访客每次打开页面都收到一个 401
 * 标记上线之前登录的会话没有标记：本浏览器还没确认过是访客时探测一次，401 后记下来，之后不再探测；
 * 这类会话在访问令牌下次续期时（几分钟内）就会补上标记。
 */

export const LOGGED_IN_COOKIE = 'logged_in'

/** localStorage：本浏览器已确认是访客（值为 '1'） */
export const ANONYMOUS_STORAGE_KEY = 'auth-anonymous'

export function hasLoggedInCookie(cookie: string): boolean {
  return cookie.split(';').some(part => part.trim().startsWith(`${LOGGED_IN_COOKIE}=`))
}

/** 是否需要请求 /user/me；cookie 与 knownAnonymous 由调用方读好传入，便于单测 */
export function shouldFetchLoginUser({ cookie, knownAnonymous }: { cookie: string, knownAnonymous: boolean }): boolean {
  return hasLoggedInCookie(cookie) || !knownAnonymous
}

function readKnownAnonymous(): boolean {
  try {
    return localStorage.getItem(ANONYMOUS_STORAGE_KEY) === '1'
  }
  catch {
    return false
  }
}

/** 当前浏览器是否需要请求 /user/me（仅在浏览器里调用） */
export function needsLoginUserFetch(): boolean {
  return shouldFetchLoginUser({ cookie: document.cookie, knownAnonymous: readKnownAnonymous() })
}

/**
 * 记录登录状态：已登录时清掉访客记录；确认是访客时记下来，并删掉可能残留的标记（凭据已失效但标记还在）
 */
export function rememberLoginState(loggedIn: boolean) {
  try {
    if (loggedIn) {
      localStorage.removeItem(ANONYMOUS_STORAGE_KEY)
      return
    }
    localStorage.setItem(ANONYMOUS_STORAGE_KEY, '1')
  }
  catch {
    // 隐私模式等场景写入失败时忽略，只影响下次是否多探测一次
  }
  if (hasLoggedInCookie(document.cookie))
    document.cookie = `${LOGGED_IN_COOKIE}=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; samesite=lax`
}
