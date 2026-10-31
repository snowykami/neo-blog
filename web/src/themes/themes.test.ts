import { describe, expect, it } from 'vitest'
import { themeAttributes, themeCssVars } from './apply'
import { getThemeDecor, THEME_DECOR } from './decor'
import { getThemeIcon, THEME_ICONS } from './icons'
import { BUILTIN_THEMES } from './index'
import { parseThemeDefinition, THEME_ICON_NAMES, THEME_ICON_SLOTS } from './types'

describe('内置主题数据', () => {
  it('图标槽位与装饰数据都指向真实存在的图元', () => {
    for (const theme of BUILTIN_THEMES) {
      for (const [slot, name] of Object.entries(theme.icons ?? {})) {
        expect(THEME_ICON_SLOTS).toContain(slot)
        expect(THEME_ICON_NAMES).toContain(name)
        expect(getThemeIcon(name), `${theme.id} 的 ${slot} 图标`).toBeTruthy()
      }
      for (const item of [...(theme.decorLeft ?? []), ...(theme.decorRight ?? [])]) {
        expect(getThemeDecor(item.glyph), `${theme.id} 的 ${item.glyph} 装饰`).toBeTruthy()
        expect(item.size).toBeGreaterThanOrEqual(16)
        expect(item.size).toBeLessThanOrEqual(240)
        expect(item.x).toBeGreaterThanOrEqual(-20)
        expect(item.y).toBeGreaterThanOrEqual(-20)
      }
    }
  })

  it('每个主题都至少换了点赞图标', () => {
    for (const theme of BUILTIN_THEMES)
      expect(theme.icons?.like, theme.id).toBeTruthy()
  })

  it('id 唯一', () => {
    const ids = BUILTIN_THEMES.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('装饰图元表与类型定义一致', () => {
    expect(Object.keys(THEME_DECOR).length).toBeGreaterThan(10)
    expect(Object.keys(THEME_ICONS).length).toBe(THEME_ICON_NAMES.length)
  })
})

describe('themeCssVars / themeAttributes', () => {
  const theme = BUILTIN_THEMES.find(t => t.id === 'halloween')!

  it('把色板映射成 --theme-* 变量', () => {
    const vars = themeCssVars(theme)
    expect(vars['--theme-hue']).toBe('45')
    expect(vars['--theme-overlay-light']).toContain('gradient')
  })

  it('有动效时输出与效应相关的属性', () => {
    expect(themeAttributes(theme)).toEqual({ 'data-theme': 'halloween', 'data-theme-effect': 'flicker', 'data-theme-mode': 'dark' })
    expect(themeAttributes(null)).toEqual({})
    expect(themeCssVars(null)).toEqual({})
  })
})

describe('parseThemeDefinition', () => {
  it('接受带图标与装饰的合法主题', () => {
    const parsed = parseThemeDefinition({
      id: 'my-theme',
      tokens: { hue: 200 },
      icons: { like: 'sakura', comment: 'star' },
      decorLeft: [{ glyph: 'moon', size: 96, x: 50, y: 20, rotate: -6, opacity: 0.8, flip: true }],
    })
    expect(parsed?.icons?.like).toBe('sakura')
    expect(parsed?.decorLeft?.[0].glyph).toBe('moon')
  })

  it('拒绝非法图元名与越界数值', () => {
    expect(parseThemeDefinition({ id: 'x', tokens: { hue: 200 }, icons: { like: 'not-a-glyph' } })).toBeNull()
    expect(parseThemeDefinition({ id: 'x', tokens: { hue: 200 }, decorLeft: [{ glyph: 'nope', size: 96, x: 50, y: 20 }] })).toBeNull()
    expect(parseThemeDefinition({ id: 'x', tokens: { hue: 200 }, decorLeft: [{ glyph: 'moon', size: 999, x: 50, y: 20 }] })).toBeNull()
    expect(parseThemeDefinition({ id: 'Bad Id', tokens: { hue: 200 } })).toBeNull()
  })
})
