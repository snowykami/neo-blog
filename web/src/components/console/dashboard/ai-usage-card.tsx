'use client'

import type { ChartConfig } from '@/components/ui/chart'
import type { AIUsageStats } from '@/models/ai-usage'
import { RefreshCw } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { getAIUsage } from '@/api/admin'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useErrorMessageT } from '@/hooks/use-translations'
import { cn } from '@/lib/utils'
import { AI_USAGE_PURPOSES } from '@/models/ai-usage'

// 趋势看 token 或调用次数，按用途堆叠
const VIEWS = ['tokens', 'calls'] as const
type View = (typeof VIEWS)[number]

const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']

// 后端返回服务器时区的自然日，按本地零点解析，避免被当成 UTC
function parseDay(date: string) {
  return new Date(`${date}T00:00:00`)
}

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

  const compact = (value: number) => format.number(value, { notation: 'compact', maximumFractionDigits: 1 })
  const purposeLabel = (purpose: string) => isKnownPurpose(purpose) ? t(`purpose.${purpose}`) : purpose

  const series = stats?.series ?? []
  const config: ChartConfig = Object.fromEntries(series.map((s, i) => [s.purpose, { label: purposeLabel(s.purpose), color: CHART_COLORS[i % CHART_COLORS.length] }]))
  const data = (stats?.dates ?? []).map((date, i) => ({
    date,
    ...Object.fromEntries(series.map(s => [s.purpose, view === 'tokens' ? s.tokens[i] : s.calls[i]])),
  }))
  const tickFormatter = (value: string) => format.dateTime(parseDay(value), { month: 'numeric', day: 'numeric' })
  const labelFormatter = (value: unknown) => typeof value === 'string'
    ? format.dateTime(parseDay(value), { month: 'short', day: 'numeric', weekday: 'short' })
    : ''

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
                  <div className="grid gap-1">
                    <span className="text-xs text-muted-foreground">{t('month_tokens')}</span>
                    <span className="text-2xl font-semibold tabular-nums">{compact(stats.monthTokens)}</span>
                    <span className="text-xs text-muted-foreground">{t('month_calls', { count: stats.monthCalls })}</span>
                  </div>
                  <div className="grid content-start gap-1">
                    <span className="text-xs text-muted-foreground">{t('site_budget')}</span>
                    <span className="text-sm tabular-nums">
                      {stats.budget > 0 ? `${compact(stats.monthTokens)} / ${compact(stats.budget)}` : t('unlimited')}
                    </span>
                    {budgetRatio !== null && <Progress value={budgetRatio} className={cn('h-1.5', budgetRatio >= 90 && '[&>[data-slot=progress-indicator]]:bg-destructive')} />}
                  </div>
                  <div className="grid content-start gap-1">
                    <span className="text-xs text-muted-foreground">{t('agent_budget')}</span>
                    <span className="text-sm tabular-nums">
                      {stats.agentBudget > 0 ? `${compact(stats.agentMonthTokens)} / ${compact(stats.agentBudget)}` : t('unlimited')}
                    </span>
                    {agentRatio !== null && <Progress value={agentRatio} className={cn('h-1.5', agentRatio >= 90 && '[&>[data-slot=progress-indicator]]:bg-destructive')} />}
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
                    : (
                        <ChartContainer config={config} className="aspect-auto h-64 w-full">
                          <BarChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
                            <CartesianGrid vertical={false} />
                            <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={tickFormatter} />
                            <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} tickFormatter={(value: number) => compact(value)} />
                            <ChartTooltip cursor={{ fill: 'var(--muted)', opacity: 0.6 }} content={<ChartTooltipContent labelFormatter={labelFormatter} />} />
                            {series.map(s => <Bar key={s.purpose} dataKey={s.purpose} stackId="usage" fill={`var(--color-${s.purpose})`} maxBarSize={24} />)}
                            <ChartLegend content={<ChartLegendContent />} />
                          </BarChart>
                        </ChartContainer>
                      )}
                </div>
              </>
            )}
      </CardContent>
    </Card>
  )
}
