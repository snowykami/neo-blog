"use client"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import Link from "next/link"
import { usePathname } from "next/navigation";
import { User } from "@/models/user";
import { useAuth } from "@/contexts/auth-context";
import { IconType } from "@/types/icon";
import { useTranslations } from "next-intl";
import { consolePath } from "@/hooks/use-route";

export function NavMain({
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
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarGroupLabel>{t("general")}</SidebarGroupLabel>
        <SidebarMenu>
          {items.map((item) => (
            item.permission({ user }) && <SidebarMenuItem key={item.title}>
              <Link href={item.url}>
                <SidebarMenuButton tooltip={item.title} isActive={item.url != consolePath.dashboard && pathname.startsWith(item.url) || item.url === pathname}>
                  {item.icon && <item.icon />}
                  <span>{t(item.title)}</span>
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
