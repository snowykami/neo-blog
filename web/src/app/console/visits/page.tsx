'use client'

import type { VisitLog, Visitor, VisitSourceCount, VisitStats } from '@/models/visit'
import { XIcon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import { parseAsInteger, parseAsStringEnum, useQueryState } from 'nuqs'
import { useEffect, useState } from 'react'
import { getVisitorAdmin, getVisitStatsAdmin, listVisitsAdmin } from '@/api/admin'
import { PageSizeSelector, PaginationController } from '@/components/common/pagination'
import { BrowserIcon, OsIcon, SOURCE_NAMES, SourceIcon } from '@/components/console/visit-icons'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getAvatarOrGravatarUrlFromUser } from '@/utils/common/gravatar'
import { getPageUrl, getPostUrl } from '@/utils/common/route'
import { getFirstCharFromUser } from '@/utils/common/username'

const KINDS = ['all', 'user', 'anonymous'] as const
type Kind = (typeof KINDS)[number]

export default function VisitsPage() {
  const t = useTranslations('Console.visits')
  const metricsT = useTranslations('Metrics')
  const [kind, setKind] = useQueryState('kind', parseAsStringEnum<Kind>([...KINDS]).withDefault('all').withOptions({ history: 'replace', clearOnDefault: true }))
  const [visitorId, setVisitorId] = useQueryState('visitor', parseAsInteger.withOptions({ history: 'replace' }))
  // 按来源筛选：其他网站（external）再按域名区分
  const [source, setSource] = useQueryState('source', { history: 'replace' })
  const [sourceHost, setSourceHost] = useQueryState('source_host', { history: 'replace' })
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1).withOptions({ history: 'replace', clearOnDefault: true }))
  const [size, setSize] = useState(20)
  const [visits, setVisits] = useState<VisitLog[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState<VisitStats | null>(null)
  const [visitor, setVisitor] = useState<Visitor | null>(null)
  // 权限由控制台布局统一校验（仅管理员可进入）

  useEffect(() => {
    getVisitStatsAdmin().then(res => setStats(res.data)).catch(() => setStats(null))
  }, [])

  useEffect(() => {
    setLoading(true)
    listVisitsAdmin({ page, size, kind, visitorId: visitorId ?? undefined, source: source ?? undefined, sourceHost: sourceHost ?? undefined })
      .then((res) => {
        setVisits(res.data.visits)
        setTotal(res.data.total)
      })
      .catch(() => setVisits([]))
      .finally(() => setLoading(false))
  }, [page, size, kind, visitorId, source, sourceHost])

  useEffect(() => {
    if (!visitorId) {
      setVisitor(null)
      return
    }
    getVisitorAdmin(visitorId).then(res => setVisitor(res.data)).catch(() => setVisitor(null))
  }, [visitorId])

  const changeKind = (value: string) => {
    setKind(value as Kind)
    setPage(1)
  }
  // 选择或清除单个访客，切换后回到第一页
  const selectVisitor = (id: number | null) => {
    setVisitorId(id)
    setPage(1)
  }
  // 选择或清除来源筛选，再次点击当前来源则取消
  const selectSource = (item: Pick<VisitSourceCount, 'source' | 'host'> | null) => {
    const same = item && item.source === source && (item.host || null) === sourceHost
    setSource(item && !same ? item.source : null)
    setSourceHost(item && !same ? item.host || null : null)
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

      {/* 今日来源排行，点击按来源筛选 */}
      {stats && stats.todaySources.length > 0 && (
        <Card className="gap-2 px-4 py-3">
          <div className="text-xs text-muted-foreground">{t('today_sources')}</div>
          <div className="flex flex-wrap gap-2">
            {stats.todaySources.map(item => (
              <button
                key={`${item.source}-${item.host}`}
                type="button"
                onClick={() => selectSource(item)}
                className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-sm transition-colors hover:bg-accent ${item.source === source && (item.host || null) === sourceHost ? 'border-primary text-primary' : ''}`}
              >
                <SourceIcon source={item.source} className="size-3.5" />
                <SourceName source={item.source} host={item.host} />
                <span className="tabular-nums text-muted-foreground">{item.count}</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={kind} onValueChange={changeKind}>
          <TabsList>
            {KINDS.map(item => <TabsTrigger key={item} value={item}>{t(`kind_${item}`)}</TabsTrigger>)}
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-center gap-2">
          {source && (
            <Badge variant="secondary" className="gap-1">
              <SourceIcon source={source} className="size-3" />
              <SourceName source={source} host={sourceHost ?? ''} />
              <button type="button" aria-label={t('clear')} className="cursor-pointer" onClick={() => selectSource(null)}>
                <XIcon className="size-3" />
              </button>
            </Badge>
          )}
          {visitorId && (
            <Badge variant="secondary" className="gap-1">
              {t('viewing_visitor', { id: visitorId })}
              <button type="button" aria-label={t('clear')} className="cursor-pointer" onClick={() => selectVisitor(null)}>
                <XIcon className="size-3" />
              </button>
            </Badge>
          )}
        </div>
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
        {total > 0 && <PaginationController page={page} onPageChange={setPage} total={total} pageSize={size} />}
        <PageSizeSelector size={size} onSizeChange={changeSize} />
        {' '}
        {metricsT('per_page')}
      </div>
    </div>
  )
}

// 来源名称：常见平台显示品牌名，其他网站显示域名
function SourceName({ source, host }: { source: string, host: string }) {
  const t = useTranslations('Console.visits')
  if (source === 'direct')
    return <>{t('source_direct')}</>
  if (source === 'internal')
    return <>{t('source_internal')}</>
  if (source === 'external')
    return <>{host || t('source_external')}</>
  return <>{SOURCE_NAMES[source] ?? source}</>
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
  // 站内跳转显示来源路径；没有来源分类的旧记录回退为显示来源域名
  const referrerUrl = (() => {
    try {
      return visit.referrer ? new URL(visit.referrer) : null
    }
    catch {
      return null
    }
  })()
  const legacySource = !visit.source && referrerUrl
    ? (referrerUrl.origin === window.location.origin ? referrerUrl.pathname : referrerUrl.host)
    : ''

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
        {visit.source && (
          <span className="flex items-center gap-1" title={visit.referrer || undefined}>
            <SourceIcon source={visit.source} className="size-3" />
            <SourceName source={visit.source} host={visit.sourceHost} />
            {visit.source === 'internal' && referrerUrl && <span className="font-mono">{referrerUrl.pathname}</span>}
          </span>
        )}
        {legacySource && <span>{t('from', { source: legacySource })}</span>}
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
