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
import { User } from "@/models/user";
import { useEffect, useState } from "react";
import { getLoginUser, userLogout } from "@/api/user";
import Link from "next/link";
import { toast } from "sonner";
import { useToLogin } from "@/hooks/use-route";
import { CircleUser } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getGravatarFromUser } from "@/utils/common/gravatar";
import { getFallbackAvatarFromUsername } from "@/utils/common/username";

export function AvatarWithDropdownMenu() {
  const [user, setUser] = useState<User | null>(null);
  const toLogin = useToLogin();
  useEffect(() => {
    getLoginUser().then(res => {
      setUser(res.data);
    }).catch(() => {
      setUser(null);
    });
  }, []);

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
          </Avatar> : <CircleUser className="w-9 h-9" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="start">
        <DropdownMenuLabel>My Account</DropdownMenuLabel>
        <DropdownMenuGroup>
          {user && <DropdownMenuItem asChild>
            <Link href={`/u/${user?.username}`}>Profile</Link>
          </DropdownMenuItem>}
          <DropdownMenuItem asChild>
            <Link href="/console">Console</Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={user ? handleLogout : toLogin}>
          {user ? `Logout (${user.username})` : "Login"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}