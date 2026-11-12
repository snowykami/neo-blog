'use client'

import type { ReactNode } from 'react'
import type { LinkPreviewTargetType } from '@/api/link-preview'
import { createContext, useContext, useMemo } from 'react'

export interface LinkPreviewScope {
  targetType?: LinkPreviewTargetType
  targetId?: number
}

const LinkPreviewScopeContext = createContext<LinkPreviewScope>({})

// 为当前区域内的外链悬停卡与 linkCard 组件岛提供所属内容标识，供后端白名单校验
export function LinkPreviewScopeProvider({
  targetType,
  targetId,
  children,
}: LinkPreviewScope & { children: ReactNode }) {
  const value = useMemo(() => ({ targetType, targetId }), [targetType, targetId])
  return <LinkPreviewScopeContext value={value}>{children}</LinkPreviewScopeContext>
}

export function useLinkPreviewScope(): LinkPreviewScope {
  return useContext(LinkPreviewScopeContext)
}
