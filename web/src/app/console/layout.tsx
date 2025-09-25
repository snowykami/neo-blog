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

export default function ConsoleLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const t  = useTranslations("Console")
  const { user } = useAuth();
  const [title, setTitle] = useState("Title");
  const toLogin = useToLogin();
  const pathname = usePathname() ?? "/"

  const sideBarItems: SidebarItem[] = sidebarData.navMain.concat(sidebarData.navUserCenter);

  useEffect(() => {
    const currentItem = sideBarItems.find(item => item.url === pathname);
    if (currentItem) {
      setTitle(t(currentItem.title));
      document.title = `${t(currentItem.title)} - 控制台`;
    } else {
      setTitle("Title");
    }
  }, [pathname, sideBarItems, t]);

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
      <AppSidebar variant="inset" />
      <SidebarInset>
        <SiteHeader title={title} />
        <div className="p-4 md:p-4">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
