import { consolePath } from "@/utils/common/route";
import type { User } from "@/models/user";
import { IconType } from "@/types/icon";
import { isAdmin, isEditor } from "@/utils/common/permission";
import { Folder, Gauge, MessageCircle, Newspaper, Palette, Settings, ShieldCheck, UserPen, Users } from "lucide-react";


export interface SidebarItem {
  id: string;
  title: string;
  url: string;
  icon: IconType;
  permission: ({ user }: { user: User }) => boolean;
}

export const sidebarData: { navMain: SidebarItem[]; navUserCenter: SidebarItem[] } = {
  navMain: [
    {
      id: "dashboard",
      title: "dashboard.title",
      url: consolePath.dashboard,
      icon: Gauge,
      permission: isAdmin
    },
    {
      id: "post",
      title: "post.title",
      url: consolePath.post,
      icon: Newspaper,
      permission: isEditor
    },
    {
      id: "comment",
      title: "comment.title",
      url: consolePath.comment,
      icon: MessageCircle,
      permission: isEditor
    },
    {
      id: "file",
      title: "file.title",
      url: consolePath.file,
      icon: Folder,
      permission: () => true
    },
    {
      id: "user",
      title: "user.title",
      url: consolePath.user,
      icon: Users,
      permission: isAdmin
    },
    {
      id: "global",
      title: "global.title",
      url: consolePath.global,
      icon: Settings,
      permission: isAdmin
    },
  ],
  navUserCenter: [
    {
      id: "user_profile",
      title: "user_profile.title",
      url: consolePath.userProfile,
      icon: UserPen,
      permission: () => true
    },
    {
      id: "user_security",
      title: "user_security.title",
      url: consolePath.userSecurity,
      icon: ShieldCheck,
      permission: () => true
    },
    {
      id: "user_preference",
      title: "user_preference.title",
      url: consolePath.userPreference,
      icon: Palette,
      permission: () => true
    }
  ]
}