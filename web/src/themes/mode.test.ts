import { beforeEach, describe, expect, it } from 'vitest'
import { themeAttributes } from './apply'
import { BUILTIN_THEMES } from './index'
import {
  clearModeOverride,
  MODE_OVERRIDE_STORAGE_KEY,
  readBoundThemeMode,
  readEffectiveMode,
  readModeOverride,
  readUserModePreference,
  resolveColorMode,
  resolveModePreference,
  THEME_PACK_EVENT,
  USER_MODE_STORAGE_KEY,
  writeModeOverride,
  writeUserModePreference,
} from './mode'

function setBound(id: string, mode?: 'light' | 'dark') {
  document.documentElement.setAttribute('data-theme', id)
  if (mode)
    document.documentElement.setAttribute('data-theme-mode', mode)
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-theme-mode')
})

describe('resolveModePreference / resolveColorMode', () => {
  it('没有节日绑定时完全按用户偏好（含跟随系统）', () => {
    expect(resolveModePreference({ boundMode: null, override: null, userMode: 'light' })).toBe('light')
    expect(resolveModePreference({ boundMode: null, override: null, userMode: 'dark' })).toBe('dark')
    expect(resolveModePreference({ boundMode: null, override: null, userMode: 'system' })).toBe('system')
    // 跟随系统再按系统解析成实际明暗
    expect(resolveColorMode('system', true)).toBe('dark')
    expect(resolveColorMode('system', false)).toBe('light')
  })

  it('节日绑定的明暗优先于用户偏好', () => {
    expect(resolveModePreference({ boundMode: 'dark', override: null, userMode: 'light' })).toBe('dark')
    expect(resolveModePreference({ boundMode: 'light', override: null, userMode: 'dark' })).toBe('light')
    expect(resolveModePreference({ boundMode: 'dark', override: null, userMode: 'system' })).toBe('dark')
  })

  it('用户在节日期间手动改过，就按用户的来', () => {
    expect(resolveModePreference({ boundMode: 'dark', override: 'light', userMode: 'dark' })).toBe('light')
  })

  it('用户手动选了「跟随系统」也照样生效，不被节日默认盖住', () => {
    expect(resolveModePreference({ boundMode: 'dark', override: 'system', userMode: 'light' })).toBe('system')
    expect(resolveColorMode('system', false)).toBe('light')
  })
})

describe('绑定明暗的读取', () => {
  it('从 html 上读 data-theme / data-theme-mode', () => {
    setBound('halloween', 'dark')
    expect(readBoundThemeMode()).toEqual({ id: 'halloween', mode: 'dark' })
  })

  it('没有主题或没有绑定明暗时返回 null', () => {
    setBound('christmas')
    expect(readBoundThemeMode()).toBeNull()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.setAttribute('data-theme-mode', 'dark')
    expect(readBoundThemeMode()).toBeNull()
  })
})

describe('手动覆盖的作用域', () => {
  it('只在同一个节日内有效', () => {
    writeModeOverride('halloween', 'light')
    expect(readModeOverride('halloween')).toBe('light')
    // 换成别的节日：旧覆盖失效并被清理
    expect(readModeOverride('christmas')).toBeNull()
    expect(localStorage.getItem(MODE_OVERRIDE_STORAGE_KEY)).toBeNull()
  })

  it('结构损坏时不炸、直接清理', () => {
    localStorage.setItem(MODE_OVERRIDE_STORAGE_KEY, '{not json')
    expect(readModeOverride('halloween')).toBeNull()
    expect(localStorage.getItem(MODE_OVERRIDE_STORAGE_KEY)).toBeNull()
  })

  it('clearModeOverride 清空', () => {
    writeModeOverride('halloween', 'dark')
    clearModeOverride()
    expect(readModeOverride('halloween')).toBeNull()
  })
})

describe('readEffectiveMode', () => {
  it('节日期间用节日默认，手动切换后用手动值，且不污染用户长期偏好', () => {
    writeUserModePreference('light')
    setBound('halloween', 'dark')

    const first = readEffectiveMode()
    expect(first.mode).toBe('dark')
    expect(first.overridden).toBe(false)
    expect(first.boundId).toBe('halloween')

    writeModeOverride('halloween', 'light')
    expect(readEffectiveMode().mode).toBe('light')
    expect(readEffectiveMode().overridden).toBe(true)
    // 用户长期偏好没被改
    expect(readUserModePreference()).toBe('light')
    expect(localStorage.getItem(USER_MODE_STORAGE_KEY)).toBe('light')
  })

  it('节日期间手动选「跟随系统」也保留三态', () => {
    writeUserModePreference('light')
    setBound('halloween', 'dark')
    writeModeOverride('halloween', 'system')
    expect(readEffectiveMode().mode).toBe('system')
  })

  it('关掉节日主题（属性被摘除）后回到用户偏好，包括跟随系统', () => {
    writeUserModePreference('dark')
    setBound('halloween', 'light')
    expect(readEffectiveMode().mode).toBe('light')
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-theme-mode')
    expect(readEffectiveMode().mode).toBe('dark')

    writeUserModePreference('system')
    expect(readEffectiveMode().mode).toBe('system')
  })
})

describe('主题数据里的明暗绑定', () => {
  it('内置主题的 mode 取值合法，且写进 data-theme-mode', () => {
    for (const theme of BUILTIN_THEMES) {
      if (!theme.mode)
        continue
      expect(['light', 'dark']).toContain(theme.mode)
      expect(themeAttributes(theme)['data-theme-mode']).toBe(theme.mode)
    }
  })

  it('万圣节默认绑定夜晚', () => {
    const halloween = BUILTIN_THEMES.find(t => t.id === 'halloween')!
    expect(halloween.mode).toBe('dark')
  })

  it('事件名保持稳定（首帧脚本与 DeviceProvider 依赖它）', () => {
    expect(THEME_PACK_EVENT).toBe('theme-pack-change')
  })
})
