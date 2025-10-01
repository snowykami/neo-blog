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
import Link from "next/link"
import { sidebarData } from "./data"
import { ThemeModeToggle } from "../common/theme-toggle"
import { useTranslations } from "next-intl"
import { useSiteInfo } from "@/contexts/site-info-context"

export function AppSidebar({ activeId, setActiveId, ...props }: React.ComponentProps<typeof Sidebar> & { activeId: string | null, setActiveId: (id: string) => void }) {
  const { siteInfo } = useSiteInfo();
  const consoleT = useTranslations("Console");

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!p-1.5"
              id="app-logo"
            >
              <Link href="/">
                <IconInnerShadowTop className="!size-5" />
                <span className="text-base font-semibold">{siteInfo?.metadata?.name}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavGroup
          title={consoleT("about_content")}
          activeId={activeId}
          setActiveId={setActiveId}
          items={sidebarData.navContent.map((item) => ({ ...item, title: consoleT(item.title) }))}
        />
        <NavGroup
          title={consoleT("about_system")}
          activeId={activeId}
          setActiveId={setActiveId}
          items={sidebarData.navSystem.map((item) => ({ ...item, title: consoleT(item.title) }))}
        />
        <NavGroup
          title={consoleT("about_user")}
          activeId={activeId}
          setActiveId={setActiveId}
          items={sidebarData.navUser.map((item) => ({ ...item, title: consoleT(item.title) }))}
        />
        <NavGroup
          title={consoleT("personal")}
          activeId={activeId}
          setActiveId={setActiveId}
          items={sidebarData.navPersonal.map((item) => ({ ...item, title: consoleT(item.title) }))}
        />
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
