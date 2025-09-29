"use client"
import { AppSidebar } from "@/components/console/app-sidebar"
import { SiteHeader } from "@/components/console/site-header"
import {
  SidebarAutoCloseOnRouteChange,
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"

import { useToLogin } from "@/hooks/use-route"
import { useEffect, useState } from "react"
import { useAuth } from "@/contexts/auth-context"
import { sidebarData, SidebarItem } from "@/components/console/data"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import { consolePath } from "@/utils/common/route"

export default function ConsoleLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const t = useTranslations("Console")
  const { user } = useAuth();
  const [title, setTitle] = useState("Title");
  const toLogin = useToLogin();
  const pathname = usePathname() ?? "/"
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!pathname) return
    const all = [...sidebarData.navMain, ...sidebarData.navUserCenter]
    const match = all.find(item => {
      if (!item.url) return false
      return pathname === item.url || (item.url !== consolePath.dashboard && pathname.startsWith(item.url + "/"))
    })
    if (match?.id) {
      setActiveId(match.id) 
      setTitle(t(match.title))
    }
  }, [pathname])

  useEffect(() => {
    if (!user) {
      toLogin();
    }
  }, [user, toLogin]);

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <SidebarAutoCloseOnRouteChange />
      <AppSidebar variant="inset" activeId={activeId} setActiveId={setActiveId} />
      <SidebarInset>
        <SiteHeader title={title} />
        <div className="p-4 md:p-4">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
