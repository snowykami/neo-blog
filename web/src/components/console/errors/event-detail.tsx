'use client'

import type { ErrorBreadcrumb, ErrorEvent, ErrorException, ErrorFrame } from '@/models/error-report'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { getErrorEventAdmin } from '@/api/admin'
import { UserAvatar } from '@/components/common/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { consolePath, getUserUrl } from '@/utils/common/route'

// 一次错误事件的现场：异常与调用栈（浏览器的帧已还原到源码）、后端 panic 的调用栈、面包屑、附带的应用状态与设备信息
export function ErrorEventDetail({ eventId }: { eventId: number }) {
  const t = useTranslations('Console.errors.detail')
  const format = useFormatter()
  const [event, setEvent] = useState<ErrorEvent | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    getErrorEventAdmin(eventId)
      .then((res) => {
        setEvent(res.data)
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
  }, [eventId])

  if (status === 'loading')
    return <Skeleton className="h-80 w-full" />
  if (status === 'error' || !event)
    return <Card className="px-4 py-8 text-center text-sm text-muted-foreground">{t('not_found')}</Card>

  const detail = event.detail ?? {}
  const exceptions = [...(detail.exception ?? [])].reverse()
  const fields: { label: string, value: React.ReactNode }[] = [
    { label: t('time'), value: format.dateTime(new Date(event.createdAt), { dateStyle: 'medium', timeStyle: 'medium' }) },
    { label: t('report_id'), value: event.eventId ? <span className="font-mono">{event.eventId}</span> : '—' },
    { label: t('page'), value: <span className="font-mono break-all">{detail.request?.url || [event.method, event.path].filter(Boolean).join(' ') || '—'}</span> },
    { label: t('release'), value: event.release ? <span className="font-mono">{event.release}</span> : '—' },
    { label: t('device'), value: [event.os && `${event.os} ${event.osVersion}`.trim(), event.browser && `${event.browser} ${event.browserVersion}`.trim(), event.deviceType].filter(Boolean).join(' · ') || '—' },
    { label: t('location'), value: event.location || '—' },
  ]

  return (
    <div className="grid min-w-0 gap-4">
      <Card className="gap-3 px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 font-medium break-words">{event.message}</h3>
          {event.anonymous && <Badge variant="outline" className="px-1.5 text-[11px]" title={t('anonymous_hint')}>{t('anonymous')}</Badge>}
        </div>
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
          {fields.map(field => (
            <div key={field.label} className="contents">
              <dt className="text-muted-foreground">{field.label}</dt>
              <dd className="min-w-0">{field.value}</dd>
            </div>
          ))}
          {(event.user || event.visitorId) && (
            <div className="contents">
              <dt className="text-muted-foreground">{t('who')}</dt>
              <dd className="flex flex-wrap items-center gap-3">
                {event.user && (
                  <Link href={getUserUrl(event.user)} target="_blank" className="flex items-center gap-1.5 hover:text-primary">
                    <UserAvatar user={event.user} size={40} className="size-5" fallbackClassName="text-[10px]" />
                    {event.user.nickname || event.user.username}
                  </Link>
                )}
                {event.visitorId && <Link href={`${consolePath.visit}?visitor=${event.visitorId}`} className="text-primary hover:underline">{t('view_visitor')}</Link>}
              </dd>
            </div>
          )}
        </dl>
        {event.userAgent && <p className="font-mono text-xs break-all text-muted-foreground">{event.userAgent}</p>}
      </Card>

      {exceptions.map((exception, i) => <ExceptionCard key={i} exception={exception} cause={i > 0} />)}
      {detail.stackText && (
        <Card className="gap-2 px-4 py-4">
          <div className="text-sm font-medium">{t('stack')}</div>
          <pre className="max-h-96 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap">{detail.stackText}</pre>
        </Card>
      )}
      {(detail.breadcrumbs?.length ?? 0) > 0 && <BreadcrumbsCard breadcrumbs={detail.breadcrumbs!} />}
      {detail.contexts && Object.keys(detail.contexts).length > 0 && <ContextsCard contexts={detail.contexts} />}
      {detail.tags && Object.keys(detail.tags).length > 0 && (
        <Card className="gap-2 px-4 py-4">
          <div className="text-sm font-medium">{t('tags')}</div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(detail.tags).map(([key, value]) => (
              <Badge key={key} variant="secondary" className="font-mono text-[11px] font-normal">{`${key}: ${value}`}</Badge>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

// 一个异常：从出错处往外列出调用栈，站内源码的帧展开源码上下文，依赖库的帧默认收起
function ExceptionCard({ exception, cause }: { exception: ErrorException, cause: boolean }) {
  const t = useTranslations('Console.errors.detail')
  const [showAll, setShowAll] = useState(false)
  const frames = [...(exception.stacktrace?.frames ?? [])].reverse()
  const hasApp = frames.some(frame => frame.inApp)
  const visible = showAll || !hasApp ? frames : frames.filter(frame => frame.inApp)
  return (
    <Card className="gap-3 px-4 py-4">
      <div className="grid gap-1">
        {cause && <div className="text-xs text-muted-foreground">{t('caused_by')}</div>}
        <div className="font-mono text-sm font-medium break-words">
          {exception.type}
          {exception.value && <span className="font-normal text-muted-foreground">{`: ${exception.value}`}</span>}
        </div>
        {exception.mechanism && (
          <div className="text-xs text-muted-foreground">
            {t(exception.mechanism.handled === false ? 'unhandled' : 'handled', { mechanism: exception.mechanism.type })}
          </div>
        )}
      </div>
      {frames.length === 0 && <p className="text-sm text-muted-foreground">{t('no_stack')}</p>}
      <div className="grid gap-2">
        {visible.map((frame, i) => <FrameView key={i} frame={frame} expanded={i === 0 || frame.inApp === true} />)}
      </div>
      {hasApp && frames.length !== visible.length && !showAll && (
        <Button size="sm" variant="ghost" className="justify-self-start text-muted-foreground" onClick={() => setShowAll(true)}>
          {t('show_library_frames', { count: frames.length - visible.length })}
        </Button>
      )}
    </Card>
  )
}

function FrameView({ frame, expanded }: { frame: ErrorFrame, expanded: boolean }) {
  const t = useTranslations('Console.errors.detail')
  const location = [frame.filename || frame.absPath, frame.lineno, frame.colno].filter(Boolean).join(':')
  const start = (frame.lineno ?? 1) - (frame.preContext?.length ?? 0)
  const lines = frame.contextLine != null ? [...(frame.preContext ?? []), frame.contextLine, ...(frame.postContext ?? [])] : []
  return (
    <div className={cn('grid gap-1 rounded-md border px-3 py-2', !frame.inApp && 'opacity-70')}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 font-mono text-xs">
        <span className="font-medium">{frame.function || '<anonymous>'}</span>
        <span className="min-w-0 break-all text-muted-foreground">{location}</span>
      </div>
      {expanded && lines.length > 0 && (
        <pre className="overflow-x-auto rounded bg-muted/50 py-1 font-mono text-xs">
          {lines.map((line, i) => {
            const number = start + i
            const current = number === frame.lineno
            return (
              <div key={number} className={cn('flex gap-3 px-2', current && 'bg-amber-500/15')}>
                <span className="w-8 shrink-0 text-right text-muted-foreground select-none">{number}</span>
                <span className="whitespace-pre">{line}</span>
              </div>
            )
          })}
        </pre>
      )}
      {frame.minified && <div className="font-mono text-[11px] break-all text-muted-foreground" title={t('minified_hint')}>{frame.minified}</div>}
    </div>
  )
}

// 面包屑：出错前的路由跳转、点击、请求与控制台警告，按时间先后排列
function BreadcrumbsCard({ breadcrumbs }: { breadcrumbs: ErrorBreadcrumb[] }) {
  const t = useTranslations('Console.errors.detail')
  const format = useFormatter()
  return (
    <Card className="gap-2 px-4 py-4">
      <div className="text-sm font-medium">{t('breadcrumbs')}</div>
      <ol className="grid gap-1 text-xs">
        {breadcrumbs.map((crumb, i) => (
          <li key={i} className="grid grid-cols-[5.5rem_6rem_minmax(0,1fr)] items-baseline gap-2">
            <span className="font-mono text-muted-foreground tabular-nums">
              {crumb.timestamp ? format.dateTime(new Date(crumb.timestamp * 1000), { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}
            </span>
            <span className={cn('truncate', crumb.level === 'error' ? 'text-red-600' : crumb.level === 'warning' ? 'text-amber-600' : 'text-muted-foreground')}>{crumb.category || crumb.type}</span>
            <span className="min-w-0 font-mono break-all">{crumb.message || summarize(crumb.data)}</span>
          </li>
        ))}
      </ol>
    </Card>
  )
}

function summarize(data: Record<string, unknown> | undefined) {
  if (!data)
    return ''
  return Object.entries(data)
    .filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
    .join(' ')
}

// 附带的上下文：崩溃前的状态（crash）、正在播放的歌曲（music）、页面状态与设备信号等，逐项列出
function ContextsCard({ contexts }: { contexts: Record<string, Record<string, unknown>> }) {
  const t = useTranslations('Console.errors.detail')
  return (
    <Card className="gap-3 px-4 py-4">
      <div className="text-sm font-medium">{t('contexts')}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        {Object.entries(contexts).map(([name, values]) => (
          <div key={name} className="grid content-start gap-1">
            <div className="text-xs font-medium text-muted-foreground">{name}</div>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 font-mono text-xs">
              {Object.entries(values ?? {}).filter(([, value]) => value != null && value !== '').map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="text-muted-foreground">{key}</dt>
                  <dd className="break-all">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </Card>
  )
}
