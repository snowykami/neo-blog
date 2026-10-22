'use client'

import type { BackendMetricsData, FrontendMetricsData } from '@/models/misc'
import { ChevronDown } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { JetBrains_Mono } from 'next/font/google'
import { useEffect, useRef, useState } from 'react'
import { backendMetricsHandler, frontendMetricsHandler, getBackendMetrics, getFrontendMetrics } from '@/api/misc'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
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

// 系统运行：主视图只放判断“服务是否健康”最关键的四项，其余指标收进可展开区域
export function RuntimeCard() {
  const t = useTranslations('Console.dashboard')
  const [open, setOpen] = useState(false)
  const backend = usePolling<BackendMetricsData>(() => getBackendMetrics().then(res => res.data), METRICS_POLL_INTERVAL)
  const frontend = usePolling<FrontendMetricsData>(getFrontendMetrics, METRICS_POLL_INTERVAL)

  const keyMetrics = [
    { key: 'runtime_backend_uptime', data: backend.data, handler: backendMetricsHandler, field: 'uptime' },
    { key: 'runtime_backend_memory', data: backend.data, handler: backendMetricsHandler, field: 'memorySys' },
    { key: 'runtime_goroutines', data: backend.data, handler: backendMetricsHandler, field: 'goroutines' },
    { key: 'runtime_frontend_memory', data: frontend.data, handler: frontendMetricsHandler, field: 'memoryRss' },
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
            <MetricsList title={t('backend_metrics')} data={backend.data} handler={backendMetricsHandler} reverse />
            <MetricsList title={t('frontend_metrics')} data={frontend.data} handler={frontendMetricsHandler} />
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

function MetricsList({ title, data, handler, reverse = false }: {
  title: string
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
      <h3 className="text-sm font-medium">{title}</h3>
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
