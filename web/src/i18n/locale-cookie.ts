import { localizePath, splitLocalePrefix } from './routing'

/**
 * 本浏览器选定的界面语言，记在 Cookie 里。前台页面的语言只看地址（见 i18n/routing.ts），这个 Cookie 只用来：
 * - 打开不带语言前缀的前台地址时，proxy.ts 据此跳到对应语言的地址（首次访问的跳转）
 * - 后台（/console）不带语言前缀，proxy.ts 据此决定后台的界面语言
 *
 * 只由浏览器写：语言切换（switchLocale）、个人资料保存语言、登录后同步账号语言（components/common/user-preference-sync.tsx）。
 * 名字沿用 next-intl 的默认 Cookie 名
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

/**
 * 切换界面语言：记进语言 Cookie，再打开当前页面在目标语言下的地址（/p/x → /en/p/x）。
 * 语言在根布局所在的 [locale] 段里，换语言本来就是整页加载，直接整页跳转；
 * 后台地址不带语言前缀，跳转后由 proxy.ts 按新的 Cookie 选语言
 */
export function switchLocale(locale: string) {
  writeLocaleCookie(locale)
  const { pathname, search, hash } = window.location
  window.location.assign(localizePath(`${splitLocalePrefix(pathname).pathname}${search}${hash}`, locale))
}

/** 上次同步到本浏览器的账号语言（localStorage）：账号语言没变时，本浏览器自己选的语言优先 */
const SYNCED_ACCOUNT_LOCALE_KEY = 'synced_account_locale'

export function readSyncedAccountLocale(): string | null {
  try {
    return localStorage.getItem(SYNCED_ACCOUNT_LOCALE_KEY)
  }
  catch {
    return null
  }
}

export function writeSyncedAccountLocale(locale: string) {
  try {
    localStorage.setItem(SYNCED_ACCOUNT_LOCALE_KEY, locale)
  }
  catch {}
}
