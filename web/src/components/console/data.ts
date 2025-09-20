import type { User } from "@/models/user";
import { IconType } from "@/types/icon";
import { isAdmin, isEditor } from "@/utils/common/permission";
import { Folder, Gauge, MessageCircle, Newspaper, Palette, Settings, ShieldCheck, UserPen, Users } from "lucide-react";


export interface SidebarItem {
  title: string;
  url: string;
  icon: IconType;
  permission: ({ user }: { user: User }) => boolean;
}

export const sidebarData: { navMain: SidebarItem[]; navUserCenter: SidebarItem[] } = {
  navMain: [
    {
      title: "大石坝",
      url: "/console",
      icon: Gauge,
      permission: isAdmin
    },
    {
      title: "文章管理",
      url: "/console/post",
      icon: Newspaper,
      permission: isEditor
    },
    {
      title: "评论管理",
      url: "/console/comment",
      icon: MessageCircle,
      permission: isEditor
    },
    {
      title: "文件管理",
      url: "/console/file",
      icon: Folder,
      permission: () => true
    },
    {
      title: "用户管理",
      url: "/console/user",
      icon: Users,
      permission: isAdmin
    },
    {
      title: "全局设置",
      url: "/console/setting",
      icon: Settings,
      permission: isAdmin
    },
  ],
  navUserCenter: [
    {
      title: "个人资料",
      url: "/console/user-profile",
      icon: UserPen,
      permission: () => true
    },
    {
      title: "安全设置",
      url: "/console/user-security",
      icon: ShieldCheck,
      permission: () => true
    },
    {
      title: "个性化",
      url: "/console/user-preference",
      icon: Palette,
      permission: () => true
    }
  ]
}