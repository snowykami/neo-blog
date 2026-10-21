'use client'

import type { VisitLog, Visitor, VisitStats } from '@/models/visit'
import { XIcon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import { parseAsInteger, parseAsStringEnum, useQueryState } from 'nuqs'
import { useEffect, useState } from 'react'
import { getVisitorAdmin, getVisitStatsAdmin, listVisitsAdmin } from '@/api/admin'
import Forbidden from '@/components/common/forbidden'
import { PageSizeSelector, PaginationController } from '@/components/common/pagination'
import { BrowserIcon, OsIcon } from '@/components/console/visit-icons'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/contexts/auth-context'
import { getAvatarOrGravatarUrlFromUser } from '@/utils/common/gravatar'
import { isAdmin } from '@/utils/common/permission'
import { getPageUrl, getPostUrl } from '@/utils/common/route'
import { getFirstCharFromUser } from '@/utils/common/username'

const KINDS = ['all', 'user', 'anonymous'] as const
type Kind = (typeof KINDS)[number]

export default function VisitsPage() {
  const t = useTranslations('Console.visits')
  const metricsT = useTranslations('Metrics')
  const { user } = useAuth()
  const [kind, setKind] = useQueryState('kind', parseAsStringEnum<Kind>([...KINDS]).withDefault('all').withOptions({ history: 'replace', clearOnDefault: true }))
  const [visitorId, setVisitorId] = useQueryState('visitor', parseAsInteger.withOptions({ history: 'replace' }))
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1).withOptions({ history: 'replace', clearOnDefault: true }))
  const [size, setSize] = useState(20)
  const [visits, setVisits] = useState<VisitLog[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState<VisitStats | null>(null)
  const [visitor, setVisitor] = useState<Visitor | null>(null)
  const canView = !!user && isAdmin({ user })

  useEffect(() => {
    if (canView)
      getVisitStatsAdmin().then(res => setStats(res.data)).catch(() => setStats(null))
  }, [canView])

  useEffect(() => {
    if (!canView)
      return
    setLoading(true)
    listVisitsAdmin({ page, size, kind, visitorId: visitorId ?? undefined })
      .then((res) => {
        setVisits(res.data.visits)
        setTotal(res.data.total)
      })
      .catch(() => setVisits([]))
      .finally(() => setLoading(false))
  }, [canView, page, size, kind, visitorId])

  useEffect(() => {
    if (!canView || !visitorId) {
      setVisitor(null)
      return
    }
    getVisitorAdmin(visitorId).then(res => setVisitor(res.data)).catch(() => setVisitor(null))
  }, [canView, visitorId])

  if (!canView)
    return <Forbidden />

  const changeKind = (value: string) => {
    setKind(value as Kind)
    setPage(1)
  }
  // 选择或清除单个访客，切换后回到第一页
  const selectVisitor = (id: number | null) => {
    setVisitorId(id)
    setPage(1)
  }
  const changeSize = (nextSize: number) => {
    setSize(nextSize)
    setPage(1)
  }

  const statItems = stats
    ? [
        { label: t('today_pv'), value: stats.todayPv },
        { label: t('today_uv'), value: stats.todayUv },
        { label: t('today_user_visits'), value: stats.todayUserVisits },
        { label: t('total_visitors'), value: stats.totalVisitors },
      ]
    : []

  return (
    <div className="grid gap-4">
      {/* 今日统计 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {statItems.map(item => (
          <Card key={item.label} className="gap-1 px-4 py-3">
            <div className="text-xs text-muted-foreground">{item.label}</div>
            <div className="text-2xl font-semibold tabular-nums">{item.value}</div>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={kind} onValueChange={changeKind}>
          <TabsList>
            {KINDS.map(item => <TabsTrigger key={item} value={item}>{t(`kind_${item}`)}</TabsTrigger>)}
          </TabsList>
        </Tabs>
        {visitorId && (
          <Badge variant="secondary" className="gap-1">
            {t('viewing_visitor', { id: visitorId })}
            <button type="button" aria-label={t('clear')} className="cursor-pointer" onClick={() => selectVisitor(null)}>
              <XIcon className="size-3" />
            </button>
          </Badge>
        )}
      </div>

      {/* 单个访客详情 */}
      {visitor && <VisitorCard visitor={visitor} />}

      <Separator />
      <div>
        {loading && <p className="py-8 text-center text-muted-foreground">{t('loading')}</p>}
        {!loading && visits.length === 0 && <p className="py-8 text-center text-muted-foreground">{t('empty')}</p>}
        {!loading && visits.map(visit => (
          <div key={visit.id}>
            <VisitRow visit={visit} onSelectVisitor={selectVisitor} />
            <Separator />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-center py-2">
        {total > 0 && <PaginationController initialPage={page} onPageChange={setPage} total={total} pageSize={size} />}
        <PageSizeSelector initialSize={size} onSizeChange={changeSize} />
        {' '}
        {metricsT('per_page')}
      </div>
    </div>
  )
}

// 访问者展示：登录用户显示头像昵称，匿名访客显示系统图标、归属地与浏览器
function VisitorIdentity({ user, os, browser, deviceType, location }: Pick<VisitLog, 'user' | 'os' | 'browser' | 'deviceType' | 'location'>) {
  const t = useTranslations('Console.visits')
  if (user) {
    return (
      <span className="flex items-center gap-2 font-medium">
        <Avatar className="size-6">
          <AvatarImage src={getAvatarOrGravatarUrlFromUser({ user, size: 48 })} alt={user.nickname || user.username} />
          <AvatarFallback className="text-xs">{getFirstCharFromUser(user)}</AvatarFallback>
        </Avatar>
        {user.nickname || user.username}
      </span>
    )
  }
  return (
    <span className="flex items-center gap-2 font-medium">
      <OsIcon os={os} deviceType={deviceType} className="size-5 text-muted-foreground" />
      {location || t('unknown_location')}
      <span className="flex items-center gap-1 text-sm font-normal text-muted-foreground">
        <BrowserIcon browser={browser} className="size-3.5" />
        {browser || t('unknown_device')}
      </span>
    </span>
  )
}

function VisitRow({ visit, onSelectVisitor }: { visit: VisitLog, onSelectVisitor: (id: number) => void }) {
  const t = useTranslations('Console.visits')
  const format = useFormatter()
  const target = visit.targetType === 'post'
    ? { href: getPostUrl({ post: { id: visit.targetId, slug: visit.targetSlug || null } }), text: visit.targetTitle, key: 'visited_post' }
    : visit.targetType === 'page'
      ? { href: getPageUrl({ id: visit.targetId, slug: visit.targetSlug || null }), text: visit.targetTitle, key: 'visited_page' }
      : { href: visit.path, text: visit.path, key: 'visited_path' }
  const source = (() => {
    if (!visit.referrer)
      return ''
    try {
      const url = new URL(visit.referrer)
      return url.origin === window.location.origin ? url.pathname : url.host
    }
    catch {
      return ''
    }
  })()

  return (
    <div className="flex flex-col gap-1 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {visit.visitorId
          ? (
              <button type="button" className="cursor-pointer hover:text-primary" title={t('view_visitor')} onClick={() => onSelectVisitor(visit.visitorId!)}>
                <VisitorIdentity {...visit} />
              </button>
            )
          : (
              <>
                <VisitorIdentity {...visit} />
                <Badge variant="outline" className="text-xs">{t('do_not_track')}</Badge>
              </>
            )}
        <span className="text-muted-foreground">
          {t.rich(target.key as 'visited_post', {
            title: target.text || t('target_deleted'),
            link: chunks => <Link href={target.href} target="_blank" className="font-medium text-foreground hover:text-primary hover:underline">{chunks}</Link>,
          })}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
        <time dateTime={visit.createdAt} title={format.dateTime(new Date(visit.createdAt), { dateStyle: 'medium', timeStyle: 'medium' })}>
          {format.relativeTime(new Date(visit.createdAt))}
        </time>
        {source && <span>{t('from', { source })}</span>}
        {visit.ip && <span className="font-mono">{visit.ip}</span>}
        {visit.visitorId && <span>{t('visit_count', { count: visit.visitCount })}</span>}
      </div>
    </div>
  )
}

function VisitorCard({ visitor }: { visitor: Visitor }) {
  const t = useTranslations('Console.visits')
  const format = useFormatter()
  const time = (value: string) => format.dateTime(new Date(value), { dateStyle: 'medium', timeStyle: 'short' })
  return (
    <Card className="gap-2 px-4 py-3 text-sm">
      <VisitorIdentity user={visitor.user} os={visitor.os} browser={visitor.browser} deviceType={visitor.deviceType} location={visitor.location} />
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{t('first_seen', { time: time(visitor.firstSeenAt) })}</span>
        <span>{t('last_seen', { time: time(visitor.lastSeenAt) })}</span>
        <span>{t('visit_count', { count: visitor.visitCount })}</span>
        {visitor.ip && <span className="font-mono">{visitor.ip}</span>}
        {visitor.user && <span>{t('linked_user', { name: visitor.user.nickname || visitor.user.username })}</span>}
      </div>
    </Card>
  )
}
