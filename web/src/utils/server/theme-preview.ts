import type { User } from '@/models/user'
import type { ThemeDefinition } from '@/themes/types'
import { cookies } from 'next/headers'
import { Role } from '@/models/user'
import { BUILTIN_THEME_MAP } from '@/themes'
import { isPreviewableThemeId, isPreviewNever, THEME_PREVIEW_COOKIE } from '@/themes/preview'

/**
 * 后台的节日主题预览：管理员在控制台里强制指定主题（不管今天是不是这个节日），
 * 也可以选「从不使用」，表示完全不应用节日主题。
 *
 * 返回值里的 `override` 表示「cookie 已经拍板了」：
 * - override = false：没配预览，交给按日期的自动逻辑；
 * - override = true 且 theme = null：明确要求不应用主题；
 * - override = true 且 theme 有值：强制用这个主题。
 *
 * 保守授权：只有 admin 角色生效。cookie 在浏览器端，访客/普通用户即使手写也没用，
 * 因为这里在服务端按当前登录用户角色重新判了一次。
 */
export interface PreviewThemeResult {
  theme: ThemeDefinition | null
  override: boolean
}

const NO_PREVIEW: PreviewThemeResult = { theme: null, override: false }

export async function resolvePreviewTheme(user?: User | null): Promise<PreviewThemeResult> {
  if (user?.role !== Role.ADMIN)
    return NO_PREVIEW
  const value = (await cookies()).get(THEME_PREVIEW_COOKIE)?.value
  if (isPreviewNever(value))
    return { theme: null, override: true }
  if (!isPreviewableThemeId(value))
    return NO_PREVIEW
  const theme = BUILTIN_THEME_MAP.get(value) ?? null
  return theme ? { theme, override: true } : NO_PREVIEW
}
