"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useSiteInfo } from "@/contexts/site-info-context";
import { getFallbackAvatarFromUsername } from "@/utils/common/username";
import Link from "next/link";

export function AuthHeader() {
  const { siteInfo } = useSiteInfo();

  if (!siteInfo) return null;
  return (
    <div className="flex items-center gap-2 self-center font-bold text-2xl">
      <Link href="/" className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-full overflow-hidden border-2 border-gray-300 dark:border-gray-600">
          <Avatar className="h-full w-full rounded-full">
            <AvatarImage src={siteInfo.metadata?.icon || ''} alt={siteInfo?.owner?.name} />
            <AvatarFallback className="rounded-full">{getFallbackAvatarFromUsername(siteInfo?.owner?.name || "Failed")}</AvatarFallback>
          </Avatar>
        </div>
        <span className="font-bold text-2xl">{siteInfo.metadata?.name || ''}</span>
      </Link>
    </div>
  )
}