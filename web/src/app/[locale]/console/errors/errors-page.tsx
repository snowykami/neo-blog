'use client'

import type { ErrorIssue, ErrorKind, ErrorSource, ErrorStatus } from '@/models/error-report'
import { SearchIcon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { parseAsInteger, parseAsStringEnum, useQueryState } from 'nuqs'
import { useEffect, useState } from 'react'
import { getErrorStatsAdmin, listErrorIssuesAdmin } from '@/api/admin'
import { PageSizeSelector, PaginationController } from '@/components/common/pagination'
import { IssueBadges, LevelDot } from '@/components/console/errors/error-badges'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useConsoleQuery } from '@/hooks/use-console-query'
import { Link } from '@/i18n/navigation'
import { ERROR_KINDS, ERROR_SOURCES, ERROR_STATUSES } from '@/models/error-report'
import { consolePath } from '@/utils/common/route'

// Select 与 Tabs 不允许空值，「全部」用占位值表示
const ALL = 'all'
const STATUS_TABS = [...ERROR_STATUSES, ALL] as const
type StatusTab = (typeof STATUS_TABS)[number]

// 后台：错误报告的问题列表（浏览器、Next.js 服务端与后端的错误按指纹聚合），默认只看未处理的
export default function ErrorsPage() {
  const t = useTranslations('Console.errors')
  const metricsT = useTranslations('Metrics')
  const [status, setStatus] = useQueryState('status', parseAsStringEnum<StatusTab>([...STATUS_TABS]).withDefault('unresolved').withOptions({ history: 'replace', clearOnDefault: true }))
  const [source, setSource] = useQueryState('source', parseAsStringEnum<ErrorSource>([...ERROR_SOURCES]).withOptions({ history: 'replace' }))
  const [kind, setKind] = useQueryState('kind', parseAsStringEnum<ErrorKind>([...ERROR_KINDS]).withOptions({ history: 'replace' }))
  const [query, setQuery] = useQueryState('q', { history: 'replace', defaultValue: '', clearOnDefault: true })
  const [keyword, setKeyword] = useState(query)
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1).withOptions({ history: 'replace', clearOnDefault: true }))
  const [size, setSize] = useState(20)
  // 回到这个页面时先显示上次的结果，同时重新请求（见 hooks/use-console-query.ts）；写操作后缓存会被清空
  const statsQuery = useConsoleQuery(['admin/errors/stats'], () => getErrorStatsAdmin().then(res => res.data))
  const stats = statsQuery.error ? null : (statsQuery.data ?? null)
  const statusFilter = status === ALL ? undefined : status as ErrorStatus
  const issuesQuery = useConsoleQuery(
    ['admin/errors', page, size, statusFilter, source, kind, query],
    () => listErrorIssuesAdmin({ page, size, status: statusFilter, source: source ?? undefined, kind: kind ?? undefined, q: query || undefined }).then(res => res.data),
  )
  // 请求失败时显示为空列表（同改前）；有上次的数据时照常显示，后台刷新不再换成「加载中」
  const issues = issuesQuery.error ? [] : (issuesQuery.data?.issues ?? [])
  const total = issuesQuery.error ? 0 : (issuesQuery.data?.total ?? 0)
  const loading = issuesQuery.loading && !issuesQuery.data

  // 输入停顿后再搜索
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (keyword.trim() !== query) {
        setQuery(keyword.trim())
        setPage(1)
      }
    }, 400)
    return () => window.clearTimeout(timer)
  }, [keyword, query, setPage, setQuery])

  const changeStatus = (value: string) => {
    setStatus(value as StatusTab)
    setPage(1)
  }
  const changeSource = (value: string) => {
    setSource(value === ALL ? null : value as ErrorSource)
    setPage(1)
  }
  const changeKind = (value: string) => {
    setKind(value === ALL ? null : value as ErrorKind)
    setPage(1)
  }
  const changeSize = (nextSize: number) => {
    setSize(nextSize)
    setPage(1)
  }

  return (
    <div className="grid gap-4">
      {stats && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card className="gap-1 px-4 py-3">
            <div className="text-xs text-muted-foreground">{t('stats_unresolved')}</div>
            <div className="text-2xl font-semibold tabular-nums">{stats.unresolved}</div>
          </Card>
          <Card className="gap-1 px-4 py-3">
            <div className="text-xs text-muted-foreground">{t('stats_active_24h')}</div>
            <div className="text-2xl font-semibold tabular-nums">{stats.activeLastDay}</div>
          </Card>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={status} onValueChange={changeStatus}>
          <TabsList>
            {STATUS_TABS.map(item => <TabsTrigger key={item} value={item}>{t(`status_${item}`)}</TabsTrigger>)}
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={source ?? ALL} onValueChange={changeSource}>
            <SelectTrigger size="sm" aria-label={t('filter_source')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('source_all')}</SelectItem>
              {ERROR_SOURCES.map(item => <SelectItem key={item} value={item}>{t(`source_${item}`)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={kind ?? ALL} onValueChange={changeKind}>
            <SelectTrigger size="sm" aria-label={t('filter_kind')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('kind_all')}</SelectItem>
              {ERROR_KINDS.map(item => <SelectItem key={item} value={item}>{t(`kind_${item}`)}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder={t('search_placeholder')} aria-label={t('search_placeholder')} className="h-8 w-64 pl-8" />
          </div>
        </div>
      </div>

      <Separator />
      <div>
        {loading && <p className="py-8 text-center text-muted-foreground">{t('loading')}</p>}
        {!loading && issues.length === 0 && <p className="py-8 text-center text-muted-foreground">{t('empty')}</p>}
        {!loading && issues.map(issue => (
          <div key={issue.id}>
            <IssueRow issue={issue} />
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

function IssueRow({ issue }: { issue: ErrorIssue }) {
  const t = useTranslations('Console.errors')
  const format = useFormatter()
  return (
    <Link href={`${consolePath.error}/${issue.id}`} className="grid gap-1 px-1 py-3 transition-colors hover:bg-accent/50">
      <div className="flex min-w-0 items-center gap-2">
        <LevelDot level={issue.level} />
        <span className="min-w-0 truncate font-medium">{issue.kind === 'crash' || issue.kind === 'discarded' ? t(`kind_title_${issue.kind}`) : issue.title}</span>
        <IssueBadges issue={issue} />
        <span className="ml-auto shrink-0 text-sm tabular-nums text-muted-foreground">{t('count', { count: issue.count })}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 pl-4 text-xs text-muted-foreground">
        {issue.culprit && <span className="min-w-0 font-mono break-all">{issue.culprit}</span>}
        <time dateTime={issue.lastSeenAt} title={format.dateTime(new Date(issue.lastSeenAt), { dateStyle: 'medium', timeStyle: 'medium' })}>
          {t('last_seen', { time: format.relativeTime(new Date(issue.lastSeenAt)) })}
        </time>
        <span>{t('first_seen', { time: format.relativeTime(new Date(issue.firstSeenAt)) })}</span>
        {issue.lastRelease && <span className="font-mono">{issue.lastRelease.slice(0, 8)}</span>}
      </div>
    </Link>
  )
}
