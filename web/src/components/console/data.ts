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

export const path = {
  dashboard: "/console",
  post: "/console/post",
  comment: "/console/comment",
  file: "/console/file",
  user: "/console/user",
  global: "/console/global",
  userProfile: "/console/user-profile",
  userSecurity: "/console/user-security",
  userPreference: "/console/user-preference",
}

export const sidebarData: { navMain: SidebarItem[]; navUserCenter: SidebarItem[] } = {
  navMain: [
    {
      title: "dashboard.title",
      url: path.dashboard,
      icon: Gauge,
      permission: isAdmin
    },
    {
      title: "post.title",
      url: path.post,
      icon: Newspaper,
      permission: isEditor
    },
    {
      title: "comment.title",
      url: path.comment,
      icon: MessageCircle,
      permission: isEditor
    },
    {
      title: "file.title",
      url: path.file,
      icon: Folder,
      permission: () => true
    },
    {
      title: "user.title",
      url: path.user,
      icon: Users,
      permission: isAdmin
    },
    {
      title: "global.title",
      url: path.global,
      icon: Settings,
      permission: isAdmin
    },
  ],
  navUserCenter: [
    {
      title: "user_profile.title",
      url: path.userProfile,
      icon: UserPen,
      permission: () => true
    },
    {
      title: "user_security.title",
      url: path.userSecurity,
      icon: ShieldCheck,
      permission: () => true
    },
    {
      title: "user-preference.title",
      url: path.userPreference,
      icon: Palette,
      permission: () => true
    }
  ]
}