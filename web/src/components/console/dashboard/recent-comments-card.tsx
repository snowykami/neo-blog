import type { DashboardComment } from '@/models/dashboard'
import { useFormatter, useNow, useTranslations } from 'next-intl'
import Link from 'next/link'
import { UserAvatar } from '@/components/common/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { cn } from '@/lib/utils'
import { consolePath, getPageUrl, getPostUrl } from '@/utils/common/route'

// 最新评论：读者在说什么、哪些还没回复
export function RecentCommentsCard({ comments, pendingComments, days, className }: {
  comments: DashboardComment[]
  pendingComments: number
  days: number
  className?: string
}) {
  const t = useTranslations('Console.dashboard')
  return (
    <Card className={cn('gap-4 py-4', className)}>
      <CardHeader className="px-4">
        <CardTitle>{t('comments_title')}</CardTitle>
        <CardDescription>
          {pendingComments > 0 ? t('comments_pending_description', { count: pendingComments, days }) : t('comments_description')}
        </CardDescription>
        <CardAction>
          <Button asChild variant="ghost" size="sm">
            <Link href={consolePath.comment}>{t('view_all')}</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2">
        {comments.length === 0
          ? (
              <Empty className="py-8">
                <EmptyDescription>{t('empty_comments')}</EmptyDescription>
              </Empty>
            )
          : (
              <ul className="grid gap-1">
                {comments.map(comment => <CommentRow key={comment.id} comment={comment} />)}
              </ul>
            )}
      </CardContent>
    </Card>
  )
}

function CommentRow({ comment }: { comment: DashboardComment }) {
  const t = useTranslations('Console.dashboard')
  const format = useFormatter()
  // 显式传入当前时间，避免 next-intl 的 ENVIRONMENT_FALLBACK，并每分钟刷新相对时间
  const now = useNow({ updateInterval: 60_000 })
  const { target, user } = comment
  const targetUrl = target ? (target.type === 'page' ? getPageUrl(target) : getPostUrl({ post: target })) : null
  const createdAt = new Date(comment.createdAt)
  return (
    <li className="flex gap-3 rounded-md px-2 py-2">
      {user
        ? <UserAvatar user={user} size={64} className="mt-0.5 size-8 shrink-0" fallbackClassName="text-xs" />
        : <span className="mt-0.5 size-8 shrink-0 rounded-full bg-muted" aria-hidden="true" />}
      <div className="grid min-w-0 flex-1 gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="truncate font-medium">{user ? (user.nickname || user.username) : t('deleted_user')}</span>
          <time dateTime={comment.createdAt} title={format.dateTime(createdAt, { dateStyle: 'medium', timeStyle: 'short' })} className="text-xs text-muted-foreground">
            {format.relativeTime(createdAt, now)}
          </time>
          {comment.pending && <Badge className="ml-auto">{t('badge_pending')}</Badge>}
          {comment.isPrivate && <Badge variant="secondary" className={cn(!comment.pending && 'ml-auto')}>{t('badge_private')}</Badge>}
        </div>
        <p className="line-clamp-2 text-sm break-all text-foreground/80">{comment.content}</p>
        <p className="truncate text-xs text-muted-foreground">
          {target && targetUrl
            ? t.rich(comment.depth > 0 ? 'replied_in' : 'commented_in', {
                title: target.title,
                link: chunks => <Link href={targetUrl} target="_blank" prefetch={false} className="hover:text-primary hover:underline">{chunks}</Link>,
              })
            : t('target_deleted')}
        </p>
      </div>
    </li>
  )
}
