'use client'

import type { ComponentHeight } from './layout'
import { createContext, useContext } from 'react'

// 组件块的高度档位（null 为自动高度），由 ContentComponentView 提供
export const ComponentHeightContext = createContext<ComponentHeight | null>(null)

/** 读取当前组件块的高度档位：组件据此切换布局，在较矮的档位收起次要信息 */
export function useComponentHeight(): ComponentHeight | null {
  return useContext(ComponentHeightContext)
}
