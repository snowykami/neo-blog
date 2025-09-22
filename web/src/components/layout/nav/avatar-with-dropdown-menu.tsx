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
import { userLogout } from "@/api/user";
import Link from "next/link";
import { toast } from "sonner";
import { useToLogin } from "@/hooks/use-route";
import { CircleUser } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getGravatarFromUser } from "@/utils/common/gravatar";
import { formatDisplayName, getFallbackAvatarFromUsername } from "@/utils/common/username";
import { useAuth } from "@/contexts/auth-context";

export function AvatarWithDropdownMenu() {
  const { user } = useAuth();
  const toLogin = useToLogin();

  const handleLogout = () => {
    userLogout().then(() => {
      toast.success("Logged out successfully");
      window.location.reload();
    })
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
        {user && <DropdownMenuLabel>
          <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{formatDisplayName(user)}</span>
              <span className="text-muted-foreground truncate text-xs">
                {user.email}
              </span>
            </div>
          </div>
        </DropdownMenuLabel>}

        {user &&
          <>
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link href={`/u/${user?.username}`}>Profile</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/console">Console</Link>
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