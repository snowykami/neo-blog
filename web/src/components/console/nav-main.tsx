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
import type { LucideProps } from "lucide-react";
import { ComponentType, SVGProps } from "react"
import { usePathname } from "next/navigation";
import { User } from "@/models/user";
import { useAuth } from "@/contexts/auth-context";

export function NavMain({
  items,
}: {
  items: {
    title: string
    url: string
    icon?: ComponentType<SVGProps<SVGSVGElement> & LucideProps>;
    permission: ({ user }: { user: User }) => boolean
  }[]
}) {
  const { user } = useAuth();
  const pathname = usePathname() ?? "/"

  if (!user) return null;

  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarGroupLabel>General</SidebarGroupLabel>
        <SidebarMenu>
          {items.map((item) => (
            item.permission({ user }) && <SidebarMenuItem key={item.title}>
              <Link href={item.url}>
                <SidebarMenuButton tooltip={item.title} isActive={pathname === item.url}>
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
