'use client'
import type { IpData, User } from '@/models/user'
import { Mail, MapPin, Shield, User as UserIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { getUserIpLocation } from '@/api/user'
import { SafeImage } from '@/components/common/safe-image'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useAuth } from '@/contexts/auth-context'
import { getAvatarOrGravatarUrlFromUser } from '@/utils/common/gravatar'
import { getFirstCharFromUser } from '@/utils/common/username'

// 常见的性别取值映射到翻译键，其余自定义内容原样显示
const GENDER_ALIASES: Record<string, 'gender_male' | 'gender_female' | 'gender_other'> = {
  'male': 'gender_male',
  'm': 'gender_male',
  'man': 'gender_male',
  '男': 'gender_male',
  '男性': 'gender_male',
  'female': 'gender_female',
  'f': 'gender_female',
  'woman': 'gender_female',
  '女': 'gender_female',
  '女性': 'gender_female',
  'other': 'gender_other',
  'others': 'gender_other',
  'non-binary': 'gender_other',
  '其他': 'gender_other',
}

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

  const genderKey = user.gender ? GENDER_ALIASES[user.gender.trim().toLowerCase()] : undefined
  const gender = genderKey ? t(genderKey) : user.gender

  const location = ipData
    ? [ipData.country, ipData.province, ipData.city, ipData.districts].filter(Boolean).join(' ')
    : ''

  return (
    <div>
      {/* 用户背景图 */}
      {user.backgroundUrl && (
        <div className="relative mt-4 h-40 md:h-56 w-full overflow-hidden rounded-xl">
          <SafeImage src={user.backgroundUrl} alt="" fill priority className="object-cover" sizes="(max-width: 1280px) 100vw, 1280px" />
        </div>
      )}
      <div className="flex flex-col md:flex-row items-center md:items-center h-auto md:h-60">
        {/* 左侧 30%（头像容器） */}
        <div className="md:basis-[20%] flex justify-center items-center p-4">
          {/* wrapper 控制显示大小，父组件给具体 w/h */}
          <div className="w-40 h-40 md:w-48 md:h-48 relative">
            <Avatar className="h-full w-full rounded-full">
              <AvatarImage src={getAvatarOrGravatarUrlFromUser({ user })} alt={user.nickname} />
              <AvatarFallback className="rounded-full">{getFirstCharFromUser(user)}</AvatarFallback>
            </Avatar>
          </div>
        </div>

        {/* 右侧 70%（信息区） */}
        <div className="md:basis-[70%] p-4 flex flex-col justify-center space-y-2">
          <h2 className="text-2xl font-bold mt-0">
            {user.nickname || user.username || t('no_nickname')}
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            @
            {user.username}
          </p>

          <div className="flex items-center text-sm text-slate-600 dark:text-slate-400">
            <UserIcon className="w-4 h-4 mr-2" />
            <span>{gender || t('not_filled')}</span>
          </div>

          {isSelf && (
            <div className="flex items-center text-sm text-slate-600 dark:text-slate-400">
              <Mail className="w-4 h-4 mr-2" />
              <span>{email || t('not_filled')}</span>
            </div>
          )}

          <div className="flex items-center text-sm text-slate-600 dark:text-slate-400">
            <Shield className="w-4 h-4 mr-2" />
            <span>{user.role ? roleT(user.role) : t('guest')}</span>
          </div>

          {ipData && (
            <div className="flex items-center text-sm text-slate-600 dark:text-slate-400">
              <MapPin className="w-4 h-4 mr-2" />
              <span>{location || t('unknown_location')}</span>
            </div>
          )}
          {/* 其他简介、按钮等放这里 */}
        </div>
      </div>
    </div>
  )
}
