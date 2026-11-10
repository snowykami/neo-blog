'use client'

import { CalendarClockIcon, CalendarDaysIcon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { PostMetaItem } from './post-meta-item'

const DATE_FORMAT = { year: 'numeric', month: '2-digit', day: '2-digit' } as const

/**
 * 文章的发布 / 更新日期：服务端按固定时区渲染，水合后按访客本机时区重新格式化（见 ClientI18nProvider），
 * 所以必须是客户端组件；「更新日期与发布日期是否同一天」也按本机时区判断
 */
export function PostMetaDates({
  createdAt,
  updatedAt,
  showUpdated,
}: {
  createdAt?: string
  updatedAt?: string
  /** 更新时间与发布时间不在同一天时额外显示更新时间（文章页） */
  showUpdated?: boolean
}) {
  const t = useTranslations()
  const format = useFormatter()
  const createdText = createdAt ? format.dateTime(new Date(createdAt), DATE_FORMAT) : ''
  const updatedText = updatedAt ? format.dateTime(new Date(updatedAt), DATE_FORMAT) : ''
  return (
    <>
      {createdText && (
        <PostMetaItem icon={CalendarDaysIcon} label={t('Copyright.post_at')}>
          <time dateTime={createdAt} className="tabular-nums">{createdText}</time>
        </PostMetaItem>
      )}
      {showUpdated && updatedText && updatedText !== createdText && (
        <PostMetaItem icon={CalendarClockIcon} label={t('Common.updated_at')}>
          <time dateTime={updatedAt} className="tabular-nums" title={t('Common.updated_at')}>{updatedText}</time>
        </PostMetaItem>
      )}
    </>
  )
}
