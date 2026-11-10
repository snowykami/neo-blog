'use client'

import type { VisitInsights } from '@/models/visit'
import { ArrowRightIcon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { SourceIcon, SourceName } from '@/components/console/visit-icons'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Link } from '@/i18n/navigation'
import { getPostUrl } from '@/utils/common/route'
import { formatDuration } from './format'
import { BarListCard, StatCard } from './insights-parts'

// 访客统计 · 内容：新老访客、阅读参与度、文章阅读表现、站内路径、外链与下载
export function InsightsContentTab({ data }: { data: VisitInsights }) {
  const t = useTranslations('Console.visit_insights')
  const format = useFormatter()
  const percent = (value: number, total: number) => format.number(total ? value / total : 0, { style: 'percent', maximumFractionDigits: 1 })
  const visitors = data.newVisitors + data.returningVisitors
  const e = data.engagement

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('new_visitors')} value={format.number(data.newVisitors)} hint={t('share_of_visitors', { percent: percent(data.newVisitors, visitors) })} />
        <StatCard label={t('returning_visitors')} value={format.number(data.returningVisitors)} hint={t('share_of_visitors', { percent: percent(data.returningVisitors, visitors) })} />
        <StatCard label={t('avg_engaged')} value={e.visits ? formatDuration(e.avgEngagedMs) : '—'} hint={t('median_engaged', { time: formatDuration(e.medianEngaged) })} />
        <StatCard label={t('completion_rate')} value={percent(e.completed, e.visits)} hint={t('completion_hint', { count: e.completed, total: e.visits, depth: e.avgScrollDepth })} />
      </div>
      <PostsCard data={data} />
      <div className="grid gap-4 lg:grid-cols-2">
        <BarListCard title={t('depth_title')} description={t('depth_hint')} items={e.depthBuckets.map(item => ({ ...item, name: `${item.name}%` }))} total={e.visits} />
        <PathsCard data={data} />
        <BarListCard title={t('outbound_title')} description={t('outbound_hint')} items={data.outbound} total={data.outbound.reduce((sum, item) => sum + item.count, 0)} wide />
        <BarListCard title={t('downloads_title')} description={t('downloads_hint')} items={data.downloads} total={data.downloads.reduce((sum, item) => sum + item.count, 0)} wide />
      </div>
    </div>
  )
}

// 文章阅读表现：浏览量之外，看停留时长、读完率与互动率
function PostsCard({ data }: { data: VisitInsights }) {
  const t = useTranslations('Console.visit_insights')
  const format = useFormatter()
  const percent = (value: number, total: number) => total ? format.number(value / total, { style: 'percent', maximumFractionDigits: 0 }) : '—'
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle>{t('posts_title')}</CardTitle>
        <CardDescription>{t('posts_hint')}</CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        {data.posts.length === 0
          ? <Empty className="py-6"><EmptyDescription>{t('empty')}</EmptyDescription></Empty>
          : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('col_post')}</TableHead>
                    <TableHead className="text-right">{t('col_views')}</TableHead>
                    <TableHead className="text-right">{t('col_read_time')}</TableHead>
                    <TableHead className="text-right">{t('col_depth')}</TableHead>
                    <TableHead className="text-right">{t('col_completion')}</TableHead>
                    <TableHead className="text-right">{t('col_interaction')}</TableHead>
                    <TableHead>{t('col_source')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.posts.map(post => (
                    <TableRow key={post.id}>
                      <TableCell className="max-w-64 truncate">
                        <Link href={getPostUrl({ post })} target="_blank" className="hover:text-primary hover:underline" title={post.title}>{post.title}</Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{format.number(post.views)}</TableCell>
                      <TableCell className="text-right tabular-nums">{post.engagedVisits ? formatDuration(post.avgEngagedMs) : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{post.engagedVisits ? `${post.avgScrollDepth}%` : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{percent(post.completed, post.engagedVisits)}</TableCell>
                      <TableCell className="text-right tabular-nums" title={t('interaction_tip', { likes: post.likes, comments: post.comments })}>{percent(post.likes + post.comments, post.views)}</TableCell>
                      <TableCell>
                        {post.topSource
                          ? (
                              <span className="flex items-center gap-1.5 text-sm">
                                <SourceIcon source={post.topSource} className="size-3.5" />
                                <SourceName source={post.topSource} host={post.topSourceHost} />
                              </span>
                            )
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
      </CardContent>
    </Card>
  )
}

// 站内路径：读者看完一个页面后去了哪里
function PathsCard({ data }: { data: VisitInsights }) {
  const t = useTranslations('Console.visit_insights')
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle>{t('paths_title')}</CardTitle>
        <CardDescription>{t('paths_hint')}</CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        {data.paths.length === 0
          ? <p className="py-2 text-sm text-muted-foreground">{t('empty')}</p>
          : (
              <ul className="grid gap-1.5">
                {data.paths.map(item => (
                  <li key={`${item.from}-${item.to}`} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_3rem] items-center gap-2 text-sm">
                    <span className="truncate font-mono text-xs" title={item.from}>{item.from}</span>
                    <ArrowRightIcon className="size-3.5 text-muted-foreground" />
                    <span className="truncate font-mono text-xs" title={item.to}>{item.to}</span>
                    <span className="text-right text-xs text-muted-foreground tabular-nums">{item.count}</span>
                  </li>
                ))}
              </ul>
            )}
      </CardContent>
    </Card>
  )
}
