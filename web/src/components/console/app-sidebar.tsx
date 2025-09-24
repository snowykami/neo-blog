"use client"

import {
  IconInnerShadowTop,
} from "@tabler/icons-react"

import { NavMain } from "@/components/console/nav-main"
import { NavUser } from "@/components/console/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import config from "@/config"
import Link from "next/link"
import { NavUserCenter } from "./nav-ucenter"
import { sidebarData } from "./data"
import { ThemeModeToggle } from "../common/theme-toggle"



export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!p-1.5"
            >
              <Link href="/">
                <IconInnerShadowTop className="!size-5" />
                <span className="text-base font-semibold">{config.metadata.name}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={sidebarData.navMain} />
        <NavUserCenter items={sidebarData.navUserCenter} />
      </SidebarContent>
      <SidebarFooter>
        <div className="mb-2 flex justify-center">
          <ThemeModeToggle showSegmented={true} />
        </div>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  )
}
