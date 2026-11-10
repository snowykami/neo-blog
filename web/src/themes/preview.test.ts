import { beforeEach, describe, expect, it } from 'vitest'
import { Role } from '@/models/user'
import { BUILTIN_THEMES } from './index'
import {
  canPreviewTheme,
  isPreviewableThemeId,
  isPreviewNever,
  readPreviewCookie,
  resolvePreviewThemeClient,
  THEME_PREVIEW_AUTO,
  THEME_PREVIEW_COOKIE,
  THEME_PREVIEW_NEVER,
  writePreviewCookie,
} from './preview'

function clearCookie() {
  document.cookie = `${THEME_PREVIEW_COOKIE}=; path=/; max-age=0`
}

beforeEach(clearCookie)

describe('节日主题预览 cookie', () => {
  it('写入后能读回来', () => {
    writePreviewCookie('mid-autumn')
    expect(readPreviewCookie()).toBe('mid-autumn')
  })

  it('传 null 表示恢复跟随日期', () => {
    writePreviewCookie('christmas')
    writePreviewCookie(null)
    expect(readPreviewCookie()).toBe(THEME_PREVIEW_AUTO)
  })

  it('非法 id 不会被写入，读到的也是自动', () => {
    writePreviewCookie('not-a-theme')
    expect(readPreviewCookie()).toBe(THEME_PREVIEW_AUTO)
    expect(isPreviewableThemeId('not-a-theme')).toBe(false)
    expect(isPreviewableThemeId(THEME_PREVIEW_AUTO)).toBe(false)
  })

  it('「从不使用」会被保留，不会被当成非法值清掉', () => {
    writePreviewCookie(THEME_PREVIEW_NEVER)
    expect(readPreviewCookie()).toBe(THEME_PREVIEW_NEVER)
    expect(isPreviewNever(readPreviewCookie())).toBe(true)
    expect(isPreviewableThemeId(THEME_PREVIEW_NEVER)).toBe(false)
  })

  it('所有内置主题都可预览（后台下拉框不会出现空选项）', () => {
    for (const theme of BUILTIN_THEMES)
      expect(isPreviewableThemeId(theme.id), theme.id).toBe(true)
  })
})

const admin = { role: Role.ADMIN }

describe('按 cookie 解析实际生效的主题（客户端）', () => {
  it('未设置或自动时沿用布局按日期算出的主题', () => {
    const fallback = BUILTIN_THEMES[0]
    expect(resolvePreviewThemeClient(fallback, admin)).toEqual({ theme: fallback, override: false })
    writePreviewCookie(THEME_PREVIEW_AUTO)
    expect(resolvePreviewThemeClient(fallback, admin)).toEqual({ theme: fallback, override: false })
  })

  it('指定具体主题时用它覆盖', () => {
    const target = BUILTIN_THEMES.at(-1)!
    writePreviewCookie(target.id)
    expect(resolvePreviewThemeClient(BUILTIN_THEMES[0], admin)).toEqual({ theme: target, override: true })
  })

  it('「从不使用」时不套节日主题', () => {
    writePreviewCookie(THEME_PREVIEW_NEVER)
    expect(resolvePreviewThemeClient(BUILTIN_THEMES[0], admin)).toEqual({ theme: null, override: true })
  })
})

describe('预览只对管理员生效', () => {
  it('只有 admin 角色可以预览', () => {
    expect(canPreviewTheme(admin)).toBe(true)
    expect(canPreviewTheme({ role: Role.EDITOR })).toBe(false)
    expect(canPreviewTheme({ role: Role.USER })).toBe(false)
    expect(canPreviewTheme(null)).toBe(false)
    expect(canPreviewTheme(undefined)).toBe(false)
  })

  it('访客、普通用户手写了 cookie 也不会被应用', () => {
    const fallback = BUILTIN_THEMES[0]
    writePreviewCookie(BUILTIN_THEMES.at(-1)!.id)
    expect(resolvePreviewThemeClient(fallback, null)).toEqual({ theme: fallback, override: false })
    expect(resolvePreviewThemeClient(fallback, { role: Role.USER })).toEqual({ theme: fallback, override: false })
    writePreviewCookie(THEME_PREVIEW_NEVER)
    expect(resolvePreviewThemeClient(fallback, { role: Role.EDITOR })).toEqual({ theme: fallback, override: false })
    expect(resolvePreviewThemeClient(null)).toEqual({ theme: null, override: false })
  })
})
