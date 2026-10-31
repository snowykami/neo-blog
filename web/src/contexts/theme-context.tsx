'use client'

import type { SVGProps } from 'react'
import type { ThemeDefinition, ThemeIconSlot } from '@/themes/types'
import { EyeIcon, HeartIcon, MessageCircleIcon, PinIcon, Share2Icon } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { applyThemeToDocument } from '@/themes/apply'
import { getThemeIcon } from '@/themes/icons'
import { clearModeOverride, THEME_PACK_EVENT } from '@/themes/mode'

/**
 * 主题包的客户端状态。
 *
 * 首屏由布局服务端按日期算好并通过 <html data-theme> 渲染，用户关闭主题的偏好只存在本地，
 * 服务端读不到：因此首帧后由 themeInitScript 先摘掉属性（避免闪一下），这里再把状态对齐，
 * 让顶栏的开关与页面显示保持一致。
 */

/** 本地偏好键：值为 'off' 表示用户关闭了自动主题；不写入表示跟随 */
export const THEME_PACK_STORAGE_KEY = 'theme-pack'

const DISABLED_VALUE = 'off'

interface ThemeContextValue {
  /** 服务端按日期（或将来由用户自定义数据源）给定的主题 */
  theme: ThemeDefinition | null
  /** 当前是否生效（用户可关闭） */
  enabled: boolean
  setEnabled: (enabled: boolean) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: null,
  enabled: false,
  setEnabled: () => {},
})

function readStoredDisabled(): boolean {
  try {
    return localStorage.getItem(THEME_PACK_STORAGE_KEY) === DISABLED_VALUE
  }
  catch {
    return false
  }
}

function writeStoredDisabled(disabled: boolean) {
  try {
    if (disabled)
      localStorage.setItem(THEME_PACK_STORAGE_KEY, DISABLED_VALUE)
    else
      localStorage.removeItem(THEME_PACK_STORAGE_KEY)
  }
  catch {
    // 隐私模式等场景写入失败时忽略，仅影响下次访问是否自动开启
  }
}

export function ThemeProvider({
  theme,
  children,
}: {
  theme: ThemeDefinition | null
  children: React.ReactNode
}) {
  const [enabled, setEnabledState] = useState(Boolean(theme))

  // 挂载后按本地偏好对齐一次；服务端渲染阶段默认按「生效」输出
  useEffect(() => {
    const active = Boolean(theme) && !readStoredDisabled()
    setEnabledState(active)
    applyThemeToDocument(active ? theme : null)
    if (!active)
      clearModeOverride()
  }, [theme])

  const setEnabled = useCallback((next: boolean) => {
    const active = next && Boolean(theme)
    setEnabledState(active)
    applyThemeToDocument(active ? theme : null)
    writeStoredDisabled(!active)
    // 节日绑定的明暗由 DeviceProvider 落地：关掉主题时清掉手动覆盖、恢复用户自己的设置
    if (!active)
      clearModeOverride()
    window.dispatchEvent(new Event(THEME_PACK_EVENT))
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, enabled, setEnabled }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}

/** 当前主题为某个槽位指定的图标；未指定或已关闭时返回 undefined，由调用方回落默认图标 */
export function useThemeSlotIcon(slot: ThemeIconSlot) {
  const { theme, enabled } = useTheme()
  if (!enabled)
    return undefined
  return getThemeIcon(theme?.icons?.[slot])
}

/** 生成某个槽位的图标组件：主题生效时换成节日图形，否则用传入的默认图标 */
function createSlotIcon(slot: ThemeIconSlot, fallback: typeof HeartIcon) {
  return function SlotIcon(props: SVGProps<SVGSVGElement>) {
    const Icon = useThemeSlotIcon(slot) ?? fallback
    return <Icon aria-hidden {...props} />
  }
}

/**
 * 可被主题替换的图标入口。
 * 组件直接引用这些包装而不是具体的节日图形，因此新增主题时不需要改任何页面代码。
 */
export const LikeIcon = createSlotIcon('like', HeartIcon)
export const CommentIcon = createSlotIcon('comment', MessageCircleIcon)
export const ViewIcon = createSlotIcon('view', EyeIcon)
export const PinnedIcon = createSlotIcon('pin', PinIcon)
export const ShareIcon = createSlotIcon('share', Share2Icon)
