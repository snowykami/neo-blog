'use client'

import type { ChartConfig } from '@/components/ui/chart'
import type { AIUsageStats } from '@/models/ai-usage'
import { RefreshCw } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useState } from 'react'
import { getAIUsage } from '@/api/admin'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useErrorMessageT } from '@/hooks/use-translations'
import { cn } from '@/lib/utils'
import { AI_USAGE_PURPOSES } from '@/models/ai-usage'
import { formatCompactNumber } from '@/utils/common/number'

// 趋势看 token 或调用次数，按用途堆叠
const VIEWS = ['tokens', 'calls'] as const
type View = (typeof VIEWS)[number]

const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']

const AIUsageChart = dynamic(
  () => import('./ai-usage-chart').then(m => m.AIUsageChart),
  { ssr: false, loading: () => <Skeleton className="h-64 w-full" /> },
)

function isKnownPurpose(purpose: string): purpose is (typeof AI_USAGE_PURPOSES)[number] {
  return (AI_USAGE_PURPOSES as readonly string[]).includes(purpose)
}

/** 全站模型调用用量：本月按用途分组的调用次数与 token、近 30 天趋势、全站与 AI 用户的月度预算 */
export function AIUsageCard() {
  const t = useTranslations('Console.ai_usage')
  const format = useFormatter()
  const errorMessageT = useErrorMessageT()
  const [stats, setStats] = useState<AIUsageStats | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState<View>('tokens')

  const load = useCallback(() => {
    setLoading(true)
    getAIUsage()
      .then((res) => {
        setStats(res.data)
        setError(null)
      })
      .catch((err: unknown) => setError(err ?? new Error('unknown')))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const compact = formatCompactNumber
  const purposeLabel = (purpose: string) => isKnownPurpose(purpose) ? t(`purpose.${purpose}`) : purpose

  const series = stats?.series ?? []
  const config: ChartConfig = Object.fromEntries(series.map((s, i) => [s.purpose, { label: purposeLabel(s.purpose), color: CHART_COLORS[i % CHART_COLORS.length] }]))
  const data = (stats?.dates ?? []).map((date, i) => ({
    date,
    ...Object.fromEntries(series.map(s => [s.purpose, view === 'tokens' ? s.tokens[i] : s.calls[i]])),
  }))

  const budgetRatio = stats && stats.budget > 0 ? Math.min(100, (stats.monthTokens / stats.budget) * 100) : null
  const agentRatio = stats && stats.agentBudget > 0 ? Math.min(100, (stats.agentMonthTokens / stats.agentBudget) * 100) : null

  return (
    <Card className="gap-4 py-4">
      <CardHeader className="px-4">
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{stats ? t('description', { month: stats.month }) : t('description_loading')}</CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon" onClick={load} disabled={loading} aria-label={t('refresh')}>
            <RefreshCw className={cn(loading && 'animate-spin')} aria-hidden="true" />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4 px-4">
        {!!error && (
          <Alert variant="destructive">
            <AlertDescription>
              {t('load_failed')}
              {errorMessageT(error) && `: ${errorMessageT(error)}`}
            </AlertDescription>
          </Alert>
        )}
        {!stats
          ? !error && (
              <div className="grid gap-2" aria-busy="true">
                {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-5 w-full" />)}
              </div>
            )
          : (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="grid content-between gap-1.5 rounded-xl border bg-muted/20 p-3.5">
                    <span className="text-xs text-muted-foreground">{t('month_tokens')}</span>
                    <span className="text-2xl font-semibold tabular-nums">{compact(stats.monthTokens)}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{t('month_calls', { count: stats.monthCalls })}</span>
                  </div>
                  <div className="grid content-between gap-1.5 rounded-xl border bg-muted/20 p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">{t('site_budget')}</span>
                      {budgetRatio !== null && (
                        <span className={cn('text-xs tabular-nums', budgetRatio >= 90 ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                          {format.number(budgetRatio / 100, { style: 'percent', maximumFractionDigits: 0 })}
                        </span>
                      )}
                    </div>
                    <div className="flex items-baseline gap-1.5 tabular-nums">
                      {stats.budget > 0
                        ? (
                            <>
                              <span className="text-2xl font-semibold">{compact(stats.monthTokens)}</span>
                              <span className="text-xs text-muted-foreground">{`/ ${compact(stats.budget)}`}</span>
                            </>
                          )
                        : <span className="text-2xl font-semibold">{t('unlimited')}</span>}
                    </div>
                    {budgetRatio !== null
                      ? <Progress value={budgetRatio} className={cn('h-1.5', budgetRatio >= 90 && '[&>[data-slot=progress-indicator]]:bg-destructive')} />
                      : <span className="text-xs text-muted-foreground tabular-nums">{compact(stats.monthTokens)}</span>}
                  </div>
                  <div className="grid content-between gap-1.5 rounded-xl border bg-muted/20 p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">{t('agent_budget')}</span>
                      {agentRatio !== null && (
                        <span className={cn('text-xs tabular-nums', agentRatio >= 90 ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                          {format.number(agentRatio / 100, { style: 'percent', maximumFractionDigits: 0 })}
                        </span>
                      )}
                    </div>
                    <div className="flex items-baseline gap-1.5 tabular-nums">
                      {stats.agentBudget > 0
                        ? (
                            <>
                              <span className="text-2xl font-semibold">{compact(stats.agentMonthTokens)}</span>
                              <span className="text-xs text-muted-foreground">{`/ ${compact(stats.agentBudget)}`}</span>
                            </>
                          )
                        : <span className="text-2xl font-semibold">{t('unlimited')}</span>}
                    </div>
                    {agentRatio !== null
                      ? <Progress value={agentRatio} className={cn('h-1.5', agentRatio >= 90 && '[&>[data-slot=progress-indicator]]:bg-destructive')} />
                      : <span className="text-xs text-muted-foreground tabular-nums">{compact(stats.agentMonthTokens)}</span>}
                  </div>
                </div>

                {stats.purposes.length === 0
                  ? <p className="text-sm text-muted-foreground">{t('empty')}</p>
                  : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t('column_purpose')}</TableHead>
                            <TableHead className="text-right">{t('column_calls')}</TableHead>
                            <TableHead className="text-right">{t('column_failed')}</TableHead>
                            <TableHead className="text-right">{t('column_prompt')}</TableHead>
                            <TableHead className="text-right">{t('column_cached')}</TableHead>
                            <TableHead className="text-right">{t('column_completion')}</TableHead>
                            <TableHead className="text-right">{t('column_total')}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {stats.purposes.map(p => (
                            <TableRow key={p.purpose}>
                              <TableCell>{purposeLabel(p.purpose)}</TableCell>
                              <TableCell className="text-right tabular-nums">{format.number(p.calls)}</TableCell>
                              <TableCell className={cn('text-right tabular-nums', p.failed > 0 ? 'text-destructive' : 'text-muted-foreground')}>{format.number(p.failed)}</TableCell>
                              <TableCell className="text-right tabular-nums">{compact(p.promptTokens)}</TableCell>
                              <TableCell className="text-right tabular-nums text-muted-foreground">{compact(p.cachedTokens)}</TableCell>
                              <TableCell className="text-right tabular-nums">{compact(p.completionTokens)}</TableCell>
                              <TableCell className="text-right font-medium tabular-nums">{compact(p.totalTokens)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}

                <div className="grid gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-medium">{t('trend_title')}</h3>
                    <Tabs value={view} onValueChange={value => setView(value as View)}>
                      <TabsList>
                        {VIEWS.map(item => <TabsTrigger key={item} value={item}>{t(`trend_${item}`)}</TabsTrigger>)}
                      </TabsList>
                    </Tabs>
                  </div>
                  {series.length === 0
                    ? <p className="text-sm text-muted-foreground">{t('trend_empty')}</p>
                    : <AIUsageChart config={config} data={data} series={series} />}
                </div>
              </>
            )}
      </CardContent>
    </Card>
  )
}
