import type { PageModel } from '@/models/page'
import { CalendarClockIcon, InfoIcon, UserIcon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { SidebarCard } from '@/components/blog-sidebar/sidebar-card'
import { readingTimeFromWords } from '@/utils/common/post'
import { formatDisplayName } from '@/utils/common/username'
import { PostWordStats } from './post-meta'

/** 独立页面阅读版式的侧栏信息：作者、更新时间、字数与阅读时长 */
export function PageInfoCard({ page, words }: { page: PageModel, words: number }) {
  const t = useTranslations('Common')
  const copyrightT = useTranslations('Copyright')
  const format = useFormatter()
  const rows = [
    { icon: UserIcon, label: copyrightT('author'), value: formatDisplayName(page.user) },
    { icon: CalendarClockIcon, label: t('updated_at'), value: format.dateTime(new Date(page.updatedAt), { year: 'numeric', month: 'short', day: 'numeric' }) },
  ]
  return (
    <SidebarCard title={t('page_info')} icon={InfoIcon} contentClassName="grid gap-3">
      <dl className="grid gap-2 text-sm">
        {rows.map(row => (
          <div key={row.label} className="flex items-center gap-2">
            <row.icon aria-hidden className="size-4 shrink-0 text-foreground/40" />
            <dt className="text-foreground/50">{row.label}</dt>
            <dd className="ml-auto min-w-0 truncate text-foreground/80">{row.value}</dd>
          </div>
        ))}
      </dl>
      <PostWordStats words={words} minutes={readingTimeFromWords(words)} />
    </SidebarCard>
  )
}
