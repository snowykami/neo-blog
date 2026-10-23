'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { SiteLogo } from '@/components/common/site-logo'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { useSiteInfo } from '@/contexts/site-info-context'
import { ThemeModeToggle } from '../common/theme-toggle'
import { sidebarData } from './data'
import { NavGroup } from './nav-group'
import { NavUser } from './nav-user'

export function AppSidebar({
  activeId,
  setActiveId,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  activeId: string | null
  setActiveId: (id: string) => void
}) {
  const { siteInfo } = useSiteInfo()
  const consoleT = useTranslations('Console')

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="data-[slot=sidebar-menu-button]:!p-1.5">
              <Link href="/">
                <SiteLogo className="!size-5" />
                <span className="text-base font-semibold">{siteInfo?.metadata?.name}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavGroup title={consoleT('about_content')} activeId={activeId} setActiveId={setActiveId} menus={sidebarData.navContent} />
        <NavGroup title={consoleT('about_system')} activeId={activeId} setActiveId={setActiveId} menus={sidebarData.navSystem} />
        <NavGroup title={consoleT('personal')} activeId={activeId} setActiveId={setActiveId} menus={sidebarData.navPersonal} />
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
