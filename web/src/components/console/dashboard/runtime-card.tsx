'use client'

import type { FrontendMetrics, RuntimeInstance, RuntimeMetrics } from '@/models/misc'
import { ChevronDown } from 'lucide-react'
import { useNow, useTranslations } from 'next-intl'
import { JetBrains_Mono } from 'next/font/google'
import { useEffect, useRef, useState } from 'react'
import { backendMetricsHandler, frontendMetricsHandler, getBackendMetrics, getFrontendMetrics } from '@/api/misc'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useErrorMessageT } from '@/hooks/use-translations'
import { cn } from '@/lib/utils'

// 指标轮询间隔
const METRICS_POLL_INTERVAL = 5000

const jetBrainsMono = JetBrains_Mono({
  variable: '--font-jet-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
})

/**
 * 轮询拉取数据：页面不可见时暂停，重新可见时立即拉取一次
 * 失败时仅记录错误供卡片内展示，不弹 toast，避免轮询刷屏
 */
function usePolling<T>(fetcher: () => Promise<T>, interval: number) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    const run = () => {
      fetcherRef.current()
        .then((res) => {
          if (cancelled)
            return
          setData(res)
          setError(null)
        })
        .catch((err: unknown) => {
          if (!cancelled)
            setError(err ?? new Error('unknown'))
        })
    }
    const start = () => {
      if (timer === undefined)
        timer = window.setInterval(run, interval)
    }
    const stop = () => {
      if (timer !== undefined) {
        window.clearInterval(timer)
        timer = undefined
      }
    }
    const onVisibilityChange = () => {
      if (document.hidden) {
        stop()
      }
      else {
        run()
        start()
      }
    }

    run()
    if (!document.hidden)
      start()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelled = true
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [interval])

  return { data, error }
}

type MetricsHandler = Record<string, (value: number) => string>

function formatMetric(handler: MetricsHandler, key: string, value: unknown) {
  return typeof value === 'number' ? (handler[key]?.(value) ?? String(value)) : String(value)
}

/**
 * 当前查看的后端实例：多副本时每次请求可能落到不同实例，默认停留在第一次看到的实例上，
 * 用户选择后保持不变；所选实例下线时回到处理本次请求的实例
 */
function useSelectedInstance(instances: RuntimeInstance[]) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = instances.find(i => i.instanceId === selectedId)
    ?? instances.find(i => i.current)
    ?? instances[0]
    ?? null
  useEffect(() => {
    if (selected && selected.instanceId !== selectedId)
      setSelectedId(selected.instanceId)
  }, [selected, selectedId])
  return [selected, setSelectedId] as const
}

// 系统运行：主视图只放判断“服务是否健康”最关键的四项，其余指标收进可展开区域
export function RuntimeCard() {
  const t = useTranslations('Console.dashboard')
  const now = useNow({ updateInterval: METRICS_POLL_INTERVAL })
  const [open, setOpen] = useState(false)
  const backend = usePolling<RuntimeMetrics>(() => getBackendMetrics().then(res => res.data), METRICS_POLL_INTERVAL)
  const frontend = usePolling<FrontendMetrics>(getFrontendMetrics, METRICS_POLL_INTERVAL)
  const instances = backend.data?.instances ?? []
  const [instance, setInstance] = useSelectedInstance(instances)
  const backendData = instance?.metrics ?? null
  const frontendData = frontend.data?.metrics ?? null
  // 非处理本次请求的实例展示的是快照，注明是多久之前的
  const snapshotAge = instance && !instance.current
    ? Math.max(0, Math.round((now.getTime() - new Date(instance.updatedAt).getTime()) / 1000))
    : null

  const keyMetrics = [
    { key: 'runtime_backend_uptime', data: backendData, handler: backendMetricsHandler, field: 'uptime' },
    { key: 'runtime_backend_memory', data: backendData, handler: backendMetricsHandler, field: 'memorySys' },
    { key: 'runtime_goroutines', data: backendData, handler: backendMetricsHandler, field: 'goroutines' },
    { key: 'runtime_frontend_memory', data: frontendData, handler: frontendMetricsHandler, field: 'memoryRss' },
  ] as const

  return (
    <Card className="gap-4 py-4">
      <Collapsible open={open} onOpenChange={setOpen} className="grid gap-4">
        <CardHeader className="px-4">
          <CardTitle>{t('runtime_title')}</CardTitle>
          <CardDescription>{t('runtime_description')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 px-4">
          {!!backend.error && <MetricsError error={backend.error} label={t('backend_metrics')} />}
          {!!frontend.error && <MetricsError error={frontend.error} label={t('frontend_metrics')} />}
          {instances.length > 1 && instance && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-muted-foreground">{t('runtime_instance_count', { count: instances.length })}</span>
              <Select value={instance.instanceId} onValueChange={setInstance}>
                <SelectTrigger size="sm" className="w-auto min-w-48" aria-label={t('runtime_instance')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {instances.map(item => (
                    <SelectItem key={item.instanceId} value={item.instanceId}>
                      <span className={jetBrainsMono.className}>{item.hostname || item.instanceId.slice(0, 8)}</span>
                      <span className="text-muted-foreground">{`PID ${item.pid}`}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {instance.current && <Badge variant="secondary">{t('runtime_instance_serving')}</Badge>}
              {snapshotAge !== null && <span className="text-xs text-muted-foreground">{t('runtime_instance_snapshot', { seconds: snapshotAge })}</span>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {keyMetrics.map(item => (
              <div key={item.key} className="grid gap-1 rounded-md border px-3 py-2">
                <span className="text-xs text-muted-foreground">{t(item.key)}</span>
                {item.data
                  ? (
                      <span className={cn(jetBrainsMono.className, 'truncate text-base font-semibold tabular-nums')}>
                        {formatMetric(item.handler as MetricsHandler, item.field, item.data[item.field])}
                      </span>
                    )
                  : <Skeleton className="h-6 w-20" />}
              </div>
            ))}
          </div>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="justify-self-start text-muted-foreground">
              {open ? t('runtime_details_hide') : t('runtime_details_show')}
              <ChevronDown className={cn('transition-transform', open && 'rotate-180')} aria-hidden="true" />
            </Button>
          </CollapsibleTrigger>
        </CardContent>
        <CollapsibleContent>
          <CardContent className="grid gap-6 px-4 md:grid-cols-2">
            <MetricsList title={t('backend_metrics')} data={backendData} handler={backendMetricsHandler} reverse />
            <MetricsList
              title={t('frontend_metrics')}
              description={frontend.data?.hostname ? t('runtime_frontend_instance', { hostname: frontend.data.hostname }) : undefined}
              data={frontendData}
              handler={frontendMetricsHandler}
            />
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

function MetricsList({ title, description, data, handler, reverse = false }: {
  title: string
  description?: string
  data: Record<string, unknown> | null
  handler: MetricsHandler
  reverse?: boolean // 后端指标按接口返回的倒序展示，与之前的排列保持一致
}) {
  const t = useTranslations('Console.dashboard')
  const entries = data ? Object.entries(data) : []
  if (reverse)
    entries.reverse()
  return (
    <div className="grid content-start gap-2">
      <div className="grid gap-0.5">
        <h3 className="text-sm font-medium">{title}</h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {data
        ? (
            <dl className="grid gap-1.5 text-sm">
              {entries.map(([key, value]) => (
                <div key={key} className="flex items-center justify-between gap-3 leading-relaxed">
                  <dt className="text-muted-foreground">{t(key)}</dt>
                  <dd className={cn(jetBrainsMono.className, 'text-right tabular-nums')}>{formatMetric(handler, key, value)}</dd>
                </div>
              ))}
            </dl>
          )
        : (
            <div className="grid gap-2" aria-busy="true">
              {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-5 w-full" />)}
            </div>
          )}
    </div>
  )
}

// 轮询失败在卡片内常驻提示，已有数据时继续展示旧数据
function MetricsError({ error, label }: { error: unknown, label: string }) {
  const t = useTranslations('Console.dashboard')
  const errorMessageT = useErrorMessageT()
  const message = errorMessageT(error)
  return (
    <Alert variant="destructive">
      <AlertDescription>
        {label}
        {' '}
        {t('load_failed')}
        {message && `: ${message}`}
      </AlertDescription>
    </Alert>
  )
}
