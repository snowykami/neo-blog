"use client"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import Link from "next/link";
import { useToLogin } from "@/hooks/use-route";
import { consolePath } from "@/utils/common/route";
import { CircleUser } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getGravatarFromUser } from "@/utils/common/gravatar";
import { formatDisplayName, getFallbackAvatarFromUsername } from "@/utils/common/username";
import { useAuth } from "@/contexts/auth-context";
import { useTranslations } from "next-intl";
import { Role } from "@/models/user";

export function AvatarWithDropdownMenu() {
  const routeT = useTranslations("Route");
  const { user, logout } = useAuth();
  const toLogin = useToLogin();

  const handleLogout = () => {
    logout()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="rounded-full overflow-hidden">
          {user ? <Avatar className="h-8 w-8 rounded-full">
            <AvatarImage src={getGravatarFromUser({ user })} alt={user.username} />
            <AvatarFallback className="rounded-full">{getFallbackAvatarFromUsername(user.nickname || user.username)}</AvatarFallback>
          </Avatar> : <CircleUser className="h-8 w-8" />}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent className="w-auto" align="start">
        {user &&
          <>
            <DropdownMenuLabel>
              <div className="flex items-center gap-2 p-0 text-left text-sm">
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{formatDisplayName(user)}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {user.email}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator /></>}

        {user &&
          <>
            <DropdownMenuGroup className="p-0">
              <DropdownMenuItem asChild>
                <Link href={`/u/${user?.username}`}>{routeT("profile")}</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={user.role === Role.ADMIN ? consolePath.dashboard : consolePath.userProfile}>{routeT("console")}</Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        }

        <DropdownMenuItem onClick={user ? handleLogout : toLogin}>
          {user ? "Logout" : "Login"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}