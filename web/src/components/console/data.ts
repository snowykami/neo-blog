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
      title: "dashboard.title",
      url: "/console",
      icon: Gauge,
      permission: isAdmin
    },
    {
      title: "post.title",
      url: "/console/post",
      icon: Newspaper,
      permission: isEditor
    },
    {
      title: "comment.title",
      url: "/console/comment",
      icon: MessageCircle,
      permission: isEditor
    },
    {
      title: "file.title",
      url: "/console/file",
      icon: Folder,
      permission: () => true
    },
    {
      title: "user.title",
      url: "/console/user",
      icon: Users,
      permission: isAdmin
    },
    {
      title: "global.title",
      url: "/console/global",
      icon: Settings,
      permission: isAdmin
    },
  ],
  navUserCenter: [
    {
      title: "user_profile.title",
      url: "/console/user-profile",
      icon: UserPen,
      permission: () => true
    },
    {
      title: "user_security.title",
      url: "/console/user-security",
      icon: ShieldCheck,
      permission: () => true
    },
    {
      title: "user-preference.title",
      url: "/console/user-preference",
      icon: Palette,
      permission: () => true
    }
  ]
}