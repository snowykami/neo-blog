'use client'
import type { ServerAuthSeed } from '@/api/user.server'
import type { ConsoleBreadcrumbItem } from '@/components/console/site-header'
import { useTranslations } from 'next-intl'
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Forbidden from '@/components/common/forbidden'

import { AppSidebar } from '@/components/console/app-sidebar'
import { ConsoleTabs } from '@/components/console/console-tabs'
import { getFirstPermittedSidebarItem, matchSidebarItem, permittedItems } from '@/components/console/data'
import { ConsoleContentSkeleton } from '@/components/console/route-skeleton'
import { SiteHeader } from '@/components/console/site-header'
import {
  SidebarAutoCloseOnRouteChange,
  SidebarInset,
  SidebarProvider,
} from '@/components/ui/sidebar'
import { AuthSeedProvider, useAuth } from '@/contexts/auth-context'
import { usePublicContentRefresh } from '@/hooks/use-public-content-refresh'
import { useToLogin } from '@/hooks/use-route'
import { useOperationT } from '@/hooks/use-translations'
import { usePathname, useRouter } from '@/i18n/navigation'
import { consolePath, isConsolePreviewPath } from '@/utils/common/route'

/** 富文本 / HTML / 歌词特效编辑器等需要铺满工作区全宽全高的子路由，不加常规管理页的 max-w 版心约束 */
function isFullBleedConsolePath(pathname: string): boolean {
  return pathname.startsWith('/console/posts/edit/')
    || pathname.startsWith('/console/pages/edit/')
    || pathname.startsWith('/console/pages/html/')
    || pathname.startsWith('/console/lyric-effects/')
}

/** 自带独立吸顶工具栏（EditorAppBar）的富文本编辑页：保持外层顶栏随滚动自然收起，避免双层顶栏叠放挤占写作视口 */
function hasImmersiveEditorHeader(pathname: string): boolean {
  return pathname.startsWith('/console/posts/edit/')
    || pathname.startsWith('/console/pages/edit/')
}

function safeDecodeSegment(raw: string): string {
  try {
    return decodeURIComponent(raw)
  }
  catch {
    return raw
  }
}

export function ConsoleShell({
  children,
  initialAuth,
}: Readonly<{
  children: React.ReactNode
  initialAuth?: ServerAuthSeed
}>) {
  return (
    <AuthSeedProvider seed={initialAuth}>
      <ConsoleShellInner>{children}</ConsoleShellInner>
    </AuthSeedProvider>
  )
}

function ConsoleShellInner({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const t = useTranslations('Console')
  const routeT = useTranslations('Route')
  const operationT = useOperationT()
  const { user, loading } = useAuth()
  const toLogin = useToLogin()
  const router = useRouter()
  // 后台改了前台可见的内容后清掉浏览器路由缓存，回到前台时看到的是新内容
  usePublicContentRefresh()
  const pathname = usePathname() ?? '/'
  const isPreview = isConsolePreviewPath(pathname)
  // 后台界面在根元素标记 data-console，使挂载在 body 下的 Radix Portal 弹层也同步走后台中性色盘，无需全局 :has()
  useLayoutEffect(() => {
    if (isPreview)
      return
    document.documentElement.dataset.console = ''
    return () => {
      delete document.documentElement.dataset.console
    }
  }, [isPreview])

  // 标题与当前菜单直接由路径推导，避免首帧闪现占位标题；子页面与多 Tab 模块自动推导层级面包屑
  const match = useMemo(() => matchSidebarItem(pathname), [pathname])
  const title = match ? t(match.menu.title) : ''
  const menuTabs = useMemo(
    () => (match ? (user ? permittedItems(match.menu, user) : match.menu.items) : []),
    [match, user],
  )
  const breadcrumbs = useMemo<ConsoleBreadcrumbItem[] | undefined>(() => {
    if (!match)
      return undefined
    const menuLabel = t(match.menu.title)
    const itemLabel = t(match.item.tabTitle ?? match.item.title)
    if (pathname !== match.item.url) {
      const rest = pathname.slice(match.item.url.length + 1)
      const isEditRoute = rest.startsWith('edit/') || rest.startsWith('html/') || match.item.url === consolePath.lyricEffect
      const tail = rest.split('/').filter(Boolean).at(-1)
      const leafLabel = isEditRoute ? operationT('edit') : (tail ? `#${safeDecodeSegment(tail)}` : itemLabel)
      return [
        { label: t(match.item.title), href: match.item.url },
        { label: leafLabel },
      ]
    }
    if (menuTabs.length > 1 && menuLabel !== itemLabel) {
      const rootItem = menuTabs[0] ?? match.item
      return [
        { label: menuLabel, href: rootItem.url !== pathname ? rootItem.url : undefined },
        { label: itemLabel },
      ]
    }
    return undefined
  }, [match, menuTabs, operationT, pathname, t])
  const fullBleed = isFullBleedConsolePath(pathname)
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
    if (menuTabs.length > 1) {
      content = (
        <>
          <ConsoleTabs items={menuTabs} activeId={match.item.id} />
          {children}
        </>
      )
    }
  }

  // 文章 / 页面预览按前台的样子渲染（页面自带前台外壳），不套后台的侧栏与顶栏；权限由后端接口判定
  if (isPreview)
    return children

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
      <AppSidebar activeId={activeId} setActiveId={setActiveId} />
      {/* min-w-0：避免内容（如编辑器工具栏）的固有宽度撑破布局 */}
      <SidebarInset className="min-w-0">
        <SiteHeader
          title={title}
          breadcrumbs={breadcrumbs}
          breadcrumbLabel={routeT('console')}
          sticky={!hasImmersiveEditorHeader(pathname)}
        />
        {/* flex 列：编辑器等需要填满内容区高度的页面使用 flex-1；常规管理页居中限制最大版心宽度，2K/4K 大屏视线不横跳 */}
        <div
          className="flex min-w-0 flex-1 flex-col"
          style={
            {
              '--console-content-padding': 'calc(var(--spacing) * 4)',
              'padding': 'var(--console-content-padding)',
            } as React.CSSProperties
          }
        >
          {fullBleed
            ? content
            : <div className="mx-auto flex w-full max-w-[88rem] min-w-0 flex-1 flex-col lg:px-2">{content}</div>}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
