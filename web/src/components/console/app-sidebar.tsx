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
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { useSiteInfo } from "@/contexts/site-info-context"
import { usePathname } from "next/navigation"



export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
  const { siteInfo } = useSiteInfo();
  const [activeId, setActiveId] = useState<string | null>(null);
  const consoleT = useTranslations("Console")

  useEffect(() => {
    if (!pathname) return
    const all = [...sidebarData.navMain, ...sidebarData.navUserCenter]
    const match = all.find(item => {
      if (!item.url) return false
      // 精确或前缀匹配（根据你的路由规则调整）
      return item.url === pathname
    })
    if (match?.id) setActiveId(match.id)
  }, [pathname])

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
                <span className="text-base font-semibold">{siteInfo?.metadata?.name}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavGroup title={consoleT("general")} activeId={activeId} setActiveId={setActiveId} items={sidebarData.navMain.map((item) => ({ ...item, title: consoleT(item.title) }))} />
        <NavGroup title={consoleT("personal")} activeId={activeId} setActiveId={setActiveId} items={sidebarData.navUserCenter.map((item) => ({ ...item, title: consoleT(item.title) }))} />
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
