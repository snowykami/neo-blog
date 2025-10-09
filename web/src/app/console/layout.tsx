'use client'
import { useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'
import React, { useEffect, useState } from 'react'

import { AppSidebar } from '@/components/console/app-sidebar'
import { sidebarData } from '@/components/console/data'
import { SiteHeader } from '@/components/console/site-header'
import {
  SidebarAutoCloseOnRouteChange,
  SidebarInset,
  SidebarProvider,
} from '@/components/ui/sidebar'
import { useAuth } from '@/contexts/auth-context'
import { useToLogin } from '@/hooks/use-route'
import { consolePath } from '@/utils/common/route'

export default function ConsoleLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const t = useTranslations('Console')
  const { user } = useAuth()
  const [title, setTitle] = useState('Title')
  const toLogin = useToLogin()
  const pathname = usePathname() ?? '/'
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    if (!pathname)
      return
    const all = [...sidebarData.navContent, ...sidebarData.navPersonal]
    const match = all.find((item) => {
      if (!item.url)
        return false
      return (
        pathname === item.url
        || (item.url !== consolePath.dashboard && pathname.startsWith(`${item.url}/`))
      )
    })
    if (match?.id) {
      setActiveId(match.id)
      setTitle(t(match.title))
    }
  }, [pathname, t])

  useEffect(() => {
    if (!user) {
      toLogin()
    }
  }, [user, toLogin])

  return (
    <SidebarProvider
      style={
        {
          '--sidebar-width': 'calc(var(--spacing) * 72)',
          '--header-height': 'calc(var(--spacing) * 12)',
        } as React.CSSProperties
      }
    >
      <SidebarAutoCloseOnRouteChange />
      <AppSidebar variant="inset" activeId={activeId} setActiveId={setActiveId} />
      <SidebarInset>
        <SiteHeader title={title} />
        <div
          style={
            {
              '--console-content-padding': 'calc(var(--spacing) * 4)',
              'padding': 'var(--console-content-padding)',
            } as React.CSSProperties
          }
        >
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
