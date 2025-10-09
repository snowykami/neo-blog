'use client'

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'

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
  const applyTheme = useCallback(
    (theme: Mode) => {
      const isDarkMode = theme === 'dark' || (theme === 'system' && getSystemTheme() === 'dark')
      setIsDark(isDarkMode)
      let effectiveTheme = theme
      if (theme === 'system') {
        effectiveTheme = getSystemTheme()
      }
      document.documentElement.classList.toggle('dark', effectiveTheme === 'dark')
    },
    [],
  )

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

  // 初始化主题和系统主题变化监听
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('theme') as Mode | null
      const theme = savedTheme || 'system'
      setModeState(theme)
      applyTheme(theme)

      // 监听系统主题变动
      const media = window.matchMedia('(prefers-color-scheme: dark)')
      const handleChange = () => {
        if (!localStorage.getItem('theme') || localStorage.getItem('theme') === 'system') {
          applyTheme('system')
        }
      }
      media.addEventListener('change', handleChange)
      return () => media.removeEventListener('change', handleChange)
    }
  }, [applyTheme])

  const setMode = useCallback((newMode: Mode) => {
    setModeState(newMode)
    applyTheme(newMode)
    if (newMode === 'system') {
      localStorage.removeItem('theme')
    }
    else {
      localStorage.setItem('theme', newMode)
    }
  }, [applyTheme])

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
      if (newMode === 'system') {
        localStorage.removeItem('theme')
      }
      else {
        localStorage.setItem('theme', newMode)
      }
      return newMode
    })
  }, [applyTheme])

  return (
    <DeviceContext.Provider
      value={{ isMobile, isDark, mode, setMode, toggleMode, viewport, navbarAdditionalClassName, setNavbarAdditionalClassName }}
    >
      {children}
    </DeviceContext.Provider>
  )
}

export const useDevice = () => useContext(DeviceContext)
