'use client'

import type { AnyContentComponentDef } from './types'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { COMPONENT_FALLBACK_ATTR, COMPONENT_ROOT_ATTR } from './constants'
import { ContentComponentView } from './content-component-view'
import { resolveComponentElement } from './props'

interface Island {
  id: number
  root: HTMLElement
  fallback: HTMLElement
  def: AnyContentComponentDef
  props: Record<string, unknown>
}

let nextIslandId = 0

// 已处理的占位元素，避免重复挂载（开发模式下 effect 会执行两次）
const mounted = new WeakSet<Element>()

/**
 * 组件岛：扫描正文中的 [data-component] 占位，按注册表懒加载组件并通过 portal 挂载
 * - 未知组件、版本过高或 props 校验失败时保留降级内容
 * - 挂载后降级内容移入隐藏容器，组件渲染出错时恢复显示
 */
export function ComponentIslands({ containerId }: { containerId: string }) {
  const [islands, setIslands] = useState<Island[]>([])

  useEffect(() => {
    const container = document.getElementById(containerId)
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
      fallback.hidden = true
      fallback.append(...el.childNodes)
      const root = document.createElement('div')
      root.setAttribute(COMPONENT_ROOT_ATTR, '')
      el.append(fallback, root)
      found.push({ id: nextIslandId++, root, fallback, def: resolved.def, props: resolved.props })
    })
    if (found.length)
      setIslands(prev => [...prev, ...found])
  }, [containerId])

  return islands.map(({ id, root, fallback, def, props }) => createPortal(
    <ContentComponentView
      def={def}
      props={props}
      onError={() => {
        fallback.hidden = false
      }}
    />,
    root,
    id,
  ))
}
