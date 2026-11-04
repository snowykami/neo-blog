import type { LucideIcon } from 'lucide-react'
import type { StandardGender } from '@/utils/common/gender'
import { Mars, User as UserIcon, Venus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { PostMetaItem } from '@/components/blog-post/post-meta'
import { cn } from '@/lib/utils'
import { isStandardGender } from '@/utils/common/gender'

const GENDER_ICONS: Record<StandardGender, { icon: LucideIcon, className: string }> = {
  male: { icon: Mars, className: 'text-sky-600 dark:text-sky-400' },
  female: { icon: Venus, className: 'text-pink-600 dark:text-pink-400' },
}

/** 性别的显示文字：male / female 显示对应翻译，自定义的显示文字本身，未填写为空 */
export function useGenderText() {
  const t = useTranslations('Gender')
  return (gender?: string) => {
    const value = gender?.trim() ?? ''
    return isStandardGender(value) ? t(value) : value
  }
}

/** 用户主页资料区的性别：male / female 显示对应图标，自定义的显示文字本身，未填写不显示 */
export function UserGender({ gender }: { gender?: string }) {
  const t = useTranslations('Gender')
  const genderText = useGenderText()
  const value = gender?.trim() ?? ''
  if (!value)
    return null
  if (isStandardGender(value)) {
    const { icon: Icon, className } = GENDER_ICONS[value]
    const label = t('labelled', { gender: genderText(value) })
    return (
      <span role="img" aria-label={label} title={label} className={cn('flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary', className)}>
        <Icon aria-hidden className="size-4" />
      </span>
    )
  }
  return (
    <PostMetaItem icon={UserIcon} label={t('label')}>
      {value}
    </PostMetaItem>
  )
}
