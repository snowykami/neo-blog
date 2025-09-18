"use client"
import { useEffect, useState } from "react"
import {
  IconChartBar,
  IconDashboard,
  IconFolder,
  IconInnerShadowTop,
  IconListDetails,
  IconUsers,
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
import { getLoginUser } from "@/api/user"
import { User } from "@/models/user"

const data = {
  navMain: [
    {
      title: "大石坝",
      url: "/console",
      icon: IconDashboard,
    },
    {
      title: "文章管理",
      url: "/console/post",
      icon: IconListDetails,
    },
    {
      title: "评论管理",
      url: "/console/comment",
      icon: IconChartBar,
    },
    {
      title: "文件管理",
      url: "/console/file",
      icon: IconFolder,
    },
    {
      title: "用户管理",
      url: "/console/user",
      icon: IconUsers,
    },
  ]
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const [loginUser, setLoginUser] = useState<User | null>(null);

  useEffect(() => {
    getLoginUser().then(resp => {
      setLoginUser(resp.data);
    });
  }, [])

  if (!loginUser) {
    return null; // 或者返回一个加载指示器
  }

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
        <NavUser user={loginUser} />
      </SidebarFooter>
    </Sidebar>
  )
}
