'use client'

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { SiteLogo } from '@/components/common/site-logo'

/**
 * 导航栏上下文：导航栏统一使用卡片式实心样式，这里只保留可被其他组件临时替换的标题与图标
 * （如音乐播放器在播放时把导航标题换成歌曲名）
 */
interface NavContextValue {
  navTitle: React.ReactNode
  navIcon: React.ReactNode
  setNavTitle: (title: React.ReactNode) => void
  setNavIcon: (icon: React.ReactNode) => void
  resetNavIcon: () => void
}

const NavContext = createContext<NavContextValue | undefined>(undefined)

// 默认导航图标：站点自身图标，未配置时回退为首页图标
function DefaultNavIcon() {
  return <SiteLogo />
}

export function NavProvider({ children }: { children: React.ReactNode }) {
  const [navIcon, setNavIcon] = useState<React.ReactNode>(<DefaultNavIcon />)
  const [navTitle, setNavTitle] = useState<React.ReactNode>('')

  const resetNavIcon = useCallback(() => {
    setNavIcon(<DefaultNavIcon />)
  }, [])

  const value = useMemo(
    () => ({ navTitle, setNavTitle, navIcon, setNavIcon, resetNavIcon }),
    [navTitle, navIcon, resetNavIcon],
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
