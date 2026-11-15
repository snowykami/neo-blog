'use client'

import type { TrendChartView } from './trend-chart-plot'
import type { ChartConfig } from '@/components/ui/chart'
import type { DashboardTrendPoint } from '@/models/dashboard'
import { useTranslations } from 'next-intl'
import dynamic from 'next/dynamic'
import { useState } from 'react'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

// 流量看访问与访客的走势（面积图），互动看每天的评论与点赞（柱状图）
const VIEWS = ['traffic', 'interaction'] as const

const TrendChartPlot = dynamic(
  () => import('./trend-chart-plot').then(m => m.TrendChartPlot),
  { ssr: false, loading: () => <Skeleton className="h-64 w-full" /> },
)

export function TrendChart({ trend, className }: { trend: DashboardTrendPoint[], className?: string }) {
  const t = useTranslations('Console.dashboard')
  const [view, setView] = useState<TrendChartView>('traffic')

  const config: ChartConfig = view === 'traffic'
    ? {
        pv: { label: t('metric_pv'), color: 'var(--chart-1)' },
        uv: { label: t('metric_uv'), color: 'var(--chart-2)' },
      }
    : {
        comments: { label: t('metric_comments'), color: 'var(--chart-1)' },
        likes: { label: t('metric_likes'), color: 'var(--chart-2)' },
      }

  return (
    <Card className={cn('gap-4 py-4', className)}>
      <CardHeader className="px-4">
        <CardTitle>{t('trend_title')}</CardTitle>
        <CardDescription>{t(`trend_${view}_description`)}</CardDescription>
        <CardAction>
          <Tabs value={view} onValueChange={value => setView(value as TrendChartView)}>
            <TabsList>
              {VIEWS.map(item => <TabsTrigger key={item} value={item}>{t(`trend_${item}`)}</TabsTrigger>)}
            </TabsList>
          </Tabs>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 sm:px-4">
        <TrendChartPlot view={view} trend={trend} config={config} />
      </CardContent>
    </Card>
  )
}
