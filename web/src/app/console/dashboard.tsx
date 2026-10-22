'use client'
import type { DashboardResp } from '@/api/admin'
import type { BackendMetricsData, FrontendMetricsData } from '@/models/misc'
import type { IconType } from '@/types/icon'
import { Eye, MessageCircle, Newspaper, Users } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { JetBrains_Mono } from 'next/font/google'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { getDashboard } from '@/api/admin'
import { backendMetricsHandler, frontendMetricsHandler, getBackendMetrics, getFrontendMetrics } from '@/api/misc'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useErrorMessageT } from '@/hooks/use-translations'
import { consolePath } from '@/utils/common/route'

// 指标轮询间隔
const METRICS_POLL_INTERVAL = 5000

/**
 * 轮询拉取数据：页面不可见时暂停，重新可见时立即拉取一次
 * 失败时仅记录错误供卡片内展示，不弹 toast，避免轮询刷屏
 */
function usePolling<T>(fetcher: () => Promise<T>, interval?: number) {
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
      if (!interval || timer !== undefined)
        return
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
    if (interval)
      document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelled = true
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [interval])

  return { data, error }
}

const jetBrainsMono = JetBrains_Mono({
  variable: '--font-jet-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
})

export function Dashboard() {
  return (
    <div>
      <DataOverview />
      <MetricsOverview />
    </div>
  )
}

function DataOverview() {
  const dashboardT = useTranslations('Console.dashboard')
  const data: {
    key: keyof DashboardResp
    label: string
    icon: IconType
    url: string
  }[]
    = [
      {
        key: 'totalPosts',
        label: 'total_posts',
        icon: Newspaper,
        url: consolePath.post,
      },
      {
        key: 'totalUsers',
        label: 'total_users',
        icon: Users,
        url: consolePath.user,
      },
      {
        key: 'totalComments',
        label: 'total_comments',
        icon: MessageCircle,
        url: consolePath.comment,
      },
      {
        key: 'totalViews',
        label: 'total_views',
        icon: Eye,
        url: consolePath.visit,
      },
    ]

  // 概览数据只拉取一次，不轮询
  const { data: fetchData, error } = usePolling(() => getDashboard().then(res => res.data))

  if (!fetchData) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4" aria-busy={!error}>
        {error
          ? <ErrorText className="col-span-full" error={error} />
          : data.map(item => <Skeleton key={item.key} className="h-[5.5rem] rounded-xl" />)}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      {data.map(item => (
        <Link key={item.key} href={item.url}>
          <Card key={item.key} className="pt-4 pb-2">
            <CardHeader className="pb-2 text-lg font-medium">
              <CardDescription>{dashboardT(item.label)}</CardDescription>
              <CardTitle className="flex items-center text-2xl font-semibold tabular-nums @[250px]/card:text-3xl text-primary">
                <item.icon className="inline mr-2" />
                {fetchData[item.key]}
              </CardTitle>
            </CardHeader>
          </Card>
        </Link>
      ))}
    </div>
  )
}

function MetricsOverview() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 mt-4">
      <BackendMetricsOverview />
      <FrontendMetricsOverview />
    </div>
  )
}

function BackendMetricsOverview() {
  const dashboardT = useTranslations('Console.dashboard')
  const { data: metricsData, error } = usePolling<BackendMetricsData>(
    () => getBackendMetrics().then(res => res.data),
    METRICS_POLL_INTERVAL,
  )
  const boldProps = ['memorySys']

  return (
    <div className="">
      <Card className="px-4 gap-3">
        <CardDescription className="mb-0">{dashboardT('backend_metrics')}</CardDescription>
        {/* 已有数据时轮询失败仍保留旧数据，同时在卡片内提示 */}
        {!!error && <ErrorText error={error} />}
        <div className="mt-4 space-y-2">
          {metricsData
            ? Object.entries(metricsData).slice().reverse().map(
                ([key, value]) => (
                  <div key={key} className="flex items-center leading-relaxed justify-between">
                    <span className={`text-muted-foreground ${boldProps.includes(key) ? 'text-primary font-extrabold' : 'font-medium'}`}>
                      {dashboardT(key)}
                    </span>
                    <span className={`${jetBrainsMono.className} tabular-nums ${boldProps.includes(key) ? 'text-primary font-extrabold' : 'font-medium'}`}>
                      {backendMetricsHandler?.[key]?.(value) || value}
                    </span>
                  </div>
                ),
              )
            : !error && <MetricsSkeleton />}
        </div>
      </Card>
    </div>
  )
}

function FrontendMetricsOverview() {
  const dashboardT = useTranslations('Console.dashboard')
  const { data: metricsData, error } = usePolling<FrontendMetricsData>(
    getFrontendMetrics,
    METRICS_POLL_INTERVAL,
  )
  const boldProps = ['memoryRss']

  return (
    <div className="">
      <Card className="px-4 gap-3">
        <CardDescription className="mb-0">{dashboardT('frontend_metrics')}</CardDescription>
        {!!error && <ErrorText error={error} />}
        <div className="mt-4 space-y-2">
          {metricsData
            ? (
              // 反序遍历：先把 entries 转成数组并 reverse
                Object.entries(metricsData).map(([key, value]) => (
                  <div key={key} className="flex items-center leading-relaxed justify-between">
                    <span className={`text-muted-foreground ${boldProps.includes(key) ? 'text-primary font-extrabold' : 'font-medium'}`}>
                      {dashboardT(key)}
                    </span>
                    <span className={`${jetBrainsMono.className} tabular-nums ${boldProps.includes(key) ? 'text-primary font-extrabold' : 'font-medium'}`}>
                      {frontendMetricsHandler?.[key]?.(value) || value}
                    </span>
                  </div>
                ))
              )
            : !error && <MetricsSkeleton />}
        </div>
      </Card>
    </div>
  )
}

function MetricsSkeleton() {
  return (
    <div className="grid gap-2 pb-4" aria-busy="true">
      {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-5 w-full" />)}
    </div>
  )
}

// 错误在卡片内展示并经过翻译，不弹 toast，避免轮询刷屏
function ErrorText({ error, className = '' }: { error: unknown, className?: string }) {
  const dashboardT = useTranslations('Console.dashboard')
  const errorMessageT = useErrorMessageT()
  const message = errorMessageT(error)
  return (
    <p role="alert" className={`text-sm text-destructive ${className}`}>
      {dashboardT('load_failed')}
      {message && `: ${message}`}
    </p>
  )
}
