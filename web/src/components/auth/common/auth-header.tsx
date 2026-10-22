'use client'

import Link from 'next/link'
import { ImageAvatar } from '@/components/common/avatar'
import { useSiteInfo } from '@/contexts/site-info-context'
import { getFallbackAvatarFromUsername } from '@/utils/common/username'

export function AuthHeader() {
  const { siteInfo } = useSiteInfo()

  if (!siteInfo)
    return null
  return (
    <div className="flex items-center gap-2 self-center font-bold text-2xl">
      <Link href="/" className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-full overflow-hidden border-2 border-gray-300 dark:border-gray-600">
          <ImageAvatar
            src={siteInfo.metadata?.icon}
            alt={siteInfo?.owner?.name}
            fallback={getFallbackAvatarFromUsername(siteInfo?.owner?.name || siteInfo.metadata?.name || '')}
            className="size-full"
          />
        </div>
        <span className="font-bold text-2xl">{siteInfo.metadata?.name || ''}</span>
      </Link>
    </div>
  )
}
