import type { ColorMode } from './types'

/**
 * 节日主题的「临时明暗」逻辑。
 *
 * 目标：节日主题可以绑定一个默认明暗（例如万圣节绑夜晚），theme 生效期间优先于用户自己的
 * 亮/暗/跟随系统设置，但**只是默认值**：
 * - 用户手动切换仍然有效，选择记在 `theme-mode-override`，并按节日 id 限定作用域；
 * - 节日结束 / 换到另一个节日 / 关掉节日主题后，覆盖自动失效并被清理；
 * - 全程不覆盖 `localStorage.theme`，所以用户的长期偏好不会被悄悄改掉。
 *
 * 这些函数都是纯逻辑 + 受保护的存储访问，可同时用于首帧脚本（逻辑与 app/layout.tsx 内联脚本一致）、
 * DeviceProvider 与单元测试。
 */

/** 用户自己的明暗偏好（与 device-context 保持一致） */
export type ModePreference = ColorMode | 'system'

/** 用户明暗偏好的本地键，沿用既有实现 */
export const USER_MODE_STORAGE_KEY = 'theme'

/** 节日作用域内的手动明暗覆盖：{ id: '<theme-id>', mode: 'light' | 'dark' | 'system' } */
export const MODE_OVERRIDE_STORAGE_KEY = 'theme-mode-override'

/** 节日主题开关变化时派发的事件，DeviceProvider 监听后重新解析明暗 */
export const THEME_PACK_EVENT = 'theme-pack-change'

interface ModeOverride {
  id: string
  /** 用户在本次节日里手动选的偏好，三态都合法（含跟随系统） */
  mode: ModePreference
}

function isColorMode(value: unknown): value is ColorMode {
  return value === 'light' || value === 'dark'
}

function isModePreference(value: unknown): value is ModePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

function safeGet(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
  }
  catch {
    return null
  }
}

function safeSet(key: string, value: string) {
  try {
    localStorage?.setItem(key, value)
  }
  catch {
    // 隐私模式等场景写入失败时忽略：退化为「不记手动覆盖」，不影响功能
  }
}

function safeRemove(key: string) {
  try {
    localStorage?.removeItem(key)
  }
  catch {}
}

/** 用户自己的明暗偏好，缺省为跟随系统 */
export function readUserModePreference(): ModePreference {
  const stored = safeGet(USER_MODE_STORAGE_KEY)
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}

export function writeUserModePreference(mode: ModePreference) {
  if (mode === 'system')
    safeRemove(USER_MODE_STORAGE_KEY)
  else
    safeSet(USER_MODE_STORAGE_KEY, mode)
}

/** 读取当前节日作用域下的手动覆盖；id 不匹配（旧节日残留）时返回 null 并顺手清理 */
export function readModeOverride(themeId?: string | null): ModePreference | null {
  if (!themeId)
    return null
  const raw = safeGet(MODE_OVERRIDE_STORAGE_KEY)
  if (!raw)
    return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null) {
      const { id, mode } = parsed as Partial<ModeOverride>
      if (id === themeId && isModePreference(mode))
        return mode
    }
  }
  catch {}
  // 结构损坏或属于别的节日：清掉，避免下次误用
  safeRemove(MODE_OVERRIDE_STORAGE_KEY)
  return null
}

export function writeModeOverride(themeId: string, mode: ModePreference) {
  safeSet(MODE_OVERRIDE_STORAGE_KEY, JSON.stringify({ id: themeId, mode } satisfies ModeOverride))
}

export function clearModeOverride() {
  safeRemove(MODE_OVERRIDE_STORAGE_KEY)
}

/** 从 `<html>` 上读服务端渲染的节日绑定明暗；主题被关掉时属性已被移除，自然返回 null */
export function readBoundThemeMode(): { id: string, mode: ColorMode } | null {
  if (typeof document === 'undefined')
    return null
  const root = document.documentElement
  const id = root.getAttribute('data-theme')
  const mode = root.getAttribute('data-theme-mode')
  if (!id || !isColorMode(mode))
    return null
  return { id, mode }
}

/**
 * 解析当前该用哪一档明暗偏好（仍然是三态，可能返回 'system'）。
 *
 * 规则很简单：
 *   有节日绑定 → 用户本次节日手动选的覆盖 优先于 节日默认；
 *   没有节日绑定 → 完全按用户自己的偏好。
 * 返回的是「偏好」而不是「亮/暗」，'system' 交给 applyTheme / 首帧脚本按系统解析。
 */
export function resolveModePreference(input: {
  boundMode: ColorMode | null
  override: ModePreference | null
  userMode: ModePreference
}): ModePreference {
  if (input.boundMode)
    return input.override ?? input.boundMode
  return input.userMode
}

/** 偏好 → 实际是亮还是暗（'system' 时会看系统设置） */
export function resolveColorMode(mode: ModePreference, systemDark: boolean): ColorMode {
  if (mode === 'system')
    return systemDark ? 'dark' : 'light'
  return mode
}

/** 浏览器侧的便捷封装：按当前 DOM 与本地存储算出该用的偏好与实际明暗 */
export function readEffectiveMode(): {
  /** 当前生效的偏好，可能是 'system' */
  mode: ModePreference
  /** 实际渲染的明暗 */
  colorMode: ColorMode
  boundId: string | null
  boundMode: ColorMode | null
  /** 本次节日里用户是否手动改过 */
  overridden: boolean
} {
  const bound = readBoundThemeMode()
  const override = readModeOverride(bound?.id)
  const systemDark = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches
  const mode = resolveModePreference({
    boundMode: bound?.mode ?? null,
    override,
    userMode: readUserModePreference(),
  })
  return {
    mode,
    colorMode: resolveColorMode(mode, systemDark),
    boundId: bound?.id ?? null,
    boundMode: bound?.mode ?? null,
    overridden: override !== null,
  }
}
