"use client"

import { useState } from 'react'
import { createConfigurableContextHook } from '@/contexts/libs/use-enhance-context'

interface DemoContextPropsType {
  theme: string
}

export const {
  Provider: DemoProvider,
  useHook: useDemoHook,
  Context: DemoContext,
} = createConfigurableContextHook<DemoContextPropsType>(
  'demo',
  () => {
    const [theme, setTheme] = useState('light')
    // changeTheme 的引用稳定性由 createConfigurableContextHook 内部的 memo 化逻辑保证，而不是 useCallback
    const changeTheme = (theme: string) => {
      setTheme(theme)
    }
    return {
      theme,
      changeTheme,
    }
  }
)
