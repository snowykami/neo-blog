/**
 * 登录用户在账号里设置的界面语言，记在本浏览器的 Cookie 里，服务端按它选语言（见 i18n/request.ts）。
 *
 * 服务端渲染不再查当前用户：以前按账号设置选语言要先请求 /user/me，现在由浏览器取到用户后写进这个 Cookie
 * （见 components/common/user-preference-sync.tsx，个人资料保存语言时也会写）。
 * 名字沿用 next-intl 的默认 Cookie 名：阶段二把语言放进 URL 后，首次访问按偏好跳转时继续用它。
 */
export const LOCALE_COOKIE = 'NEXT_LOCALE'

const ONE_YEAR_SECONDS = 365 * 24 * 3600

/** 浏览器里写入语言 Cookie */
export function writeLocaleCookie(locale: string) {
  document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(locale)}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`
}

/** 从 document.cookie 读出语言 Cookie 的原始值 */
export function readLocaleCookie(cookie: string): string {
  const raw = cookie.split(';').map(part => part.trim()).find(part => part.startsWith(`${LOCALE_COOKIE}=`))
  if (!raw)
    return ''
  try {
    return decodeURIComponent(raw.slice(LOCALE_COOKIE.length + 1))
  }
  catch {
    return ''
  }
}
