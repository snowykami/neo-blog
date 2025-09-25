"use client"

import {
  IconInnerShadowTop,
} from "@tabler/icons-react"

import { NavGroup } from "@/components/console/nav-group"
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
import { sidebarData } from "./data"
import { ThemeModeToggle } from "../common/theme-toggle"
import { useState } from "react"
import { useTranslations } from "next-intl"



export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const [activeId, setActiveId] = useState("dashboard")
  const consoleT = useTranslations("Console")
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
        <NavGroup title={consoleT("general")} activeId={activeId} setActiveId={setActiveId} items={sidebarData.navMain.map((item) => ({...item, title: consoleT(item.title)}))} />
        <NavGroup title={consoleT("personal")} activeId={activeId} setActiveId={setActiveId} items={sidebarData.navUserCenter.map((item) => ({...item, title: consoleT(item.title)}))} />
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
