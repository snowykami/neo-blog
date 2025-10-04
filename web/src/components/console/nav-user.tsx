"use client"

import {
  IconDotsVertical,
  IconLogout,
  IconUserCircle,
} from "@tabler/icons-react"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

import { getGravatarFromUser } from "@/utils/common/gravatar"
import { formatDisplayName, getFallbackAvatarFromUsername } from "@/utils/common/username"
import { useAuth } from "@/contexts/auth-context"
import { useTranslations } from "next-intl"
import { useToLogin, useToUserProfile } from "@/hooks/use-route"
import { ArrowLeftRightIcon } from "lucide-react"

export function NavUser() {
  const operationT = useTranslations("Operation");
  const routeT = useTranslations("Route");
  const clickToProfile = useToUserProfile();
  const { isMobile } = useSidebar()
  const { user, logout } = useAuth();

  const clickToLogin = useToLogin();

  const handleLogout = () => {
    logout()
  }

  if (!user) return null
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-full">
                <AvatarImage src={getGravatarFromUser({ user })} alt={user.username} />
                <AvatarFallback className="rounded-full">{getFallbackAvatarFromUsername(user.nickname || user.username)}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{formatDisplayName(user)}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {user.email}
                </span>
              </div>
              <IconDotsVertical className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-full">
                  <AvatarImage src={getGravatarFromUser({ user })} alt={user.username} />
                  <AvatarFallback className="rounded-full">{getFallbackAvatarFromUsername(user.nickname || user.username)}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{formatDisplayName(user)}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {user.email}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => { clickToProfile(user.username) }}>
                <IconUserCircle />
                {routeT("profile")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={clickToLogin}>
                <ArrowLeftRightIcon />
                {operationT("switch_account")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleLogout}>
                <IconLogout />
                {operationT("logout")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
