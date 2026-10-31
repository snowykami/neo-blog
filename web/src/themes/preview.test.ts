import { beforeEach, describe, expect, it } from 'vitest'
import { BUILTIN_THEMES } from './index'
import {
  isPreviewableThemeId,
  isPreviewNever,
  readPreviewCookie,
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
