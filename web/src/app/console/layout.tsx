'use client'
import { useTranslations } from 'next-intl'
import { usePathname, useRouter } from 'next/navigation'
import React, { useEffect, useMemo, useRef, useState } from 'react'

import Forbidden from '@/components/common/forbidden'
import { AppSidebar } from '@/components/console/app-sidebar'
import { ConsoleTabs } from '@/components/console/console-tabs'
import { getFirstPermittedSidebarItem, matchSidebarItem, permittedItems } from '@/components/console/data'
import { SiteHeader } from '@/components/console/site-header'
import {
  SidebarAutoCloseOnRouteChange,
  SidebarInset,
  SidebarProvider,
} from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/contexts/auth-context'
import { useToLogin } from '@/hooks/use-route'
import { consolePath } from '@/utils/common/route'

export default function ConsoleLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const t = useTranslations('Console')
  const { user, loading } = useAuth()
  const toLogin = useToLogin()
  const router = useRouter()
  const pathname = usePathname() ?? '/'
  // 标题与当前菜单直接由路径推导，避免首帧闪现占位标题；标题使用菜单名，同一菜单的页面以 Tab 区分
  const match = useMemo(() => matchSidebarItem(pathname), [pathname])
  const title = match ? t(match.menu.title) : ''
  const [activeId, setActiveId] = useState<string | null>(match?.menu.id ?? null)

  useEffect(() => {
    if (match?.menu.id)
      setActiveId(match.menu.id)
  }, [match])

  // 未匹配到菜单的路由不在此拦截（交由页面自身 / 404 处理）
  const permitted = !user || !match || match.item.permission({ user })
  // 无权访问仪表盘（首页）时跳转到第一个有权限的菜单，而不是展示 403
  const redirectTarget = user && !permitted && match?.item.url === consolePath.dashboard
    ? getFirstPermittedSidebarItem(user)?.url
    : undefined

  // toLogin 每次渲染都是新函数，用 ref 保存，仅在登录状态变化时触发跳转
  const toLoginRef = useRef(toLogin)
  toLoginRef.current = toLogin
  useEffect(() => {
    if (!(loading || user))
      toLoginRef.current()
  }, [loading, user])

  useEffect(() => {
    if (redirectTarget)
      router.replace(redirectTarget)
  }, [redirectTarget, router])

  let content: React.ReactNode = children
  if (loading || !user || redirectTarget) {
    content = <ConsoleContentSkeleton />
  }
  else if (!permitted) {
    content = <Forbidden />
  }
  else if (match && pathname === match.item.url) {
    // 菜单下有多个可访问页面时显示 Tab；编辑页等子路由不显示
    const tabs = permittedItems(match.menu, user)
    if (tabs.length > 1) {
      content = (
        <>
          <ConsoleTabs items={tabs} activeId={match.item.id} />
          {children}
        </>
      )
    }
  }

  return (
    <SidebarProvider
      style={
        {
          '--sidebar-width': 'calc(var(--spacing) * 72)',
          '--header-height': 'calc(var(--spacing) * 12)',
        } as React.CSSProperties
      }
    >
      <SidebarAutoCloseOnRouteChange />
      <AppSidebar variant="inset" activeId={activeId} setActiveId={setActiveId} />
      {/* min-w-0：避免内容（如编辑器工具栏）的固有宽度撑破布局 */}
      <SidebarInset className="min-w-0">
        <SiteHeader title={title} />
        {/* flex 列：编辑器等需要填满内容区高度的页面使用 flex-1 */}
        <div
          className="flex min-w-0 flex-1 flex-col"
          style={
            {
              '--console-content-padding': 'calc(var(--spacing) * 4)',
              'padding': 'var(--console-content-padding)',
            } as React.CSSProperties
          }
        >
          {content}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

// 登录状态确认中或跳转中的占位
function ConsoleContentSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true">
      <Skeleton className="h-9 w-full max-w-sm" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  )
}
