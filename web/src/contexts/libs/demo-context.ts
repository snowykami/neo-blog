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
    // 这里会被 useCallback 自动缓存
    const changeTheme = (theme: string) => {
      setTheme(theme)
    }
    return {
      theme,
      changeTheme,
    }
  }
)
