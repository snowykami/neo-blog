/**
 * 配色方案（html 的 data-user-color）的本地存储与选择规则。
 *
 * 服务端只输出站点默认配色（页面对所有人一致）；访客 / 用户选的配色存在 localStorage，
 * 由 themeInitScript 在首帧前换上（不闪）。登录后以账号偏好为准，并写回 localStorage，
 * 这样同一浏览器下次打开时首帧就是账号的配色（见 components/common/user-preference-sync.tsx）。
 */

/** localStorage 键；themeInitScript 里内联了同一个字符串 */
export const COLOR_SCHEME_STORAGE_KEY = 'color-scheme'

/**
 * 当前该用哪个配色：账号偏好（登录后）> 本地保存 > 站点默认；不在可选列表里的值跳过（后台可能删掉了某个配色）
 */
export function pickColorScheme({
  account,
  stored,
  fallback,
  allowed,
}: {
  account?: string | null
  stored?: string | null
  fallback: string
  allowed: readonly string[]
}): string | undefined {
  return [account, stored, fallback].find((item): item is string => !!item && allowed.includes(item))
}

export function applyColorScheme(scheme: string) {
  if (typeof document !== 'undefined')
    document.documentElement.setAttribute('data-user-color', scheme)
}

export function readStoredColorScheme(): string | null {
  try {
    return localStorage.getItem(COLOR_SCHEME_STORAGE_KEY)
  }
  catch {
    return null
  }
}

export function writeStoredColorScheme(scheme: string) {
  try {
    localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, scheme)
  }
  catch {
    // 隐私模式等场景写入失败时忽略，仅影响下次访问的首帧配色
  }
}
