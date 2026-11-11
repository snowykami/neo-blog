'use client'

import type { ComponentHeight } from './layout'
import type { AnyContentComponentDef } from './types'
import { Suspense, useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { getVisibleElementById } from '@/utils/client/dom'
import { COMPONENT_FALLBACK_ATTR, COMPONENT_ROOT_ATTR } from './constants'
import { ContentComponentView } from './content-component-view'
import { parseComponentHeight } from './layout'
import { resolveComponentElement } from './props'

interface Island {
  id: number
  root: HTMLElement
  fallback: HTMLElement
  def: AnyContentComponentDef
  props: Record<string, unknown>
  height: ComponentHeight | null
}

let nextIslandId = 0

// 与组件同处一个 Suspense 边界：组件代码加载完、随组件一起提交时才隐藏降级内容，两者在同一帧替换
function HideOnCommit({ el }: { el: HTMLElement }) {
  useLayoutEffect(() => {
    el.hidden = true
  }, [el])
  return null
}

// 已处理的占位元素，避免重复挂载（开发模式下 effect 会执行两次）
const mounted = new WeakSet<Element>()

/**
 * 组件岛：扫描正文中的 [data-component] 占位，按注册表懒加载组件并通过 portal 挂载
 * - 未知组件、版本过高或 props 校验失败时保留降级内容
 * - 降级内容移入单独的容器，组件代码加载完、组件挂上后才隐藏；组件渲染出错时恢复显示
 */
export function ComponentIslands({ containerId }: { containerId: string }) {
  const [islands, setIslands] = useState<Island[]>([])

  useEffect(() => {
    const container = getVisibleElementById(containerId)
    if (!container)
      return
    const found: Island[] = []
    container.querySelectorAll('[data-component]').forEach((el) => {
      if (mounted.has(el) || !(el instanceof HTMLElement))
        return
      const resolved = resolveComponentElement(el)
      if (!resolved.ok)
        return
      mounted.add(el)
      const fallback = document.createElement('div')
      fallback.setAttribute(COMPONENT_FALLBACK_ATTR, '')
      fallback.append(...el.childNodes)
      const root = document.createElement('div')
      root.setAttribute(COMPONENT_ROOT_ATTR, '')
      el.append(fallback, root)
      // 只采用组件支持的高度档位，其余按自动高度渲染
      const height = parseComponentHeight(el.getAttribute('data-height'), resolved.def.heights ?? [])
      found.push({ id: nextIslandId++, root, fallback, def: resolved.def, props: resolved.props, height })
    })
    if (found.length)
      setIslands(prev => [...prev, ...found])
  }, [containerId])

  // 组件本体是 next/dynamic 按需加载的（默认不带 Suspense 边界）：这里不接住的话，加载中的挂起会穿过 portal 冒泡到路由的
  // loading 边界，整篇正文被隐藏（display:none）、换回 loading 骨架，等组件代码下载完才恢复（首屏水合后、客户端跳转后都会这样）。
  // 每个组件岛自己一个边界，加载期间保留降级内容。HideOnCommit 放在组件前面：渲染出错时 onError（错误边界的 componentDidCatch）
  // 在它之后执行，恢复显示降级内容
  return islands.map(({ id, root, fallback, def, props, height }) => createPortal(
    <Suspense fallback={null}>
      <HideOnCommit el={fallback} />
      <ContentComponentView
        def={def}
        props={props}
        height={height}
        onError={() => {
          fallback.hidden = false
        }}
      />
    </Suspense>,
    root,
    id,
  ))
}
