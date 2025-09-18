"use client"
import { AppSidebar } from "@/components/console/app-sidebar"
import { SiteHeader } from "@/components/console/site-header"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"

import { useToLogin } from "@/hooks/use-route"
import { useEffect, useState } from "react"
import { User } from "@/models/user"
import { getLoginUser } from "@/api/user"

export default function ConsoleLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [user, setUser] = useState<User | null>(null);
  const toLogin = useToLogin();

  useEffect(() => {
    getLoginUser().then(res => {
      setUser(res.data);
    }).catch(() => {
      setUser(null);
      toLogin();
    });
  }, [toLogin]);
  if (user === null) {
    return null;
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      <SidebarInset>
        <SiteHeader />
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}
