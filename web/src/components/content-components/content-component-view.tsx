'use client'

import type { ReactNode } from 'react'
import type { ComponentHeight } from './layout'
import type { AnyContentComponentDef } from './types'
import { Component } from 'react'
import { cn } from '@/lib/utils'
import { COMPONENT_BLOCK_CLASS } from './constants'
import { componentHeightRem } from './layout'
import { ComponentHeightContext } from './use-component-height'
import './component-layout.css'

interface BoundaryProps {
  fallback: ReactNode
  onError?: () => void
  children: ReactNode
}

/** 组件渲染出错时显示 fallback，不影响正文其他部分 */
class ComponentErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error('Content component render failed:', error)
    this.props.onError?.()
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export interface ContentComponentViewProps {
  def: AnyContentComponentDef
  props: Record<string, unknown>
  // 渲染出错时的回调（前台用于恢复降级内容）与替代内容
  onError?: () => void
  errorFallback?: ReactNode
  // 高度档位，应已按组件支持的档位过滤；null 为自动高度
  height?: ComponentHeight | null
  className?: string
}

export interface ContentViewProps extends Omit<ContentComponentViewProps, 'def'> {
  component: ContentComponentViewProps['def']['component']
}

/**
 * 只按「组件本体 + props」渲染：编辑器预览、前台组件岛、侧边栏组件卡片共用。
 * 侧边栏卡片不持有定义对象（那里带着 schema 与 zod），所以这里不要求传 def。
 */
export function ContentView({ component: Comp, props, onError, errorFallback = null, height = null, className }: ContentViewProps) {
  return (
    // @container：组件可按自身宽度（如 33% 的窄卡片）用容器查询收起信息
    <div
      className={cn(COMPONENT_BLOCK_CLASS, '@container', className)}
      style={height ? { height: `${componentHeightRem(height)}rem` } : undefined}
    >
      <ComponentHeightContext value={height}>
        <ComponentErrorBoundary fallback={errorFallback} onError={onError}>
          <Comp {...props} />
        </ComponentErrorBoundary>
      </ComponentHeightContext>
    </div>
  )
}

/** 渲染注册表中的组件：编辑器预览与前台组件岛共用 */
export function ContentComponentView({ def, ...rest }: ContentComponentViewProps) {
  return <ContentView component={def.component} {...rest} />
}
