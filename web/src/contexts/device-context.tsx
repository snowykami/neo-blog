'use client'

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import {
  clearModeOverride,
  readBoundThemeMode,
  readModeOverride,
  readUserModePreference,
  resolveModePreference,
  THEME_PACK_EVENT,
  writeModeOverride,
  writeUserModePreference,
} from '@/themes/mode'

type Mode = 'light' | 'dark' | 'system'

interface DeviceContextProps {
  isMobile: boolean
  mode: Mode
  isDark: boolean
  setMode: (mode: Mode) => void
  toggleMode: () => void
  viewport: {
    width: number
    height: number
  }
  navbarAdditionalClassName?: string // 可选属性，允许传入额外的类名
  setNavbarAdditionalClassName?: (className: string) => void // 可选方法，允许设置额外的类名
}

const DeviceContext = createContext<DeviceContextProps>({
  isMobile: false,
  mode: 'system',
  isDark: false,
  setMode: () => {},
  toggleMode: () => {},
  viewport: {
    width: 0,
    height: 0,
  },
  navbarAdditionalClassName: '',
  setNavbarAdditionalClassName: () => {},
})

export const DeviceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isMobile, setIsMobile] = useState(false)
  const [isDark, setIsDark] = useState(false)
  const [mode, setModeState] = useState<Mode>('system')
  const [viewport, setViewport] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 0,
    height: typeof window !== 'undefined' ? window.innerHeight : 0,
  })
  const [navbarAdditionalClassName, setNavbarAdditionalClassName] = useState<string>('')

  // 检查系统主题
  const getSystemTheme = () =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'

  // 应用主题到 document
  const applyTheme = useCallback((theme: Mode) => {
    const isDarkMode = theme === 'dark' || (theme === 'system' && getSystemTheme() === 'dark')
    setIsDark(isDarkMode)
    let effectiveTheme = theme
    if (theme === 'system') {
      effectiveTheme = getSystemTheme()
    }
    document.documentElement.classList.toggle('dark', effectiveTheme === 'dark')
    document.documentElement.style.colorScheme = effectiveTheme === 'dark' ? 'dark' : 'light'
  }, [])

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  useEffect(() => {
    // 更新检测函数以同时更新视窗尺寸
    const handleResize = () => {
      const width = window.innerWidth
      const height = window.innerHeight
      setIsMobile(width <= 768)
      setViewport({ width, height })
    }

    handleResize() // 初始化
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  /**
   * 解析当前该用哪一档明暗并应用。
   *
   * 规则：有节日主题时，节日绑定的明暗只是「默认值」；用户在本次节日里手动改过亮暗，
   * 就以用户为准（覆盖记在 theme-mode-override 里，带节日 id）。三档都保留，
   * 「跟随系统」在节日期间照样可选，只是要先压过节日默认。
   * 节日结束后覆盖会被清掉，用户自己的长期偏好（localStorage.theme）全程不被改动。
   */
  const syncThemeMode = useCallback(() => {
    if (typeof window === 'undefined')
      return
    const bound = readBoundThemeMode()
    if (!bound) {
      // 节日已经过去（或没启用主题）：顺手清掉上个节日留下的手动覆盖
      clearModeOverride()
    }
    const preference = resolveModePreference({
      boundMode: bound?.mode ?? null,
      override: bound ? readModeOverride(bound.id) : null,
      userMode: readUserModePreference(),
    })
    setModeState(preference)
    applyTheme(preference)
  }, [applyTheme])

  // 初始化主题和系统主题变化监听
  useEffect(() => {
    if (typeof window === 'undefined')
      return
    syncThemeMode()

    // 系统主题变动：当前生效的是「跟随系统」时才需要响应
    // （节日绑定的亮/暗是固定值，不受系统影响；节日期间的「跟随系统」覆盖同样要跟着系统变）
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      const bound = readBoundThemeMode()
      const preference = resolveModePreference({
        boundMode: bound?.mode ?? null,
        override: bound ? readModeOverride(bound.id) : null,
        userMode: readUserModePreference(),
      })
      if (preference === 'system')
        applyTheme('system')
    }
    media.addEventListener('change', handleChange)
    // 节日主题开关变化（顶栏配色弹层里的开关）后重新解析
    window.addEventListener(THEME_PACK_EVENT, syncThemeMode)
    return () => {
      media.removeEventListener('change', handleChange)
      window.removeEventListener(THEME_PACK_EVENT, syncThemeMode)
    }
  }, [applyTheme, syncThemeMode])

  const setMode = useCallback(
    (newMode: Mode) => {
      const bound = readBoundThemeMode()
      setModeState(newMode)
      applyTheme(newMode)
      // 节日期间：只是给「本次节日」打个手动标记，不动用户的长期偏好；节日过后标记自动清除
      if (bound)
        writeModeOverride(bound.id, newMode)
      else
        writeUserModePreference(newMode)
    },
    [applyTheme],
  )

  // 支持三种状态的切换：light -> dark -> system -> light ...
  const toggleMode = useCallback(() => {
    setModeState((prev) => {
      let newMode: Mode
      if (prev === 'light')
        newMode = 'dark'
      else if (prev === 'dark')
        newMode = 'system'
      else newMode = 'light'
      applyTheme(newMode)
      const bound = readBoundThemeMode()
      if (bound)
        writeModeOverride(bound.id, newMode)
      else
        writeUserModePreference(newMode)
      return newMode
    })
  }, [applyTheme])

  return (
    <DeviceContext.Provider
      value={{
        isMobile,
        isDark,
        mode,
        setMode,
        toggleMode,
        viewport,
        navbarAdditionalClassName,
        setNavbarAdditionalClassName,
      }}
    >
      {children}
    </DeviceContext.Provider>
  )
}

export const useDevice = () => useContext(DeviceContext)
