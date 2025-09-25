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
import { useAuth } from "@/contexts/auth-context";
import { SidebarItem } from "./data";

export function NavGroup({
  items,
  title,
  activeId,
  setActiveId
}: {
  items: SidebarItem[],
  title: string,
  activeId: string,
  setActiveId? :(id: string) => void
}) {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarGroupLabel>{title}</SidebarGroupLabel>
        <SidebarMenu>
          {items.map((item) => (
            item.permission({ user }) && <SidebarMenuItem key={item.title}>
              <Link href={item.url} onClick={() => setActiveId && setActiveId(item.id)}>
                <SidebarMenuButton tooltip={item.title} isActive={activeId === item.id}>
                  {item.icon && <item.icon />}
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
