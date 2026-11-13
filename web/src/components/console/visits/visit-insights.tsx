'use client'

import type { VisitInsights } from '@/models/visit'
import { useFormatter, useTranslations } from 'next-intl'
import { useState } from 'react'
import { getVisitInsightsAdmin } from '@/api/admin'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useConsoleQuery } from '@/hooks/use-console-query'
import { useIncludeAI } from '@/hooks/use-include-ai'
import { cn } from '@/lib/utils'
import { VISIT_TRUSTS } from '@/models/visit'
import { useCountryName } from './format'
import { InsightsContentTab } from './insights-content'
import { BarListCard, count, INFERRED_FILL, IP_FILL, StatCard } from './insights-parts'
import { InsightsPerformanceTab } from './insights-performance'
import { TRUST_STYLES, TrustBadge } from './trust-badge'

const RANGES = [1, 7, 30] as const
type Range = (typeof RANGES)[number]
const SECTIONS = ['visitors', 'content', 'performance'] as const
type Section = (typeof SECTIONS)[number]

// 后台：访客统计，按推断位置与 IP 位置对比地区分布，并展示可信度、设备与语言
export function VisitInsightsView() {
  const t = useTranslations('Console.visit_insights')
  const [range, setRange] = useState<Range>(7)
  const [section, setSection] = useState<Section>('visitors')
  const [includeAi, setIncludeAi] = useIncludeAI()
  // 回到这个页面时先显示上次的数据，同时重新请求（见 hooks/use-console-query.ts）
  const insights = useConsoleQuery(['admin/visits/insights', range, includeAi], () => getVisitInsightsAdmin(range, includeAi).then(res => res.data))
  // 请求失败时不显示旧数据（同改前）
  const data = insights.error ? null : (insights.data ?? null)
  const loading = insights.loading

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={section} onValueChange={value => setSection(value as Section)}>
          <TabsList>
            {SECTIONS.map(item => <TabsTrigger key={item} value={item}>{t(`section_${item}`)}</TabsTrigger>)}
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 shrink-0">
            <Switch id="visit-insights-include-ai" checked={includeAi} onCheckedChange={setIncludeAi} />
            <Label htmlFor="visit-insights-include-ai" className="cursor-pointer">{t('include_ai')}</Label>
          </div>
          <Tabs value={String(range)} onValueChange={value => setRange(Number(value) as Range)}>
            <TabsList>
              {RANGES.map(item => <TabsTrigger key={item} value={String(item)}>{t(`range_${item}`)}</TabsTrigger>)}
            </TabsList>
          </Tabs>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t('bot_note')}</p>
      {loading && !data && <Skeleton className="h-64 w-full" />}
      {!loading && !data && <p className="py-8 text-center text-muted-foreground">{t('load_failed')}</p>}
      {data && section === 'visitors' && <InsightsContent data={data} />}
      {data && section === 'content' && <InsightsContentTab data={data} />}
      {data && section === 'performance' && <InsightsPerformanceTab data={data} />}
    </div>
  )
}

function InsightsContent({ data }: { data: VisitInsights }) {
  const t = useTranslations('Console.visit_insights')
  const visitsT = useTranslations('Console.visits')
  const format = useFormatter()
  const countryName = useCountryName()
  const percent = (value: number, total: number) => format.number(total ? value / total : 0, { style: 'percent', maximumFractionDigits: 1 })
  const verdict = (name: string) => count(data.verdicts, name)
  const devices = data.devices.map(item => ({ ...item, name: visitsT(`trust.devices.${item.name === 'bot' ? 'desktop' : item.name}`) }))
  const ruleName = (id: string) => visitsT(`trust.rules.${id}.name`)

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('pv')} value={format.number(data.pv)} hint={t('pv_hint', { count: verdict('bot') })} />
        <StatCard label={t('uv')} value={format.number(data.uv)} hint={t('uv_hint')} />
        <StatCard label={t('proxy_ratio')} value={percent(verdict('proxy'), data.signalVisits)} hint={t('proxy_hint', { count: verdict('proxy'), total: data.signalVisits })} />
        <StatCard label={t('abnormal')} value={format.number(verdict('spoofed') + verdict('bot'))} hint={t('abnormal_hint', { spoofed: verdict('spoofed'), bot: verdict('bot') })} />
      </div>
      <RegionCard data={data} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <CardTitle>{t('verdict_title')}</CardTitle>
            <CardDescription>{t('visits_total', { count: data.total })}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 px-4">
            {data.total > 0 && (
              <div className="flex h-4 gap-0.5 overflow-hidden rounded">
                {VISIT_TRUSTS.filter(item => verdict(item) > 0).map(item => (
                  <Tooltip key={item}>
                    <TooltipTrigger asChild>
                      <span className={TRUST_STYLES[item].fill} style={{ flexGrow: verdict(item) }} />
                    </TooltipTrigger>
                    <TooltipContent>{t('count_tip', { name: visitsT(`trust.verdicts.${item}.label`), count: verdict(item), percent: percent(verdict(item), data.total) })}</TooltipContent>
                  </Tooltip>
                ))}
              </div>
            )}
            <ul className="grid gap-1.5">
              {VISIT_TRUSTS.map(item => (
                <li key={item} className="flex items-center justify-between text-sm">
                  <TrustBadge trust={item} />
                  <span className="text-muted-foreground tabular-nums">{`${format.number(verdict(item))} · ${percent(verdict(item), data.total)}`}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <TrendCard data={data} />
        <BarListCard title={t('proxy_exits_title')} description={t('proxy_exits_hint', { count: verdict('proxy') })} items={data.proxyExits.map(item => ({ ...item, name: countryName(item.name) }))} total={verdict('proxy')} />
        <BarListCard title={t('rules_title')} description={t('rules_hint')} items={data.rules.map(item => ({ ...item, name: ruleName(item.name) }))} total={data.total} wide />
        <BarListCard title={t('devices_title')} items={devices} total={data.total} />
        <BarListCard title={t('os_title')} items={data.os} total={data.total} extra={{ title: t('browsers_title'), items: data.browsers }} />
        <BarListCard title={t('languages_title')} description={t('signal_hint')} items={data.languages} total={data.signalVisits} />
        <BarListCard
          title={t('time_zones_title')}
          description={t('signal_hint')}
          items={data.timeZones}
          total={data.signalVisits}
          wide
          extra={{ title: t('color_schemes_title'), items: data.colorSchemes.map(item => ({ ...item, name: t(`scheme_${item.name === 'dark' ? 'dark' : 'light'}`) })) }}
        />
      </div>
    </div>
  )
}

// 地区排行：同一批带信号的访问，分别按 IP 归属地与推断位置统计
function RegionCard({ data }: { data: VisitInsights }) {
  const t = useTranslations('Console.visit_insights')
  const format = useFormatter()
  const countryName = useCountryName()
  const total = data.signalVisits
  const codes = [...new Set([...data.inferredCountries, ...data.ipCountries].map(item => item.name))]
    .map(code => ({ code, ip: count(data.ipCountries, code), inferred: count(data.inferredCountries, code) }))
    .sort((a, b) => Math.max(b.ip, b.inferred) - Math.max(a.ip, a.inferred))
    .slice(0, 8)
  const max = Math.max(1, ...codes.map(item => Math.max(item.ip, item.inferred)))
  const percent = (value: number) => format.number(total ? value / total : 0, { style: 'percent', maximumFractionDigits: 1 })
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle>{t('region_title')}</CardTitle>
        <CardDescription>{t('region_hint', { count: total })}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 px-4">
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className={cn('size-2.5 rounded-sm', IP_FILL)} />
            {t('legend_ip')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className={cn('size-2.5 rounded-sm', INFERRED_FILL)} />
            {t('legend_inferred')}
          </span>
        </div>
        {codes.length === 0 && <Empty className="py-6"><EmptyDescription>{t('empty')}</EmptyDescription></Empty>}
        {codes.map(item => (
          <Tooltip key={item.code}>
            <TooltipTrigger asChild>
              <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_7.5rem] items-center gap-3 py-0.5 text-sm">
                <span className="truncate">{countryName(item.code)}</span>
                <span className="grid gap-0.5">
                  <span className={cn('h-2 rounded-r', IP_FILL)} style={{ width: `${item.ip / max * 100}%` }} />
                  <span className={cn('h-2 rounded-r', INFERRED_FILL)} style={{ width: `${item.inferred / max * 100}%` }} />
                </span>
                <span className="text-right text-xs text-muted-foreground tabular-nums">
                  {`${percent(item.ip)} → `}
                  <b className="text-foreground">{percent(item.inferred)}</b>
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>{t('region_tip', { ip: item.ip, inferred: item.inferred })}</TooltipContent>
          </Tooltip>
        ))}
        <p className="text-xs text-muted-foreground">{t('region_note')}</p>
      </CardContent>
    </Card>
  )
}

// 每日（今日按小时）访问量，按可信度堆叠
function TrendCard({ data }: { data: VisitInsights }) {
  const t = useTranslations('Console.visit_insights')
  const visitsT = useTranslations('Console.visits')
  const format = useFormatter()
  const totals = data.trend.map(point => VISIT_TRUSTS.reduce((sum, item) => sum + (point.counts[item] ?? 0), 0))
  const max = Math.max(1, ...totals)
  const hourly = data.days === 1
  const labelEvery = data.trend.length > 12 ? Math.ceil(data.trend.length / 8) : 1
  const label = (value: string) => hourly ? value : format.dateTime(new Date(`${value}T00:00:00`), { month: 'numeric', day: 'numeric' })
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle>{t(hourly ? 'trend_hour_title' : 'trend_day_title')}</CardTitle>
        <CardDescription>{t('trend_max', { count: max })}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 px-4">
        <div className="flex h-36 items-end gap-1 border-b">
          {data.trend.map((point, index) => (
            <Tooltip key={point.label}>
              <TooltipTrigger asChild>
                <div className="flex h-full flex-1 items-end justify-center">
                  <div className="flex w-full max-w-5 flex-col-reverse gap-0.5" style={{ height: `${totals[index] / max * 100}%` }}>
                    {VISIT_TRUSTS.filter(item => point.counts[item]).map(item => (
                      <span key={item} className={cn('min-h-0.5 last:rounded-t', TRUST_STYLES[item].fill)} style={{ flexGrow: point.counts[item] }} />
                    ))}
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <div>{`${label(point.label)}${hourly ? t('hour_suffix') : ''} · ${t('visits_total', { count: totals[index] })}`}</div>
                {VISIT_TRUSTS.filter(item => point.counts[item]).map(item => <div key={item}>{`${visitsT(`trust.verdicts.${item}.label`)} ${point.counts[item]}`}</div>)}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
        <div className="flex gap-1 text-[11px] text-muted-foreground">
          {data.trend.map((point, index) => <span key={point.label} className="flex-1 overflow-hidden text-center whitespace-nowrap">{index % labelEvery === 0 ? label(point.label) : ''}</span>)}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {VISIT_TRUSTS.map(item => (
            <span key={item} className="flex items-center gap-1.5">
              <span className={cn('size-2.5 rounded-sm', TRUST_STYLES[item].fill)} />
              {visitsT(`trust.verdicts.${item}.label`)}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
