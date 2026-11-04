'use client'
import type { IpData, User } from '@/models/user'
import { Mail, MapPin, Shield } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { getUserIpLocation } from '@/api/user'
import { PostMetaItem } from '@/components/blog-post/post-meta'
import { UserAvatar } from '@/components/common/avatar'
import { SafeImage } from '@/components/common/safe-image'
import { useAuth } from '@/contexts/auth-context'
import { cn } from '@/lib/utils'
import { UserGender } from './user-gender'
import { UserLocalTime } from './user-local-time'

export function UserHeader({ user }: { user: User }) {
  const t = useTranslations('UserPage')
  const roleT = useTranslations('Role')
  const { user: currentUser } = useAuth()
  const [ipData, setIpDate] = useState<IpData | null>(null)
  // 仅本人查看自己的主页时展示邮箱，避免泄露隐私
  const isSelf = !!currentUser && currentUser.id === user.id
  const email = isSelf ? (currentUser.email || user.email) : undefined

  useEffect(() => {
    let cancelled = false
    getUserIpLocation(user.id)
      .then((res) => {
        if (!cancelled)
          setIpDate(res.data)
      })
      .catch(() => {
        if (!cancelled)
          setIpDate(null)
      })
    return () => {
      cancelled = true
    }
  }, [user.id])

  const location = ipData
    ? [ipData.country, ipData.province, ipData.city, ipData.districts].filter(Boolean).join(' ')
    : ''

  return (
    <div className="overflow-hidden rounded-2xl bg-card">
      {/* 用户背景图 */}
      {user.backgroundUrl && (
        <div className="relative h-40 w-full md:h-56">
          <SafeImage src={user.backgroundUrl} alt="" fill priority className="object-cover" sizes="(max-width: 1200px) 100vw, 1200px" />
        </div>
      )}
      {/* 有背景图时顶部对齐，头像的负外边距才能真正上移压住背景图边缘；否则垂直居中 */}
      <div className={cn('flex flex-col items-center gap-5 p-6 md:flex-row md:gap-6 md:p-8', user.backgroundUrl ? 'md:items-start' : 'md:items-center')}>
        {/* 头像：有背景图时上移约一半压在背景图边缘 */}
        <UserAvatar user={user} size={256} className={cn('size-28 shrink-0 ring-4 ring-card md:size-32', user.backgroundUrl && '-mt-20 md:-mt-24')} fallbackClassName="text-3xl" />

        <div className="grid min-w-0 gap-3 text-center md:text-left">
          <div className="grid gap-1">
            <h1 className="truncate text-2xl font-bold text-foreground/90 md:text-3xl">
              {user.nickname || user.username || t('no_nickname')}
            </h1>
            <p className="text-foreground/50">
              @
              {user.username}
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 md:justify-start">
            <UserGender gender={user.gender} />
            {isSelf && (
              <PostMetaItem icon={Mail} label={t('email')}>
                <span className="block truncate">{email || t('not_filled')}</span>
              </PostMetaItem>
            )}
            <PostMetaItem icon={Shield} label={t('role')}>
              {user.role ? roleT(user.role) : t('guest')}
            </PostMetaItem>
            {ipData && (
              <PostMetaItem icon={MapPin} label={t('location')}>
                {location || t('unknown_location')}
              </PostMetaItem>
            )}
            {user.showLocalTime && user.timeZone && <UserLocalTime timeZone={user.timeZone} />}
          </div>
        </div>
      </div>
    </div>
  )
}
