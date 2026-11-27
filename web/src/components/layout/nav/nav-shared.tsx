'use client'

import type { LucideIcon } from 'lucide-react'
import type * as React from 'react'
import { preloadMusicRuntime } from '@/contexts/music-context'
import { Link } from '@/i18n/navigation'

/** 顶栏（navbar-or-side.tsx）与移动端侧边菜单（mobile-nav-sheet.tsx）共用的菜单项结构与小工具 */

// 菜单项：title 为 Route 命名空间下的翻译键；label 为已确定的显示文本（如自定义页面标题），优先于 title
export interface NavLinkItem {
  title: string
  label?: string
  href: string
  icon?: LucideIcon | null
  // 站外 http(s) 绝对地址（不经过站内多语言路由）
  external?: boolean
  // 是否在新浏览器标签页打开（等价 target="_blank"），关闭则在当前页打开
  openInNewTab?: boolean
  // 显式关闭预取（仅用于 /random 这类中转跳转路由；常规固定导航保持 partialPrefetching + dynamicOnHover）
  noPrefetch?: boolean
}

function isMusicEntryHref(href: string): boolean {
  return href === '/music' || href.startsWith('/music?') || href.startsWith('/music#')
}

/** 菜单中的链接：站内路径用 Next 多语言路由（支持按需新标签页打开），站外地址按 openInNewTab 决定新标签页或当前页跳转 */
export function NavItemLink({
  href,
  external,
  openInNewTab,
  noPrefetch,
  onPointerEnter,
  onTouchStart,
  ...props
}: React.ComponentProps<typeof Link> & { href: string, external?: boolean, openInNewTab?: boolean, noPrefetch?: boolean }) {
  if (external) {
    return (
      <a
        href={href}
        target={openInNewTab ? '_blank' : undefined}
        rel={openInNewTab ? 'noopener noreferrer' : undefined}
        onPointerEnter={onPointerEnter}
        onTouchStart={onTouchStart}
        {...(props as React.ComponentProps<'a'>)}
      />
    )
  }
  if (openInNewTab) {
    return (
      <Link
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        prefetch={false}
        unstable_dynamicOnHover={false}
        onPointerEnter={onPointerEnter}
        onTouchStart={onTouchStart}
        {...props}
      />
    )
  }
  const musicEntry = isMusicEntryHref(href)
  return (
    <Link
      href={href}
      prefetch={noPrefetch ? false : undefined}
      unstable_dynamicOnHover={noPrefetch ? false : undefined}
      onPointerEnter={(e) => {
        if (musicEntry)
          preloadMusicRuntime()
        onPointerEnter?.(e)
      }}
      onTouchStart={(e) => {
        if (musicEntry)
          preloadMusicRuntime()
        onTouchStart?.(e)
      }}
      {...props}
    />
  )
}

// 一级菜单：带 href 的直接跳转，带 children 的展开子菜单
export interface NavMenuItem extends Omit<NavLinkItem, 'href'> {
  href?: string
  children?: NavLinkItem[]
}

// 导航中的图标按钮：移动端点击区域 ≥ 44px，悬停浅主色底
export const navIconButtonClass = 'inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-foreground/75 transition-[color,background-color,transform] duration-150 hover:bg-primary/10 hover:text-primary active:scale-[.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer'

// 判断菜单项是否对应当前路由：首页精确匹配，其余按路径前缀匹配
export function isActivePath(pathname: string, href: string) {
  if (href === '/')
    return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}
