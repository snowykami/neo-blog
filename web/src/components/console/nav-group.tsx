'use client'

import type { SidebarItem } from './data'
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

export function NavGroup({
  items,
  title,
  activeId,
  setActiveId,
}: {
  items: SidebarItem[]
  title: string
  activeId: string | null
  setActiveId?: (id: string) => void
}) {
  const { user } = useAuth()
  if (!user)
    return null
  const hasAnyPermission = items.some(item => item.permission({ user }))
  return (
    <>
      {hasAnyPermission && (
        <SidebarGroup>
          <SidebarGroupContent className="flex flex-col gap-2">
            <SidebarGroupLabel>{title}</SidebarGroupLabel>
            <SidebarMenu>
              {items.map(
                item =>
                  item.permission({ user }) && (
                    // 使用稳定的 id 作为 key，避免切换语言时整组重新挂载
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        asChild
                        id={`nav-item-${item.id}`}
                        tooltip={item.title}
                        isActive={activeId === item.id}
                      >
                        <Link href={item.url} onClick={() => setActiveId && setActiveId(item.id)}>
                          {item.icon && <item.icon />}
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ),
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}
    </>
  )
}
