'use client'
import type { DashboardDays } from '@/models/dashboard'
import { useTranslations } from 'next-intl'
import { parseAsNumberLiteral, useQueryState } from 'nuqs'
import { getDashboard } from '@/api/admin'
import { PostListCard } from '@/components/console/dashboard/post-list-card'
import { RecentCommentsCard } from '@/components/console/dashboard/recent-comments-card'
import { SourcesCard } from '@/components/console/dashboard/sources-card'
import { StatCards } from '@/components/console/dashboard/stat-cards'
import { TodoCard } from '@/components/console/dashboard/todo-card'
import { TotalsCard } from '@/components/console/dashboard/totals-card'
import { TrendChart } from '@/components/console/dashboard/trend-chart'
import { DashboardSkeleton } from '@/components/console/route-skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useConsoleQuery } from '@/hooks/use-console-query'
import { useErrorMessageT } from '@/hooks/use-translations'
import { cn } from '@/lib/utils'
import { DASHBOARD_DAYS } from '@/models/dashboard'

/**
 * 后台首页，按博主关心的顺序自上而下排列：
 * 1. 最近来了多少人、留下多少互动（核心指标 + 环比）
 * 2. 走势如何，以及有哪些事情等我处理
 * 3. 什么内容受欢迎、读者在说什么
 * 4. 读者从哪里来、最近写了什么
 * 5. 站点累计
 * 系统运行（副本负载、依赖服务）单独在「系统运行」页，概览只放内容与读者互动
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
    </div>
  )
}

// 回到看板时先显示上次的数据，同时重新请求（见 hooks/use-console-query.ts）
function useDashboard(days: DashboardDays) {
  const { data, error, isPreviousData, refresh } = useConsoleQuery(
    ['admin/dashboard', days],
    () => getDashboard(days).then(res => res.data),
  )
  // 只在切换区间、新数据未到时变淡；显示缓存的同一区间数据并在后台刷新时不变淡，避免每次回到看板都闪一下
  return { data: data ?? null, error: error ?? null, loading: isPreviousData, reload: refresh }
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
