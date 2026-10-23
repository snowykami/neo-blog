'use client'

import type { ReactNode } from 'react'
import type { AnyContentComponentDef } from './types'
import { Component } from 'react'
import { cn } from '@/lib/utils'
import { COMPONENT_BLOCK_CLASS } from './constants'

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
  className?: string
}

/** 渲染注册表中的组件：编辑器预览与前台组件岛共用 */
export function ContentComponentView({ def, props, onError, errorFallback = null, className }: ContentComponentViewProps) {
  const Comp = def.component
  return (
    <div className={cn(COMPONENT_BLOCK_CLASS, className)}>
      <ComponentErrorBoundary fallback={errorFallback} onError={onError}>
        <Comp {...props} />
      </ComponentErrorBoundary>
    </div>
  )
}
