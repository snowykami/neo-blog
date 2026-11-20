'use client'

import type { IconChildNode, ResolvedIconSpec } from './types'
import { createElement, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { DEFAULT_OWNER_LINK_ICON, isOwnerLinkIconName } from './types'

const ALLOWED_TAGS = new Set(['path', 'circle', 'rect', 'polygon', 'polyline', 'line', 'ellipse', 'g'])

function renderChildNode(node: IconChildNode, key: number): React.ReactNode {
  if (!ALLOWED_TAGS.has(node.tag))
    return null
  const props: Record<string, unknown> = { key, ...node.attr }
  const children = node.child?.map((child, idx) => renderChildNode(child, idx))
  return children?.length ? createElement(node.tag, props, ...children) : createElement(node.tag, props)
}

/**
 * 纯节点树渲染的轻量 SVG 组件：零图标大包依赖，首屏服务端直出且无 dangerouslySetInnerHTML
 */
export function IconSpecSvg({ spec, className }: { spec: ResolvedIconSpec, className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={spec.viewBox || '0 0 24 24'}
      fill={spec.stroke ? 'none' : 'currentColor'}
      stroke={spec.stroke ? 'currentColor' : undefined}
      strokeWidth={spec.stroke ? 2 : undefined}
      strokeLinecap={spec.stroke ? 'round' : undefined}
      strokeLinejoin={spec.stroke ? 'round' : undefined}
      aria-hidden="true"
      focusable="false"
      className={cn('shrink-0', className)}
    >
      {spec.nodes.map((node, index) => renderChildNode(node, index))}
    </svg>
  )
}

/**
 * 站长链接图标：前台优先直接渲染服务端缓存好的 resolved 节点树（零额外客户端下载）；
 * 后台编辑或客户端刚保存尚未刷新服务端快照时，按需异步解析单个图标
 */
export function OwnerLinkIcon({
  icon,
  resolved,
  className,
}: {
  icon?: string
  resolved?: ResolvedIconSpec | null
  className?: string
}) {
  const normalized = icon && isOwnerLinkIconName(icon) ? icon : DEFAULT_OWNER_LINK_ICON
  const [clientSpec, setClientSpec] = useState<{ forIcon: string, spec: ResolvedIconSpec | null } | null>(null)
  const activeSpec = resolved ?? (clientSpec?.forIcon === normalized ? clientSpec.spec : null)

  useEffect(() => {
    if (resolved)
      return
    let cancelled = false
    import('./resolve')
      .then(mod => mod.resolveOwnerIconSpec(normalized))
      .then(async (spec) => {
        if (cancelled)
          return
        if (spec) {
          setClientSpec({ forIcon: normalized, spec })
          return
        }
        const fallback = await import('./resolve').then(mod => mod.resolveOwnerIconSpec(DEFAULT_OWNER_LINK_ICON))
        if (!cancelled)
          setClientSpec({ forIcon: normalized, spec: fallback })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [normalized, resolved])

  if (!activeSpec)
    return <span aria-hidden="true" className={cn('inline-block shrink-0', className)} />
  return <IconSpecSvg spec={activeSpec} className={className} />
}
