"use client"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import Link from "next/link"
import type { LucideProps } from "lucide-react";
import { ComponentType, SVGProps } from "react"
import { usePathname } from "next/navigation";

export function NavMain({
  items,
}: {
  items: {
    title: string
    url: string
    icon?: ComponentType<SVGProps<SVGSVGElement> & LucideProps>;
  }[]
}) {
  const pathname = usePathname() ?? "/"
  console.log("pathname", pathname)

  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <Link href={item.url}>
                <SidebarMenuButton tooltip={item.title} isActive={pathname===item.url}>
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
