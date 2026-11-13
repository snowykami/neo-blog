'use client'

import type { LucideIcon } from 'lucide-react'
import type * as React from 'react'
import { Link } from '@/i18n/navigation'

/** 顶栏（navbar-or-side.tsx）与移动端侧边菜单（mobile-nav-sheet.tsx）共用的菜单项结构与小工具 */

// 菜单项：title 为 Route 命名空间下的翻译键；label 为已确定的显示文本（如自定义页面标题），优先于 title
export interface NavLinkItem {
  title: string
  label?: string
  href: string
  icon: LucideIcon
  // 站外链接：新窗口打开
  external?: boolean
}

/** 菜单中的链接：站内路径用 Next 的路由切换，站外地址在新窗口打开 */
export function NavItemLink({ href, external, ...props }: React.ComponentProps<typeof Link> & { href: string, external?: boolean }) {
  if (external)
    return <a href={href} target="_blank" rel="noopener noreferrer" {...(props as React.ComponentProps<'a'>)} />
  return <Link href={href} {...props} />
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
