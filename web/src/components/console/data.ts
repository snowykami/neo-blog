import { consolePath } from "@/utils/common/route";
import type { User } from "@/models/user";
import { IconType } from "@/types/icon";
import { isAdmin, isEditor } from "@/utils/common/permission";
import { ChartBarStackedIcon, Database, Folder, Gauge, IdCard, MessageCircle, Newspaper, Palette, Settings, ShieldCheck, TagsIcon, UserPen, Users } from "lucide-react";


export interface SidebarItem {
  id: string;
  title: string;
  url: string;
  icon: IconType;
  permission: ({ user }: { user: User }) => boolean;
}

export const sidebarData: { navContent: SidebarItem[]; navPersonal: SidebarItem[]; navSystem: SidebarItem[]; navUser: SidebarItem[] } = {
  navContent: [
    {
      id: "dashboard",
      title: "dashboard.title",
      url: consolePath.dashboard,
      icon: Gauge,
      permission: isAdmin
    },
    {
      id: "posts",
      title: "posts.title",
      url: consolePath.post,
      icon: Newspaper,
      permission: isEditor
    },
    {
      id: "categories",
      title: "categories.title",
      url: consolePath.category,
      icon: ChartBarStackedIcon,
      permission: isEditor
    },
    {
      id: "labels",
      title: "labels.title",
      url: consolePath.label,
      icon: TagsIcon,
      permission: isEditor
    },
    {
      id: "comments",
      title: "comments.title",
      url: consolePath.comment,
      icon: MessageCircle,
      permission: isEditor
    },
    {
      id: "files",
      title: "files.title",
      url: consolePath.file,
      icon: Folder,
      permission: () => true
    },
  ],
  navUser: [
    {
      id: "users",
      title: "users.title",
      url: consolePath.user,
      icon: Users,
      permission: isAdmin
    },
    {
      id: "oidc",
      title: "oidc.title",
      url: consolePath.oidc,
      icon: IdCard,
      permission: isAdmin
    },
  ],
  navSystem: [
    {
      id: "global",
      title: "global.title",
      url: consolePath.global,
      icon: Settings,
      permission: isAdmin
    },
    {
      id: "storages",
      title: "storages.title",
      url: consolePath.storage,
      icon: Database,
      permission: isAdmin
    },
  ],
  navPersonal: [
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