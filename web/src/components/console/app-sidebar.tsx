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
import { Folder, Gauge, MessageCircle, Newspaper, Users } from "lucide-react"

const data = {
  navMain: [
    {
      title: "大石坝",
      url: "/console",
      icon: Gauge,
    },
    {
      title: "文章管理",
      url: "/console/post",
      icon: Newspaper,
    },
    {
      title: "评论管理",
      url: "/console/comment",
      icon: MessageCircle,
    },
    {
      title: "文件管理",
      url: "/console/file",
      icon: Folder,
    },
    {
      title: "用户管理",
      url: "/console/user",
      icon: Users,
    },
  ]
}

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
        <NavMain items={data.navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  )
}
