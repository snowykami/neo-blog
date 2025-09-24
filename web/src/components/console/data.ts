import { consolePath } from "@/hooks/use-route";
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
      url: consolePath.dashboard,
      icon: Gauge,
      permission: isAdmin
    },
    {
      title: "post.title",
      url: consolePath.post,
      icon: Newspaper,
      permission: isEditor
    },
    {
      title: "comment.title",
      url: consolePath.comment,
      icon: MessageCircle,
      permission: isEditor
    },
    {
      title: "file.title",
      url: consolePath.file,
      icon: Folder,
      permission: () => true
    },
    {
      title: "user.title",
      url: consolePath.user,
      icon: Users,
      permission: isAdmin
    },
    {
      title: "global.title",
      url: consolePath.global,
      icon: Settings,
      permission: isAdmin
    },
  ],
  navUserCenter: [
    {
      title: "user_profile.title",
      url: consolePath.userProfile,
      icon: UserPen,
      permission: () => true
    },
    {
      title: "user_security.title",
      url: consolePath.userSecurity,
      icon: ShieldCheck,
      permission: () => true
    },
    {
      title: "user-preference.title",
      url: consolePath.userPreference,
      icon: Palette,
      permission: () => true
    }
  ]
}