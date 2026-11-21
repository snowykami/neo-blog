'use client'

import type { SidebarMenu as SidebarMenuData } from './data'
import { useTranslations } from 'next-intl'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { useAuth } from '@/contexts/auth-context'
import { Link } from '@/i18n/navigation'
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
                className="h-9 gap-2.5 px-3 [&>svg]:size-[15px] [&>svg]:text-muted-foreground/70 hover:[&>svg]:text-muted-foreground data-[active=true]:[&>svg]:text-sidebar-accent-foreground/55"
              >
                <Link href={first.url} onClick={() => setActiveId?.(menu.id)}>
                  <menu.icon strokeWidth={1.5} className="transition-colors" />
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
