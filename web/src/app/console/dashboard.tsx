'use client'
import type { Dashboard as DashboardData, DashboardDays } from '@/models/dashboard'
import { useTranslations } from 'next-intl'
import { parseAsNumberLiteral, useQueryState } from 'nuqs'
import { useCallback, useEffect, useState } from 'react'
import { getDashboard } from '@/api/admin'
import { PostListCard } from '@/components/console/dashboard/post-list-card'
import { RecentCommentsCard } from '@/components/console/dashboard/recent-comments-card'
import { RuntimeCard } from '@/components/console/dashboard/runtime-card'
import { SourcesCard } from '@/components/console/dashboard/sources-card'
import { StatCards } from '@/components/console/dashboard/stat-cards'
import { TodoCard } from '@/components/console/dashboard/todo-card'
import { TotalsCard } from '@/components/console/dashboard/totals-card'
import { TrendChart } from '@/components/console/dashboard/trend-chart'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useErrorMessageT } from '@/hooks/use-translations'
import { cn } from '@/lib/utils'
import { DASHBOARD_DAYS } from '@/models/dashboard'

/**
 * 后台首页，按博主关心的顺序自上而下排列：
 * 1. 最近来了多少人、留下多少互动（核心指标 + 环比）
 * 2. 走势如何，以及有哪些事情等我处理
 * 3. 什么内容受欢迎、读者在说什么
 * 4. 读者从哪里来、最近写了什么
 * 5. 站点累计与系统运行（背景信息，运行指标默认折叠）
 * 权限由控制台布局统一校验（仅管理员可进入），后端接口同样只对管理员开放
 */
export function Dashboard() {
  const t = useTranslations('Console.dashboard')
  const [days, setDays] = useQueryState(
    'days',
    parseAsNumberLiteral(DASHBOARD_DAYS).withDefault(7).withOptions({ history: 'replace', clearOnDefault: true }),
  )
  const { data, error, loading, reload } = useDashboard(days)

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t('range_description', { days })}</p>
        <ToggleGroup
          type="single"
          variant="segmented"
          size="sm"
          value={String(days)}
          onValueChange={value => value && setDays(Number(value) as DashboardDays)}
          aria-label={t('range_label')}
        >
          {DASHBOARD_DAYS.map(item => (
            <ToggleGroupItem key={item} value={String(item)} className="px-3">
              {t('range_days', { days: item })}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {!!error && <LoadError error={error} onRetry={reload} />}
      {data
        ? (
            // 切换区间时保留旧数据并降低不透明度，避免整页闪烁
            <div className={cn('grid gap-4 transition-opacity', loading && 'opacity-60')} aria-busy={loading}>
              <StatCards summary={data.summary} />
              <div className="grid gap-4 lg:grid-cols-3">
                <TrendChart trend={data.trend} className="lg:col-span-2" />
                <TodoCard content={data.content} pendingComments={data.summary.pendingComments} days={data.days} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <PostListCard
                  title={t('hot_posts_title')}
                  tabs={[
                    { value: 'top', posts: data.posts.top, metric: 'periodViews' },
                    { value: 'hot', posts: data.posts.hot, metric: 'heat' },
                  ]}
                />
                <RecentCommentsCard comments={data.recentComments} pendingComments={data.summary.pendingComments} days={data.days} />
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                <PostListCard
                  title={t('recent_posts_title')}
                  className="lg:col-span-2"
                  tabs={[
                    { value: 'recent', posts: data.posts.recent, metric: 'createdAt' },
                    { value: 'updated', posts: data.posts.updated, metric: 'updatedAt' },
                  ]}
                />
                <SourcesCard sources={data.sources} />
              </div>
              <TotalsCard data={data} />
            </div>
          )
        : !error && <DashboardSkeleton />}
      <RuntimeCard />
    </div>
  )
}

function useDashboard(days: DashboardDays) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion(v => v + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getDashboard(days)
      .then((res) => {
        if (cancelled)
          return
        setData(res.data)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err ?? new Error('unknown'))
      })
      .finally(() => {
        if (!cancelled)
          setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [days, version])

  return { data, error, loading, reload }
}

// 加载失败常驻提示并提供重试，已有数据时继续展示旧数据
function LoadError({ error, onRetry }: { error: unknown, onRetry: () => void }) {
  const t = useTranslations('Console.dashboard')
  const errorMessageT = useErrorMessageT()
  return (
    <Alert variant="destructive">
      <AlertTitle>{t('load_failed')}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-3">
        <span>{errorMessageT(error)}</span>
        <Button variant="outline" size="sm" onClick={onRetry}>{t('retry')}</Button>
      </AlertDescription>
    </Alert>
  )
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-80 rounded-xl lg:col-span-2" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  )
}
