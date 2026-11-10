'use client'

import type { NotificationItem as NotificationItemModel, NotificationType } from '@/models/notification'
import { Bell, CheckCheck, Loader2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { getUnreadNotificationCount, listNotificationGroupMembers, listNotifications, markAllNotificationsRead, markNotificationRead } from '@/api/notification'
import { useLoginDialog } from '@/components/auth/login-dialog'
import { UserAvatar } from '@/components/common/avatar'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/contexts/auth-context'
import { cn } from '@/lib/utils'
import { formatDateTime } from '@/utils/common/datetime'
import { getPostUrl, withCommentAnchor } from '@/utils/common/route'

// 界面上把「评论了文章 / 页面、回复、线程活动」并成「回复」一组，点赞单独一组
// 提及也是「有人在评论里跟我说话」，并入回复 tab
const REPLY_TYPES: NotificationType[] = ['comment.created', 'comment.replied', 'comment.mentioned', 'comment.thread_replied']
const LIKE_TYPES: NotificationType[] = ['post.liked', 'comment.liked']

type TabKey = 'all' | 'unread' | 'reply' | 'like'

// AvatarUserShape UserAvatar 需要的最小用户字段
type AvatarUserShape = Parameters<typeof UserAvatar>[0]['user']

const PAGE_SIZE = 10

export function NotificationsPage() {
  const t = useTranslations('Notifications')
  const { user } = useAuth()
  const openLogin = useLoginDialog()
  const [tab, setTab] = useState<TabKey>('all')
  const [items, setItems] = useState<NotificationItemModel[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  const sentinel = useRef<HTMLDivElement | null>(null)

  const query = useMemo(() => {
    const types = tab === 'reply' ? REPLY_TYPES : tab === 'like' ? LIKE_TYPES : undefined
    return { filter: tab === 'unread' ? 'unread' as const : 'all' as const, types }
  }, [tab])

  const load = useCallback(async (nextPage: number, replace: boolean) => {
    if (replace) {
      setLoading(true)
    }
    else {
      setLoadingMore(true)
    }
    try {
      const res = await listNotifications({ ...query, page: nextPage, size: PAGE_SIZE })
      setItems(prev => replace ? res.data.notifications : [...prev, ...res.data.notifications])
      setTotal(res.data.total)
      setPage(nextPage)
    }
    catch {
      toast.error(t('load_failed'))
    }
    finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [query, t])

  // 切换 tab 或登录状态变化时重新拉第一屏
  useEffect(() => {
    if (!user) {
      setItems([])
      setTotal(0)
      setLoading(false)
      return
    }
    void load(1, true)
  }, [load, user])

  // 触底加载
  useEffect(() => {
    const node = sentinel.current
    if (!node || !user)
      return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !loading && !loadingMore && items.length < total) {
        void load(page + 1, false)
      }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [items.length, total, page, loading, loadingMore, load, user])

  const handleMarkAll = async () => {
    setMarkingAll(true)
    try {
      await markAllNotificationsRead()
      await load(1, true)
    }
    catch {
      toast.error(t('mark_all_failed'))
    }
    finally {
      setMarkingAll(false)
    }
  }

  // 点开即已读；聚合行由后端整组置已读，本地同步整行状态
  const handleOpen = (item: NotificationItemModel) => {
    if (item.isRead)
      return
    setItems(prev => prev.map(row => row.id === item.id ? { ...row, isRead: true } : row))
    markNotificationRead(item.id).catch(() => {
      setItems(prev => prev.map(row => row.id === item.id ? { ...row, isRead: false } : row))
      getUnreadNotificationCount().catch(() => {})
    })
  }

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10">
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Bell />
            </EmptyMedia>
            <EmptyTitle>{t('title')}</EmptyTitle>
            <EmptyDescription>{t('login_required')}</EmptyDescription>
          </EmptyHeader>
          <Button type="button" onClick={() => openLogin({})}>
            {t('login')}
          </Button>
        </Empty>
      </div>
    )
  }

  const groups = groupByDay(items)

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={markingAll || items.every(item => item.isRead)}
          onClick={() => void handleMarkAll()}
        >
          {markingAll ? <Loader2 className="animate-spin" /> : <CheckCheck />}
          {t('mark_all_read')}
        </Button>
      </div>

      <Tabs value={tab} onValueChange={value => setTab(value as TabKey)}>
        <TabsList className="mb-4 w-full">
          <TabsTrigger value="all">{t('tab_all')}</TabsTrigger>
          <TabsTrigger value="unread">{t('tab_unread')}</TabsTrigger>
          <TabsTrigger value="reply">{t('tab_reply')}</TabsTrigger>
          <TabsTrigger value="like">{t('tab_like')}</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading
        ? (
            <div className="grid gap-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex gap-3 rounded-lg border p-3">
                  <Skeleton className="size-9 shrink-0 rounded-full" />
                  <div className="grid flex-1 gap-2">
                    <Skeleton className="h-3.5 w-4/5" />
                    <Skeleton className="h-3 w-2/5" />
                  </div>
                </div>
              ))}
            </div>
          )
        : items.length === 0
          ? (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Bell />
                  </EmptyMedia>
                  <EmptyTitle>{t('empty_title')}</EmptyTitle>
                  <EmptyDescription>{t('empty_desc')}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )
          : (
              <div className="grid gap-5">
                {groups.map(group => (
                  <section key={group.key} className="grid gap-2">
                    <h2 className="text-muted-foreground text-xs font-medium">{t(`group_${group.key}`)}</h2>
                    <div className="grid gap-2">
                      {group.items.map(item => (
                        <NotificationRow key={item.id} item={item} onOpen={handleOpen} />
                      ))}
                    </div>
                  </section>
                ))}
                <div ref={sentinel} className="h-6" />
                {loadingMore && (
                  <div className="text-muted-foreground flex items-center justify-center gap-2 py-2 text-xs">
                    <Loader2 className="size-3 animate-spin" />
                    {t('loading_more')}
                  </div>
                )}
              </div>
            )}
    </div>
  )
}

function NotificationRow({ item, onOpen }: { item: NotificationItemModel, onOpen: (item: NotificationItemModel) => void }) {
  const [members, setMembers] = useState<NotificationItemModel[] | null>(null)
  const [expanding, setExpanding] = useState(false)

  // 聚合行可以展开看具体是谁；展开后仍只算一个未读
  const toggleMembers = async () => {
    if (members) {
      setMembers(null)
      return
    }
    setExpanding(true)
    try {
      const res = await listNotificationGroupMembers(item.id)
      setMembers(res.data.notifications)
    }
    catch {
      setMembers(null)
    }
    finally {
      setExpanding(false)
    }
  }

  const t = useTranslations('Notifications')
  const commonT = useTranslations('Common')
  const locale = useLocale()
  const href = notificationLink(item)
  const actors = actorLabel(t, item)

  const body = (
    <div className={cn(
      'flex gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/60',
      item.isRead ? 'bg-card' : 'bg-accent/30',
    )}
    >
      <div className="flex shrink-0 items-start">
        {item.actorNames && item.actorNames.length > 1
          // 聚合行：头像堆叠，最多两个
          ? (
              <div className="flex -space-x-2">
                {item.actorNames.slice(0, 2).map(name => (
                  <div key={name} className="rounded-full ring-2 ring-background">
                    <UserAvatar user={nameOnlyUser(name)} size={64} className="size-7" />
                  </div>
                ))}
              </div>
            )
          : <UserAvatar user={item.actor} size={72} className="size-9" />}
      </div>
      <div className="grid min-w-0 flex-1 gap-1">
        <p className="text-sm break-words">
          {notificationText(t, item, actors)}
          {item.actorIsAi && (
            <span className="ml-1 rounded bg-muted px-1 py-0.5 align-middle text-[10px] font-medium">AI</span>
          )}
        </p>
        <span className="text-muted-foreground text-xs">
          {formatDateTime({
            dateTimeString: item.createdAt,
            locale,
            convertShortAgo: true,
            unitI18n: {
              secondsAgo: commonT('secondsAgo'),
              minutesAgo: commonT('minutesAgo'),
              hoursAgo: commonT('hoursAgo'),
              daysAgo: commonT('daysAgo'),
            },
          })}
        </span>
      </div>
      {!item.isRead && <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" aria-label={t('unread')} />}
    </div>
  )

  const expandable = item.aggregateCount > 1 && item.type !== 'comment.thread_replied'
  const content = href
    ? <Link href={href} onClick={() => onOpen(item)}>{body}</Link>
    : body

  return (
    <div className="grid gap-1">
      {content}
      {expandable && (
        <div className="pl-14">
          <button
            type="button"
            className="text-muted-foreground text-xs underline-offset-4 hover:underline"
            disabled={expanding}
            onClick={() => void toggleMembers()}
          >
            {members ? t('collapse_members') : t('expand_members', { count: item.aggregateCount })}
          </button>
          {members && (
            <ul className="mt-2 grid gap-1">
              {members.map(member => (
                <li key={member.id} className="text-muted-foreground flex items-center gap-2 text-xs">
                  <UserAvatar user={member.actor} size={48} className="size-5" />
                  <span>{member.actor.nickname || member.actor.username}</span>
                  <span>
                    {formatDateTime({
                      dateTimeString: member.createdAt,
                      locale,
                      convertShortAgo: true,
                      unitI18n: {
                        secondsAgo: commonT('secondsAgo'),
                        minutesAgo: commonT('minutesAgo'),
                        hoursAgo: commonT('hoursAgo'),
                        daysAgo: commonT('daysAgo'),
                      },
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// nameOnlyUser 聚合行的头像只有昵称可用（没有 avatar_url），其余字段留空走首字兜底
function nameOnlyUser(name: string): AvatarUserShape {
  return { username: name, nickname: name, avatarUrl: '', gravatarHash: '' }
}

// notificationLink 深链：评论 / 回复 / 线程活动定位到那条评论，文章点赞回到文章页
function notificationLink(item: NotificationItemModel): string | null {
  const key = item.subjectSlug || item.subjectId
  if (!key)
    return null
  const base = item.subjectType === 'page' ? `/page/${key}` : getPostUrl({ post: { slug: item.subjectSlug, id: item.subjectId } })
  if (item.type === 'post.liked')
    return base
  const commentId = item.targetType === 'comment' && item.targetId ? item.targetId : item.commentId
  return withCommentAnchor(base, commentId)
}

// actorLabel 聚合行的「A、B 和另外 N 人」，单条通知只有一个人
function actorLabel(t: ReturnType<typeof useTranslations>, item: NotificationItemModel): string {
  const names = item.actorNames && item.actorNames.length > 0
    ? item.actorNames
    : [item.actor.nickname || item.actor.username]
  const rest = Math.max(0, item.aggregateCount - names.length)
  const listed = names.join(t('actor_separator'))
  return rest > 0 ? `${listed}${t('and_others', { count: rest })}` : listed
}

// notificationText 按类型拼一句话；缺字段时降级而不是显示空括号
function notificationText(
  t: ReturnType<typeof useTranslations>,
  item: NotificationItemModel,
  actors: string,
): string {
  const subject = item.subjectTitle || t('deleted_subject')
  const quoted = item.quotedExcerpt
  const excerpt = item.excerpt
  switch (item.type) {
    case 'comment.created':
      return t(item.subjectType === 'page' ? 'types.comment_created_page' : 'types.comment_created', { actors, subject, excerpt })
    case 'comment.replied':
      return quoted
        ? t('types.comment_replied', { actors, subject, quoted, excerpt })
        : t('types.comment_replied_without_quote', { actors, excerpt })
    case 'post.liked':
      return t('types.post_liked', { actors, subject })
    case 'comment.liked':
      return quoted ? t('types.comment_liked', { actors, quoted }) : t('types.comment_liked_without_quote', { actors })
    case 'comment.thread_replied':
      return t('types.comment_thread_replied', { actors, subject })
    case 'comment.mentioned':
      return t('types.comment_mentioned', { actors, subject, excerpt })
    default:
      return `${actors} ${item.subjectTitle}`
  }
}

// groupByDay 今天 / 昨天 / 更早，列表本身已按时间倒序
function groupByDay(items: NotificationItemModel[]) {
  const today = startOfDay(new Date())
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const groups: { key: 'today' | 'yesterday' | 'earlier', items: NotificationItemModel[] }[] = [
    { key: 'today', items: [] },
    { key: 'yesterday', items: [] },
    { key: 'earlier', items: [] },
  ]
  for (const item of items) {
    const createdAt = new Date(item.createdAt)
    if (createdAt >= today)
      groups[0].items.push(item)
    else if (createdAt >= yesterday)
      groups[1].items.push(item)
    else
      groups[2].items.push(item)
  }
  return groups.filter(group => group.items.length > 0)
}

function startOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}
