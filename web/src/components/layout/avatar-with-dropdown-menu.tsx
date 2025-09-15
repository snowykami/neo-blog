"use client"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import GravatarAvatar from "../common/gravatar"
import { User } from "@/models/user";
import { useEffect, useState } from "react";
import { getLoginUser, userLogout } from "@/api/user";
import Link from "next/link";
import { toast } from "sonner";
import { useToLogin } from "@/hooks/use-route";
import { CircleUser } from "lucide-react";

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
          {user ? <GravatarAvatar className="w-8 h-8" email={user?.email || ""} url={user?.avatarUrl || ""} /> : <CircleUser className="w-9 h-9" />}
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
        <DropdownMenuGroup>
          <DropdownMenuItem>Team</DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Invite users</DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Email</DropdownMenuItem>
                <DropdownMenuItem>Message</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>More...</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
          <DropdownMenuItem>
            New Team
            <DropdownMenuShortcut>⌘+T</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem>GitHub</DropdownMenuItem>
        <DropdownMenuItem>Support</DropdownMenuItem>
        <DropdownMenuItem disabled>API</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={user ? handleLogout : toLogin}>
          {user ? `Logout (${user.username})` : "Login"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}