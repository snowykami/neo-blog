"use client"
import { AppSidebar } from "@/components/console/app-sidebar"
import { SiteHeader } from "@/components/console/site-header"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"

import { useToLogin } from "@/hooks/use-route"
import { useEffect } from "react"
import { useAuth } from "@/contexts/auth-context"

export default function ConsoleLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { user } = useAuth();
  const toLogin = useToLogin();

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
      <AppSidebar variant="inset" />
      <SidebarInset>
        <SiteHeader />
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}
