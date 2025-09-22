"use client"

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { User } from "@/models/user"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useAuth } from "@/contexts/auth-context"
import { IconType } from "@/types/icon"
import { useTranslations } from "next-intl"

export function NavUserCenter({
  items,
}: {
  items: {
    title: string
    url: string
    icon?: IconType;
    permission: ({ user }: { user: User }) => boolean
  }[]
}) {
  const t  = useTranslations("Console")
  const { user } = useAuth();
  const pathname = usePathname() ?? "/"

  if (!user) return null;

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Personal</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          item.permission({ user }) && <SidebarMenuItem key={item.title}>
            <Link href={item.url}>
              <SidebarMenuButton tooltip={item.title} isActive={pathname === item.url}>
                {item.icon && <item.icon />}
                <span>{t(item.title)}</span>
              </SidebarMenuButton>
            </Link>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
