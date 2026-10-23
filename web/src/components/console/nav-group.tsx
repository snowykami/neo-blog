'use client'

import type { SidebarMenu as SidebarMenuData } from './data'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { useAuth } from '@/contexts/auth-context'
import { permittedItems } from './data'

export function NavGroup({
  menus,
  title,
  activeId,
  setActiveId,
}: {
  menus: SidebarMenuData[]
  title: string
  activeId: string | null
  setActiveId?: (id: string) => void
}) {
  const consoleT = useTranslations('Console')
  const { user } = useAuth()
  if (!user)
    return null
  // 菜单链接到其中第一个有权限的页面；一个页面都没有权限时不显示
  const visible = menus
    .map(menu => ({ menu, first: permittedItems(menu, user)[0] }))
    .filter(entry => entry.first)
  if (visible.length === 0)
    return null
  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarGroupLabel>{title}</SidebarGroupLabel>
        <SidebarMenu>
          {visible.map(({ menu, first }) => (
            // 使用稳定的 id 作为 key，避免切换语言时整组重新挂载
            <SidebarMenuItem key={menu.id}>
              <SidebarMenuButton
                asChild
                id={`nav-item-${menu.id}`}
                tooltip={consoleT(menu.title)}
                isActive={activeId === menu.id}
                // 菜单合并后项数较少，加高菜单项便于点击，图标与间距同步放大
                className="h-10 gap-3 px-3 [&>svg]:size-[18px]"
              >
                <Link href={first.url} onClick={() => setActiveId?.(menu.id)}>
                  <menu.icon />
                  <span>{consoleT(menu.title)}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
