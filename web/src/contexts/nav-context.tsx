// ...existing code...
'use client'

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { contentAreaPaddingClass, navHeight } from '@/utils/common/layout-size'

interface NavContextValue {
  hasNavPadding: boolean
  setHasNavPadding: (hasPadding: boolean) => void
  toggleNavPadding: () => void

  navClassName: string
  setNavStyle: (className: string) => void

  // useNavControl 中的重置（还原到 DEFAULT_NAV_CLASSNAME）
  resetNavStyle: () => void

  // 便捷控制
  disableNavPadding: () => void
  enableNavPadding: () => void

  // 预设样式
  setTransparentNav: () => void
  setSolidNav: () => void

  // navTitle: string;
  navTitle: string
  setNavTitle: (title: string) => void
}

export const DEFAULT_NAV_CLASSNAME = `bg-background/90 backdrop-blur md:rounded-b-2xl shadow-md border-b border-border/50 h-${navHeight} ${contentAreaPaddingClass}`

const NavContext = createContext<NavContextValue | undefined>(undefined)

export function NavPaddingProvider({
  children,
  initialHasNavPadding = true,
  initialNavClassName = '',
}: {
  children: React.ReactNode
  initialHasNavPadding?: boolean
  initialNavClassName?: string
}) {
  const [hasNavPadding, setHasNavPadding] = useState<boolean>(initialHasNavPadding)
  const [navClassName, setNavClassName] = useState<string>(
    cn(DEFAULT_NAV_CLASSNAME, initialNavClassName),
  )
  const [navTitle, setNavTitle] = useState<string>('')

  const toggleNavPadding = useCallback(() => {
    setHasNavPadding(prev => !prev)
  }, [])

  const resetNavStyle = useCallback(() => {
    setNavClassName(cn(DEFAULT_NAV_CLASSNAME, initialNavClassName))
  }, [initialNavClassName])

  const setNavStyle = useCallback((className: string) => {
    setNavClassName(cn(DEFAULT_NAV_CLASSNAME, className))
  }, [])

  const disableNavPadding = useCallback(() => {
    setHasNavPadding(false)
  }, [])

  const enableNavPadding = useCallback(() => {
    setHasNavPadding(true)
  }, [])

  const setTransparentNav = useCallback(() => {
    setNavClassName(cn(DEFAULT_NAV_CLASSNAME, 'bg-transparent backdrop-blur-md'))
  }, [])

  const setSolidNav = useCallback(() => {
    setNavClassName(cn(DEFAULT_NAV_CLASSNAME, 'bg-background border-b'))
  }, [])

  const value = useMemo(
    () => ({
      hasNavPadding,
      setHasNavPadding,
      toggleNavPadding,

      navClassName,
      resetNavStyle,
      setNavStyle,

      disableNavPadding,
      enableNavPadding,

      setTransparentNav,
      setSolidNav,

      navTitle,
      setNavTitle,
    }),
    [
      hasNavPadding,
      navClassName,
      navTitle,
      toggleNavPadding,
      resetNavStyle,
      setNavStyle,
      disableNavPadding,
      enableNavPadding,
      setTransparentNav,
      setSolidNav,
      setNavTitle,
    ],
  )

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>
}

export function useNav() {
  const ctx = useContext(NavContext)
  if (!ctx) {
    throw new Error('useNav must be used within a NavPaddingProvider')
  }
  return ctx
}
