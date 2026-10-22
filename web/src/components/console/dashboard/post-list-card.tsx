'use client'

import type { DashboardPost } from '@/models/dashboard'
import { Eye, Flame, Heart, MessageCircle, Pencil } from 'lucide-react'
import { useFormatter, useNow, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { getPostEditUrl, getPostUrl } from '@/utils/common/route'

// 每个标签页右侧突出展示的数值：区间浏览、累计热度、发布时间或更新时间
export type PostListMetric = 'periodViews' | 'heat' | 'createdAt' | 'updatedAt'

export interface PostListTab {
  value: string
  posts: DashboardPost[]
  metric: PostListMetric
}

export function PostListCard({ title, tabs, className }: { title: string, tabs: PostListTab[], className?: string }) {
  const t = useTranslations('Console.dashboard')
  const [value, setValue] = useState(tabs[0].value)
  const tab = tabs.find(item => item.value === value) ?? tabs[0]

  return (
    <Card className={cn('gap-4 py-4', className)}>
      <CardHeader className="px-4">
        <CardTitle>{title}</CardTitle>
        <CardAction>
          <Tabs value={tab.value} onValueChange={setValue}>
            <TabsList>
              {tabs.map(item => <TabsTrigger key={item.value} value={item.value}>{t(`tab_${item.value}`)}</TabsTrigger>)}
            </TabsList>
          </Tabs>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2">
        {tab.posts.length === 0
          ? (
              <Empty className="py-8">
                <EmptyDescription>{t(`empty_${tab.value}`)}</EmptyDescription>
              </Empty>
            )
          : (
              <ol className="grid gap-1">
                {tab.posts.map((post, index) => (
                  <PostRow key={post.id} post={post} rank={index + 1} metric={tab.metric} />
                ))}
              </ol>
            )}
      </CardContent>
    </Card>
  )
}

function PostRow({ post, rank, metric }: { post: DashboardPost, rank: number, metric: PostListMetric }) {
  const t = useTranslations('Console.dashboard')
  const format = useFormatter()
  const stats = [
    { key: 'views', icon: Eye, value: post.viewCount },
    { key: 'likes', icon: Heart, value: post.likeCount },
    { key: 'comments', icon: MessageCircle, value: post.commentCount },
  ]
  return (
    <li className="group flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent/60">
      <span className={cn('w-5 shrink-0 text-center text-sm font-semibold tabular-nums', rank <= 3 ? 'text-primary' : 'text-muted-foreground')}>
        {rank}
      </span>
      <div className="grid min-w-0 flex-1 gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <Link href={getPostUrl({ post })} target="_blank" prefetch={false} className="truncate text-sm font-medium hover:text-primary hover:underline">
            {post.title}
          </Link>
          {post.isPrivate && <Badge variant="secondary" className="shrink-0">{t('badge_private')}</Badge>}
          {post.hasDraft && <Badge variant="outline" className="shrink-0">{t('badge_draft')}</Badge>}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
          {stats.map(stat => (
            <span key={stat.key} className="flex items-center gap-1" title={t(`post_${stat.key}`)}>
              <stat.icon className="size-3" aria-hidden="true" />
              <span className="sr-only">{t(`post_${stat.key}`)}</span>
              {format.number(stat.value, { notation: 'compact' })}
            </span>
          ))}
        </div>
      </div>
      <PostMetric post={post} metric={metric} />
      <Button asChild variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100">
        <Link href={getPostEditUrl(post)} aria-label={t('edit_post')} title={t('edit_post')}>
          <Pencil className="size-3.5" />
        </Link>
      </Button>
    </li>
  )
}

function PostMetric({ post, metric }: { post: DashboardPost, metric: PostListMetric }) {
  const t = useTranslations('Console.dashboard')
  const format = useFormatter()
  // 显式传入当前时间，避免 next-intl 的 ENVIRONMENT_FALLBACK，并每分钟刷新相对时间
  const now = useNow({ updateInterval: 60_000 })
  if (metric === 'createdAt' || metric === 'updatedAt') {
    const date = new Date(post[metric])
    return (
      <time dateTime={post[metric]} title={format.dateTime(date, { dateStyle: 'medium', timeStyle: 'short' })} className="shrink-0 text-xs text-muted-foreground">
        {format.relativeTime(date, now)}
      </time>
    )
  }
  const Icon = metric === 'heat' ? Flame : Eye
  return (
    <span className="flex shrink-0 items-center gap-1 text-sm font-semibold tabular-nums" title={t(`post_${metric}`)}>
      <Icon className="size-3.5 text-primary" aria-hidden="true" />
      <span className="sr-only">{t(`post_${metric}`)}</span>
      {format.number(post[metric], { notation: 'compact' })}
    </span>
  )
}
