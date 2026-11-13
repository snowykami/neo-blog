'use client'

import type { ReactNode } from 'react'
import type { VisitDetail, VisitLog, VisitRuleResult, VisitSeverity, VisitSignalsDetail, VisitTrustResult } from '@/models/visit'
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon, GlobeIcon, InfoIcon, LanguagesIcon, MapPinIcon, MinusIcon, MonitorIcon, SmartphoneIcon, TabletIcon, TriangleAlertIcon, XIcon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { getVisitDetailAdmin } from '@/api/admin'
import { SourceIcon, SourceName } from '@/components/console/visit-icons'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import { consolePath, getTargetViewUrl } from '@/utils/common/route'
import { formatDuration, formatOffset, useCountryName, useRuleText } from './format'
import { IpAddress } from './ip-address'
import { SeverityBadge, TRUST_STYLES, TrustBadge } from './trust-badge'

const SEVERITY_ORDER: Record<string, number> = { high: 3, medium: 2, low: 1, info: 0 }
const SEVERITY_ICON = { high: 'text-red-600', medium: 'text-orange-600', low: 'text-amber-600' }

// 后台：单次访问详情，展示全部信号、位置判断与每条一致性规则的结果
export function VisitDetailView() {
  const t = useTranslations('Console.visits.detail')
  const { id } = useParams() as { id: string }
  const [detail, setDetail] = useState<VisitDetail | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    setStatus('loading')
    getVisitDetailAdmin(Number(id))
      .then((res) => {
        setDetail(res.data)
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
  }, [id])

  return (
    <div className="grid gap-4">
      <Link href={consolePath.visit} className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeftIcon className="size-4" />
        {t('back')}
      </Link>
      {status === 'loading' && <Skeleton className="h-40 w-full" />}
      {status === 'error' && <p className="py-8 text-center text-muted-foreground">{t('not_found')}</p>}
      {status === 'ready' && detail && (
        <>
          <OverviewCard visit={detail.visit} trust={detail.trust} />
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <div className="grid gap-4">
              {detail.trust && <LocationCard visit={detail.visit} trust={detail.trust} />}
              {detail.trust && <RulesCard rules={detail.trust.rules} />}
              {detail.history.length > 1 && <HistoryCard history={detail.history} currentId={detail.visit.id} />}
            </div>
            <SignalsCard visit={detail.visit} signals={detail.signals} />
          </div>
        </>
      )}
    </div>
  )
}

function DeviceIcon({ deviceType, className }: { deviceType: string, className?: string }) {
  const Icon = deviceType === 'mobile' ? SmartphoneIcon : deviceType === 'tablet' ? TabletIcon : MonitorIcon
  return <Icon className={className} aria-hidden="true" />
}

// 访问的地区：IP 可信时显示 IP 归属地，否则显示推断的国家
function useVisitPlace() {
  const t = useTranslations('Console.visits')
  const countryName = useCountryName()
  return (visit: VisitLog) => {
    const inferred = Boolean(visit.trust && !visit.ipTrusted && visit.inferredCountry)
    return { inferred, text: inferred ? countryName(visit.inferredCountry) : (visit.location || t('unknown_location')) }
  }
}

function OverviewCard({ visit, trust }: { visit: VisitLog, trust: VisitTrustResult | null }) {
  const t = useTranslations('Console.visits')
  const format = useFormatter()
  const place = useVisitPlace()(visit)
  const subject = visit.subject
  // 私密文章 / 页面前台 404，链到后台预览
  const href = subject ? getTargetViewUrl(subject) : visit.path
  const hits = trust?.rules.filter(rule => rule.status === 'hit' && rule.severity !== 'info').length ?? 0
  const knownVerdict = trust && trust.verdict in TRUST_STYLES ? trust.verdict : 'unknown'
  return (
    <Card className="gap-3 px-5 py-4">
      <div className="flex flex-wrap items-center gap-2 text-lg font-semibold">
        <DeviceIcon deviceType={visit.deviceType} className="size-5 text-muted-foreground" />
        {place.text}
        {place.inferred && <Badge variant="secondary" title={t('inferred_hint')}>{t('inferred')}</Badge>}
        {trust && <TrustBadge trust={trust.verdict} />}
      </div>
      {trust && <p className="text-sm text-muted-foreground">{t(`trust.verdicts.${knownVerdict}.why`)}</p>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <Link href={href} target="_blank" className="font-medium text-foreground hover:text-primary hover:underline">{subject?.title || visit.path}</Link>
        <time dateTime={visit.createdAt}>{format.dateTime(new Date(visit.createdAt), { dateStyle: 'medium', timeStyle: 'medium' })}</time>
        {visit.source && (
          <span className="flex items-center gap-1">
            <SourceIcon source={visit.source} className="size-3" />
            <SourceName source={visit.source} host={visit.sourceHost} />
          </span>
        )}
        {visit.visitorId
          ? <Link href={`${consolePath.visit}?visitor=${visit.visitorId}`} className="hover:text-primary">{t('detail.visitor', { id: visit.visitorId, count: visit.visitCount })}</Link>
          : <span>{t('detail.no_visitor')}</span>}
        {visit.action === 'visit' && (
          <span>
            {visit.engagedMs !== null
              ? t('detail.engagement', { time: formatDuration(visit.engagedMs), depth: visit.scrollDepth ?? 0 })
              : t('detail.no_engagement')}
          </span>
        )}
      </div>
      {trust?.score !== null && trust?.score !== undefined && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>{t('detail.score')}</span>
          <Progress value={trust.score} className="h-2 w-44" aria-label={t('detail.score')} />
          <span className="font-semibold text-foreground tabular-nums">{t('detail.score_value', { score: trust.score })}</span>
          <span>{t('detail.hits', { count: hits })}</span>
        </div>
      )}
    </Card>
  )
}

// 位置判断：IP、时区、语言三个依据的投票过程
function LocationCard({ visit, trust }: { visit: VisitLog, trust: VisitTrustResult }) {
  const t = useTranslations('Console.visits')
  const countryName = useCountryName()
  const icons = { ip: GlobeIcon, tz: ClockIcon, lang: LanguagesIcon }
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle>{t('detail.location_title')}</CardTitle>
        <CardDescription>{t('detail.location_hint')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 px-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('detail.col_source')}</TableHead>
              <TableHead>{t('detail.col_value')}</TableHead>
              <TableHead>{t('detail.col_country')}</TableHead>
              <TableHead>{t('detail.col_weight')}</TableHead>
              <TableHead>{t('detail.col_result')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trust.sources.map((source) => {
              const Icon = icons[source.key] ?? GlobeIcon
              const sourceKey = `trust.sources.${source.key}` as const
              const noteKey = source.note ? (`trust.notes.${source.note}` as const) : null
              return (
                <TableRow key={source.key}>
                  <TableCell>
                    <span className="flex items-center gap-1.5">
                      <Icon className="size-4 text-muted-foreground" />
                      {t.has(sourceKey) ? t(sourceKey) : source.key}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <div>{source.value || '—'}</div>
                    {noteKey && <div className="text-xs text-muted-foreground">{t.has(noteKey) ? t(noteKey) : source.note}</div>}
                  </TableCell>
                  <TableCell>{source.country ? countryName(source.country) : '—'}</TableCell>
                  <TableCell className="tabular-nums">{source.weight}</TableCell>
                  <TableCell>
                    {source.agree === true && (
                      <span className="flex items-center gap-1 text-xs">
                        <CheckIcon className="size-3.5 text-emerald-600" />
                        {t('detail.agree')}
                      </span>
                    )}
                    {source.agree === false && (
                      <span className="flex items-center gap-1 text-xs">
                        <XIcon className="size-3.5 text-red-600" />
                        {t('detail.conflict')}
                      </span>
                    )}
                    {source.agree === null && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MinusIcon className="size-3.5" />
                        {t('detail.ignored')}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        <div className="flex gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
          <MapPinIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p>
            {trust.country
              ? t('detail.inferred_result', { country: countryName(trust.country), confidence: t(`trust.confidence.${trust.confidence || 'low'}`) })
              : t('detail.cannot_infer')}
            {' '}
            {trust.ipTrusted
              ? t('detail.ip_trusted')
              : visit.location && t(trust.country && trust.country !== visit.ipCountry ? 'detail.ip_exit' : 'detail.ip_untrusted', { location: visit.location })}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function RulesCard({ rules }: { rules: VisitRuleResult[] }) {
  const t = useTranslations('Console.visits.detail')
  const hits = rules.filter(rule => rule.status === 'hit').sort((a, b) => (SEVERITY_ORDER[b.severity] ?? -1) - (SEVERITY_ORDER[a.severity] ?? -1))
  const passes = rules.filter(rule => rule.status === 'pass')
  const skips = rules.filter(rule => rule.status === 'skip')
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardTitle>{t('rules_title')}</CardTitle>
        <CardDescription>{t('rules_summary', { hit: hits.length, pass: passes.length, skip: skips.length })}</CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        {hits.length === 0
          ? (
              <p className="flex items-center gap-2 py-2 text-sm">
                <CheckIcon className="size-4 text-emerald-600" />
                {t('no_hits')}
              </p>
            )
          : hits.map(rule => <RuleItem key={rule.id} rule={rule} />)}
        <RuleGroup title={t('passed', { count: passes.length })} rules={passes} />
        <RuleGroup title={t('skipped', { count: skips.length })} rules={skips} />
      </CardContent>
    </Card>
  )
}

function RuleGroup({ title, rules }: { title: string, rules: VisitRuleResult[] }) {
  if (rules.length === 0)
    return null
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex cursor-pointer items-center gap-1 pt-2 text-sm text-muted-foreground hover:text-foreground">
        <ChevronRightIcon className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent>
        {rules.map(rule => <RuleItem key={rule.id} rule={rule} />)}
      </CollapsibleContent>
    </Collapsible>
  )
}

function RuleItem({ rule }: { rule: VisitRuleResult }) {
  const t = useTranslations('Console.visits.trust')
  const detailT = useTranslations('Console.visits.detail')
  const ruleText = useRuleText()
  const hit = rule.status === 'hit' && rule.severity
  const ruleNameKey = `rules.${rule.id}.name` as const
  const ruleWhyKey = `rules.${rule.id}.why` as const
  const categoryKey = `categories.${rule.category}` as const
  let icon: ReactNode = <MinusIcon className="mt-0.5 size-4 text-muted-foreground" />
  if (hit)
    icon = rule.severity === 'info' ? <InfoIcon className="mt-0.5 size-4 text-sky-600" /> : <TriangleAlertIcon className={cn('mt-0.5 size-4', SEVERITY_ICON[rule.severity as keyof typeof SEVERITY_ICON] ?? SEVERITY_ICON.low)} />
  else if (rule.status === 'pass')
    icon = <CheckIcon className="mt-0.5 size-4 text-emerald-600" />
  return (
    <div className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2 gap-y-0.5 border-b py-2.5 last:border-b-0">
      {icon}
      <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
        {t.has(ruleNameKey) ? t(ruleNameKey) : rule.id}
        {hit && <SeverityBadge severity={rule.severity as VisitSeverity} />}
        <Badge variant="outline" className="font-normal text-muted-foreground">{t.has(categoryKey) ? t(categoryKey) : rule.category}</Badge>
      </div>
      <div className="col-start-2 text-sm text-muted-foreground">
        {ruleText(rule)}
        {hit && t.has(ruleWhyKey) && <div className="text-xs">{detailT('why', { why: t(ruleWhyKey) })}</div>}
      </div>
    </div>
  )
}

function HistoryCard({ history, currentId }: { history: VisitLog[], currentId: number }) {
  const t = useTranslations('Console.visits.detail')
  const format = useFormatter()
  const place = useVisitPlace()
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardTitle>{t('history_title')}</CardTitle>
      </CardHeader>
      <CardContent className="px-2">
        {history.map(item => (
          <Link
            key={item.id}
            href={`${consolePath.visit}/${item.id}`}
            className={cn('grid grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent', item.id === currentId && 'bg-accent/60 font-medium')}
          >
            <time className="text-xs text-muted-foreground" dateTime={item.createdAt}>{format.relativeTime(new Date(item.createdAt))}</time>
            <span className="truncate">
              {place(item).text}
              <span className="text-xs text-muted-foreground">{` · ${item.subject?.title || item.path}`}</span>
            </span>
            {item.trust && <TrustBadge trust={item.trust} />}
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}

// 全部信号：浏览器上报、请求头与服务器推算
function SignalsCard({ visit, signals }: { visit: VisitLog, signals: VisitSignalsDetail }) {
  const t = useTranslations('Console.visits.detail')
  const trustT = useTranslations('Console.visits.trust')
  const countryName = useCountryName()
  const none = t('not_collected')
  const yesNo = (value: boolean) => t(value ? 'yes' : 'no')
  const s = signals
  const groups: { title: string, rows: [string, ReactNode][] | null }[] = [
    {
      title: t('groups.network'),
      rows: [
        [t('fields.ip'), visit.ip ? <IpAddress ip={visit.ip} /> : t('not_saved')],
        [t('fields.location'), visit.location || '—'],
        [t('fields.country'), visit.ipCountry ? `${countryName(visit.ipCountry)} (${visit.ipCountry})` : '—'],
        [t('fields.isp'), s.isp || '—'],
        [t('fields.datacenter'), yesNo(s.datacenter)],
        [t('fields.prev_country'), s.prevCountry ? countryName(s.prevCountry) : '—'],
      ],
    },
    {
      title: t('groups.headers'),
      rows: [
        ['User-Agent', <span key="ua" className="font-mono text-xs">{s.userAgent || t('not_saved')}</span>],
        [t('fields.parsed'), `${visit.os || '—'} · ${visit.browser || '—'} · ${visit.deviceType ? trustT(`devices.${visit.deviceType === 'bot' ? 'desktop' : visit.deviceType}`) : '—'}`],
        ['Accept-Language', s.acceptLanguage || none],
        ['Sec-CH-UA', s.chBrands || t('not_sent')],
        ['Sec-CH-UA-Platform', s.chPlatform || t('not_sent')],
        ['Sec-CH-UA-Mobile', s.chMobile === null ? t('not_sent') : (s.chMobile ? '?1' : '?0')],
        [t('fields.dnt'), visit.action === 'visit' && !visit.visitorId ? t('dnt_on') : t('dnt_off')],
      ],
    },
    {
      title: t('groups.locale'),
      rows: s.hasSignals
        ? [
            [t('fields.time_zone'), s.timeZone || '—'],
            [t('fields.utc_offset'), formatOffset(s.utcOffset)],
            [t('fields.languages'), s.languages.join(', ') || '—'],
          ]
        : null,
    },
    {
      title: t('groups.device'),
      rows: s.hasSignals
        ? [
            [t('fields.screen'), s.screen ? `${s.screen.replace('x', '×')} @${s.dpr}x` : '—'],
            [t('fields.touch_points'), s.touchPoints ?? '—'],
            [t('fields.pointer'), s.pointer ? trustT(`pointers.${s.pointer === 'coarse' ? 'coarse' : 'fine'}`) : '—'],
          ]
        : null,
    },
    {
      title: t('groups.prefs'),
      rows: s.hasSignals
        ? [
            [t('fields.color_scheme'), s.colorScheme ? t(s.colorScheme === 'dark' ? 'scheme_dark' : 'scheme_light') : '—'],
            ['navigator.webdriver', String(s.webdriver)],
          ]
        : null,
    },
  ]
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle>{t('signals_title')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 px-4">
        {groups.map(group => (
          <div key={group.title} className="grid gap-1">
            <h4 className="text-xs font-medium text-muted-foreground">{group.title}</h4>
            {group.rows
              ? group.rows.map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-2 border-b border-dashed py-1.5 text-sm last:border-b-0">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="break-all">{value}</span>
                  </div>
                ))
              : <p className="text-sm text-muted-foreground">{t('signals_missing')}</p>}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
