'use client'

import type { VisitInsights, WebVital } from '@/models/visit'
import { useFormatter, useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { cn } from '@/lib/utils'
import { formatVital, vitalRating } from './format'

// 评级配色与 web.dev 一致：好 / 待改进 / 差，同时配文字
const RATING_STYLES = {
  good: { badge: 'border-emerald-500/40 bg-emerald-500/10', fill: 'bg-emerald-500' },
  needsImprovement: { badge: 'border-amber-500/50 bg-amber-500/10', fill: 'bg-amber-400' },
  poor: { badge: 'border-red-500/45 bg-red-500/10', fill: 'bg-red-600' },
} as const

// 访客统计 · 性能：Web Vitals 各指标 p75、评级分布，以及 LCP 最慢的页面
export function InsightsPerformanceTab({ data }: { data: VisitInsights }) {
  const t = useTranslations('Console.visit_insights')
  if (data.vitals.length === 0)
    return <Empty className="py-10"><EmptyDescription>{t('vitals_empty')}</EmptyDescription></Empty>
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t('vitals_hint')}</p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.vitals.map(vital => <VitalCard key={vital.name} vital={vital} />)}
      </div>
      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          <CardTitle>{t('slow_pages_title')}</CardTitle>
          <CardDescription>{t('slow_pages_hint')}</CardDescription>
        </CardHeader>
        <CardContent className="px-4">
          {data.slowPages.length === 0
            ? <p className="py-2 text-sm text-muted-foreground">{t('empty')}</p>
            : (
                <ul className="grid gap-1.5">
                  {data.slowPages.map(page => (
                    <li key={page.path} className="grid grid-cols-[minmax(0,1fr)_auto_4.5rem] items-center gap-3 text-sm">
                      <span className="truncate font-mono text-xs" title={page.path}>{page.path}</span>
                      <RatingBadge name="LCP" value={page.p75} />
                      <span className="text-right text-xs text-muted-foreground">{t('vital_samples', { count: page.samples })}</span>
                    </li>
                  ))}
                </ul>
              )}
        </CardContent>
      </Card>
    </div>
  )
}

function RatingBadge({ name, value }: { name: WebVital['name'], value: number }) {
  const t = useTranslations('Console.visit_insights')
  const rating = vitalRating(name, value)
  return (
    <Badge variant="outline" className={cn('tabular-nums', RATING_STYLES[rating].badge)} title={t(`rating_${rating}`)}>
      {formatVital(name, value)}
    </Badge>
  )
}

function VitalCard({ vital }: { vital: WebVital }) {
  const t = useTranslations('Console.visit_insights')
  const format = useFormatter()
  const rating = vitalRating(vital.name, vital.p75)
  const parts = [
    { key: 'good', count: vital.good },
    { key: 'needsImprovement', count: vital.needsImprovement },
    { key: 'poor', count: vital.poor },
  ] as const
  const total = vital.good + vital.needsImprovement + vital.poor
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center justify-between gap-2">
          <span>{vital.name}</span>
          <Badge variant="outline" className={RATING_STYLES[rating].badge}>{t(`rating_${rating}`)}</Badge>
        </CardTitle>
        <CardDescription>{t(`vital_names.${vital.name}`)}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 px-4">
        <div>
          <div className="text-xs text-muted-foreground">p75</div>
          <div className="text-2xl font-semibold">{formatVital(vital.name, vital.p75)}</div>
        </div>
        <div className="flex h-2.5 gap-0.5 overflow-hidden rounded">
          {parts.filter(part => part.count > 0).map(part => (
            <span key={part.key} className={RATING_STYLES[part.key].fill} style={{ flexGrow: part.count }} title={`${t(`rating_${part.key}`)} ${part.count}`} />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {parts.map(part => (
            <span key={part.key} className="flex items-center gap-1.5">
              <span className={cn('size-2 rounded-full', RATING_STYLES[part.key].fill)} />
              {`${t(`rating_${part.key}`)} ${format.number(total ? part.count / total : 0, { style: 'percent', maximumFractionDigits: 0 })}`}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            {t('vital_mobile')}
            {vital.mobileP75 !== null ? <RatingBadge name={vital.name} value={vital.mobileP75} /> : '—'}
          </span>
          <span className="flex items-center gap-1.5">
            {t('vital_desktop')}
            {vital.desktopP75 !== null ? <RatingBadge name={vital.name} value={vital.desktopP75} /> : '—'}
          </span>
          <span>{t('vital_samples', { count: vital.samples })}</span>
        </div>
      </CardContent>
    </Card>
  )
}
