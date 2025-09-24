"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/contexts/auth-context";
import { getGravatarFromUser } from "@/utils/common/gravatar";
import { formatDisplayName, getFallbackAvatarFromUsername } from "@/utils/common/username";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import React from "react";
import { SectionDivider } from '@/components/common/section-divider';
import { LogOut } from "lucide-react";

export function CurrentLogged() {
  const t = useTranslations("Login");
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectBack = searchParams.get("redirect_back") || "/"
  const { user, logout } = useAuth();

  const handleLoggedContinue = () => {
    console.log("continue to", redirectBack);
    router.push(redirectBack);
  }

  const handleLogOut = () => {
    logout();
  }

  if (!user) return null;
  return (
    <div className="mb-4">
      <SectionDivider className="mb-4">{t("currently_logged_in")}</SectionDivider>
      <div className="flex justify-evenly items-center border border-border rounded-md p-2">
        <div onClick={handleLoggedContinue} className="flex gap-4 items-center cursor-pointer">
          <div className="flex gap-2 justify-center items-center  ">
            <Avatar className="h-10 w-10 rounded-full">
              <AvatarImage src={getGravatarFromUser({ user })} alt={user.username} />
              <AvatarFallback className="rounded-full">{getFallbackAvatarFromUsername(user.nickname || user.username)}</AvatarFallback>
            </Avatar>
          </div>
          <div className="grid place-items-center text-sm leading-tight text-center">
            <span className="text-primary font-medium">{formatDisplayName(user)}</span>
            <span className="text-muted-foreground truncate text-xs">
              {user.email}
            </span>
          </div>
        </div>
        <div>
          <LogOut onClick={handleLogOut} className="text-muted-foreground cursor-pointer" />
        </div>
      </div>
    </div>
  )
}