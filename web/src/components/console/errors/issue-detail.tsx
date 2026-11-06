'use client'

import type { ErrorEventSummary, ErrorIssueDetail, ErrorStatus, NamedCount } from '@/models/error-report'
import { CheckIcon, ChevronLeftIcon, EyeOffIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { deleteErrorIssueAdmin, getErrorIssueAdmin, listErrorEventsAdmin, updateErrorIssueStatusAdmin } from '@/api/admin'
import { PaginationController } from '@/components/common/pagination'
import { BrowserIcon, OsIcon } from '@/components/console/visit-icons'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { consolePath } from '@/utils/common/route'
import { IssueBadges, LevelDot } from './error-badges'
import { ErrorEventDetail } from './event-detail'

const EVENT_PAGE_SIZE = 10

// 后台：一个错误问题的详情，左侧为保存的事件列表，右侧为选中事件的现场
export function ErrorIssueView() {
  const t = useTranslations('Console.errors.detail')
  const { id } = useParams() as { id: string }
  const issueId = Number(id)
  const [issue, setIssue] = useState<ErrorIssueDetail | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [events, setEvents] = useState<ErrorEventSummary[]>([])
  const [eventTotal, setEventTotal] = useState(0)
  const [eventPage, setEventPage] = useState(1)
  const [selected, setSelected] = useState<number | null>(null)

  const loadIssue = useCallback(() => {
    return getErrorIssueAdmin(issueId)
      .then((res) => {
        setIssue(res.data)
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
  }, [issueId])

  useEffect(() => {
    setStatus('loading')
    loadIssue()
  }, [loadIssue])

  useEffect(() => {
    listErrorEventsAdmin(issueId, { page: eventPage, size: EVENT_PAGE_SIZE })
      .then((res) => {
        setEvents(res.data.events)
        setEventTotal(res.data.total)
        setSelected(current => current != null && res.data.events.some(e => e.id === current) ? current : res.data.events[0]?.id ?? null)
      })
      .catch(() => setEvents([]))
  }, [issueId, eventPage])

  return (
    <div className="grid gap-4">
      <Link href={consolePath.error} className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeftIcon className="size-4" />
        {t('back')}
      </Link>
      {status === 'loading' && <Skeleton className="h-40 w-full" />}
      {status === 'error' && <p className="py-8 text-center text-muted-foreground">{t('not_found')}</p>}
      {status === 'ready' && issue && (
        <>
          <OverviewCard issue={issue} onChanged={loadIssue} />
          <BreakdownCard issue={issue} />
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
            <Card className="gap-0 py-2">
              <div className="px-4 py-2 text-sm font-medium">{t('events', { count: eventTotal })}</div>
              {events.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('no_events')}</p>}
              {events.map(event => (
                <EventRow key={event.id} event={event} active={event.id === selected} onSelect={() => setSelected(event.id)} />
              ))}
              {eventTotal > EVENT_PAGE_SIZE && (
                <div className="flex justify-center pt-2">
                  <PaginationController page={eventPage} onPageChange={setEventPage} total={eventTotal} pageSize={EVENT_PAGE_SIZE} />
                </div>
              )}
            </Card>
            {selected != null ? <ErrorEventDetail key={selected} eventId={selected} /> : <Card className="px-4 py-8 text-center text-sm text-muted-foreground">{t('select_event')}</Card>}
          </div>
        </>
      )}
    </div>
  )
}

function OverviewCard({ issue, onChanged }: { issue: ErrorIssueDetail, onChanged: () => void }) {
  const t = useTranslations('Console.errors')
  const detailT = useTranslations('Console.errors.detail')
  const format = useFormatter()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const title = issue.kind === 'crash' || issue.kind === 'discarded' ? t(`kind_title_${issue.kind}`) : issue.title

  const changeStatus = (next: ErrorStatus) => {
    setBusy(true)
    updateErrorIssueStatusAdmin(issue.id, next)
      .then(() => {
        toast.success(detailT('updated'))
        onChanged()
      })
      .catch(() => toast.error(detailT('update_failed')))
      .finally(() => setBusy(false))
  }
  const remove = () => {
    setBusy(true)
    deleteErrorIssueAdmin(issue.id)
      .then(() => {
        toast.success(detailT('deleted'))
        router.push(consolePath.error)
      })
      .catch(() => toast.error(detailT('update_failed')))
      .finally(() => setBusy(false))
  }
  const time = (value: string) => (
    <time dateTime={value} title={format.dateTime(new Date(value), { dateStyle: 'medium', timeStyle: 'medium' })}>
      {format.relativeTime(new Date(value))}
    </time>
  )

  return (
    <Card className="gap-3 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <LevelDot level={issue.level} />
            <h2 className="min-w-0 text-lg font-semibold break-words">{title}</h2>
            <IssueBadges issue={issue} />
          </div>
          {issue.kind !== 'error' && issue.kind !== 'message' && <p className="text-sm text-muted-foreground">{t(`kind_hint_${issue.kind}`)}</p>}
          {issue.culprit && <p className="font-mono text-sm break-all text-muted-foreground">{issue.culprit}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {issue.status === 'unresolved'
            ? (
                <>
                  <Button size="sm" disabled={busy} onClick={() => changeStatus('resolved')}>
                    <CheckIcon />
                    {detailT('resolve')}
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => changeStatus('ignored')}>
                    <EyeOffIcon />
                    {detailT('ignore')}
                  </Button>
                </>
              )
            : (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => changeStatus('unresolved')}>
                  <RotateCcwIcon />
                  {detailT('reopen')}
                </Button>
              )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost" disabled={busy} aria-label={detailT('delete')}>
                <Trash2Icon />
                {detailT('delete')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{detailT('delete_title')}</AlertDialogTitle>
                <AlertDialogDescription>{detailT('delete_description')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{detailT('cancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={remove}>{detailT('delete')}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <Stat label={detailT('count')} value={issue.count} />
        <Stat label={detailT('stored_events')} value={issue.storedEvents} />
        <Stat label={detailT('visitors')} value={issue.visitors} />
        <Stat label={detailT('first_seen')} value={time(issue.firstSeenAt)} />
        <Stat label={detailT('last_seen')} value={time(issue.lastSeenAt)} />
        <Stat label={detailT('release')} value={issue.lastRelease ? <span className="font-mono">{issue.lastRelease.slice(0, 12)}</span> : '—'} />
      </dl>
    </Card>
  )
}

function Stat({ label, value }: { label: string, value: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  )
}

// 保存的事件中浏览器、系统与页面的分布
function BreakdownCard({ issue }: { issue: ErrorIssueDetail }) {
  const t = useTranslations('Console.errors.detail')
  const groups: { key: string, items: NamedCount[] }[] = [
    { key: 'browsers', items: issue.browsers },
    { key: 'os', items: issue.os },
    { key: 'paths', items: issue.paths },
  ].filter(group => group.items.length > 0)
  if (groups.length === 0)
    return null
  return (
    <Card className="grid gap-4 px-4 py-4 md:grid-cols-3">
      {groups.map(group => (
        <div key={group.key} className="grid content-start gap-1.5">
          <div className="text-xs text-muted-foreground">{t(group.key)}</div>
          {group.items.map(item => (
            <div key={item.name} className="flex items-center gap-2 text-sm">
              {group.key === 'browsers' && <BrowserIcon browser={item.name} className="size-3.5 shrink-0" />}
              {group.key === 'os' && <OsIcon os={item.name} deviceType="" className="size-3.5 shrink-0" />}
              <span className={cn('min-w-0 truncate', group.key === 'paths' && 'font-mono text-xs')}>{item.name}</span>
              <span className="ml-auto tabular-nums text-muted-foreground">{item.count}</span>
            </div>
          ))}
        </div>
      ))}
    </Card>
  )
}

function EventRow({ event, active, onSelect }: { event: ErrorEventSummary, active: boolean, onSelect: () => void }) {
  const t = useTranslations('Console.errors.detail')
  const format = useFormatter()
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn('grid w-full cursor-pointer gap-0.5 px-4 py-2 text-left text-sm transition-colors hover:bg-accent/50', active && 'bg-accent')}
    >
      <span className="flex items-center gap-2">
        <time dateTime={event.createdAt} className="font-medium">{format.dateTime(new Date(event.createdAt), { dateStyle: 'short', timeStyle: 'medium' })}</time>
        {event.anonymous && <Badge variant="outline" className="px-1 text-[10px]">{t('anonymous')}</Badge>}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        {event.os && <OsIcon os={event.os} deviceType={event.deviceType} className="size-3.5 shrink-0" />}
        {event.browser && <BrowserIcon browser={event.browser} className="size-3.5 shrink-0" />}
        <span className="min-w-0 truncate">{[event.browser && `${event.browser} ${event.browserVersion}`.trim(), event.location].filter(Boolean).join(' · ')}</span>
      </span>
      {event.path && <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{[event.method, event.path].filter(Boolean).join(' ')}</span>}
    </button>
  )
}
