import type { DashboardContent } from '@/models/dashboard'
import type { IconType } from '@/types/icon'
import { BotMessageSquare, ChevronRight, CircleCheck, FilePen, Lock, MessageCircleReply, Sparkles } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { consolePath } from '@/utils/common/route'

interface TodoItem {
  key: string
  icon: IconType
  count: number
  url: string
  // 需要博主处理的事项有数量时高亮；私密文章只是提醒，不算待办
  actionable: boolean
}

// 待处理：把“需要我动手”的事情集中在一起，每项直达对应的管理页
export function TodoCard({ content, pendingComments, days, className }: {
  content: DashboardContent
  pendingComments: number
  days: number
  className?: string
}) {
  const t = useTranslations('Console.dashboard')
  const format = useFormatter()
  const items: TodoItem[] = [
    { key: 'pending_comments', icon: MessageCircleReply, count: pendingComments, url: consolePath.comment, actionable: true },
    { key: 'draft_posts', icon: FilePen, count: content.draftPosts, url: consolePath.post, actionable: true },
    { key: 'ai_summary_stale', icon: BotMessageSquare, count: content.aiSummaryStale, url: consolePath.post, actionable: true },
    { key: 'ai_summary_missing', icon: Sparkles, count: content.aiSummaryMissing, url: consolePath.post, actionable: true },
    { key: 'private_posts', icon: Lock, count: content.privatePosts, url: consolePath.post, actionable: false },
  ]
  const allClear = items.every(item => !item.actionable || item.count === 0)
  const coverage = content.posts > 0 ? content.aiSummaryReady / content.posts : 0

  return (
    <Card className={cn('gap-4 py-4', className)}>
      <CardHeader className="px-4">
        <CardTitle>{t('todo_title')}</CardTitle>
        <CardDescription>
          {allClear ? t('todo_all_clear') : t('todo_description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-1 px-2">
        {items.map(item => (
          <Link
            key={item.key}
            href={item.url}
            className="group flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors hover:bg-accent"
          >
            {item.actionable && item.count === 0
              ? <CircleCheck className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              : <item.icon className={cn('size-4 shrink-0', item.actionable ? 'text-primary' : 'text-muted-foreground')} aria-hidden="true" />}
            <span className={cn('min-w-0 flex-1 truncate', item.count === 0 && 'text-muted-foreground')}>
              {t(`todo_${item.key}`, { days })}
            </span>
            <span className={cn('font-semibold tabular-nums', item.actionable && item.count > 0 ? 'text-primary' : 'text-muted-foreground')}>
              {format.number(item.count)}
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
          </Link>
        ))}
      </CardContent>
      <CardContent className="grid gap-2 px-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{t('ai_coverage')}</span>
          <span className="tabular-nums">
            {format.number(content.aiSummaryReady)}
            {' / '}
            {format.number(content.posts)}
          </span>
        </div>
        <Progress value={coverage * 100} aria-label={t('ai_coverage')} />
      </CardContent>
    </Card>
  )
}
