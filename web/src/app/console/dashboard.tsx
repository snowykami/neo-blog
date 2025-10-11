'use client'
import type { DashboardResp } from '@/api/admin'
import type { BackendMetricsData, FrontendMetricsData } from '@/models/misc'
import type { IconType } from '@/types/icon'
import { Eye, MessageCircle, Newspaper, Users } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { JetBrains_Mono } from 'next/font/google'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { getDashboard } from '@/api/admin'
import { backendMetricsHandler, frontendMetricsHandler, getBackendMetrics, getFrontendMetrics } from '@/api/misc'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

import { consolePath } from '@/utils/common/route'

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
        url: consolePath.file,
      },
    ]

  const [fetchData, setFetchData] = useState<DashboardResp | null>(null)

  useEffect(() => {
    getDashboard()
      .then((res) => {
        setFetchData(res.data)
      })
      .catch((err) => {
        toast.error(err.message || 'Failed to fetch dashboard data')
      })
  }, [])

  if (!fetchData)
    return <div>Loading...</div>

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
  const [metricsData, setMetricsData] = useState<BackendMetricsData | null>(null)
  const boldProps = ['memorySys']

  useEffect(() => {
    const fetchMetrics = () => {
      getBackendMetrics()
        .then((res) => {
          setMetricsData(res.data)
        })
        .catch((err) => {
          toast.error(err.message || 'Failed to fetch metrics data')
        })
    }

    // fetch immediately, then every second
    fetchMetrics()
    const timer = window.setInterval(fetchMetrics, 1000)

    return () => {
      clearInterval(timer)
    }
  }, [])

  return (
    <div className="">
      <Card className="px-4 gap-3">
        <CardDescription className="mb-0">{dashboardT('backend_metrics')}</CardDescription>
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
            : <div>Loading...</div>}
        </div>
      </Card>
    </div>
  )
}

function FrontendMetricsOverview() {
  const dashboardT = useTranslations('Console.dashboard')
  const [metricsData, setMetricsData] = useState<FrontendMetricsData | null>(null)
  const boldProps = ['memoryRss']

  useEffect(() => {
    const fetchMetrics = () => {
      getFrontendMetrics()
        .then((res) => {
          setMetricsData(res)
        })
        .catch((err) => {
          toast.error(err.message || 'Failed to fetch metrics data')
        })
    }

    fetchMetrics()
    const timer = window.setInterval(fetchMetrics, 1000)

    return () => {
      clearInterval(timer)
    }
  }, [])

  return (
    <div className="">
      <Card className="px-4 gap-3">
        <CardDescription className="mb-0">{dashboardT('frontend_metrics')}</CardDescription>
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
            : (
                <div>Loading...</div>
              )}
        </div>
      </Card>
    </div>
  )
}
