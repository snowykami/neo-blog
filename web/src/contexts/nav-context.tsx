'use client'

import React, { createContext, useContext, useMemo, useState } from 'react'

/**
 * 导航栏上下文：导航栏统一使用卡片式实心样式；标题区的内容（音乐、阅读进度、提示等）由顶栏灵动岛管理，见 contexts/topbar-island.ts
 */
interface NavContextValue {
  // 全屏页面：顶栏收起为手势条、隐藏页脚（由页面中的 FullscreenChrome 设置）
  fullscreen: boolean
  setFullscreen: (fullscreen: boolean) => void
}

const NavContext = createContext<NavContextValue | undefined>(undefined)

export function NavProvider({ children }: { children: React.ReactNode }) {
  const [fullscreen, setFullscreen] = useState(false)

  const value = useMemo(
    () => ({ fullscreen, setFullscreen }),
    [fullscreen],
  )

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>
}

export function useNav() {
  const ctx = useContext(NavContext)
  if (!ctx) {
    throw new Error('useNav must be used within a NavProvider')
  }
  return ctx
}
