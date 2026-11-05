'use client'

import type { ReactNode } from 'react'
import type { BackendCoreMetrics, FrontendCoreMetrics, FrontendInstance, FrontendMetrics, RuntimeInstance, RuntimeMetrics } from '@/models/misc'
import { ChevronDown, TriangleAlert } from 'lucide-react'
import { useFormatter, useNow, useTranslations } from 'next-intl'
import { JetBrains_Mono } from 'next/font/google'
import { useEffect, useRef, useState } from 'react'
import { backendMetricsHandler, frontendMetricsHandler, getFrontendMetrics, getRuntimeMetrics } from '@/api/misc'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useErrorMessageT } from '@/hooks/use-translations'
import { cn } from '@/lib/utils'
import { formatDataSize } from '@/utils/common/datasize'
import { RuntimeSparkline } from './runtime-sparkline'

// 指标轮询间隔；各实例每 15 秒上报一次快照
const METRICS_POLL_INTERVAL = 5000
const REPORT_INTERVAL_SECONDS = 15
// CPU（1 核 = 100%）超过这两个值时标「偏高」「过高」
const CPU_WARNING = 70
const CPU_CRITICAL = 90
// 事件循环延迟超过这个值时标「偏高」
const EVENT_LOOP_WARNING_MS = 100
// 各列条形的最小刻度：数值都很小时条形不会被放大成满格
const BAR_FLOOR = { inflight: 5, latency: 200, memory: 256 << 20, goroutines: 200, db: 10, connections: 20, eventLoop: 50 }

const jetBrainsMono = JetBrains_Mono({
  variable: '--font-jet-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
})

/**
 * 轮询拉取数据：页面不可见时暂停，重新可见时立即拉取一次
 * 失败时仅记录错误供卡片内展示，不弹 toast，避免轮询刷屏
 */
function usePolling<T>(fetcher: () => Promise<T>, interval: number) {
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
      if (timer === undefined)
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
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelled = true
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [interval])

  return { data, error }
}

type MetricsHandler = Record<string, (value: number) => string>

function formatMetric(handler: MetricsHandler, key: string, value: unknown) {
  return typeof value === 'number' ? (handler[key]?.(value) ?? String(value)) : String(value)
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)
const formatRate = (v: number) => (v >= 10 ? v.toFixed(0) : v.toFixed(1))
const shortHost = (hostname: string, instanceId: string) => hostname.split('-').at(-1) || instanceId.slice(0, 8)

/**
 * 副本的简称：Pod 名的最后一段（Kubernetes 中各副本不同）；同一主机上跑多个进程等简称重复的情况，再加上实例 ID 的前几位区分
 */
function replicaLabel<T extends { instanceId: string, hostname: string }>(list: T[], item: T) {
  const short = shortHost(item.hostname, item.instanceId)
  const duplicated = list.some(other => other.instanceId !== item.instanceId && shortHost(other.hostname, other.instanceId) === short)
  return duplicated ? `${short}·${item.instanceId.slice(0, 4)}` : short
}

// 各副本的趋势按最近的点对齐后逐点相加（启动时间不同的副本历史长度不一样）
function sumHistories(histories: number[][]) {
  const length = Math.max(0, ...histories.map(h => h.length))
  return Array.from({ length }, (_, i) => sum(histories.map(h => h[h.length - length + i] ?? 0)))
}

/** 一个副本在表格中的统一视图 */
interface Replica {
  id: string
  label: string
  hostname: string
  current: boolean
  startedAt: string
  updatedAt: string
  history: number[]
}

/**
 * 「全部指标」里当前查看的实例：多副本时每次请求可能落到不同实例，默认停留在第一次看到的实例上，
 * 用户选择后保持不变；所选实例下线时回到处理本次请求的实例
 */
function useSelectedInstance<T extends { instanceId: string }>(instances: T[], isCurrent: (item: T) => boolean) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = instances.find(i => i.instanceId === selectedId)
    ?? instances.find(isCurrent)
    ?? instances[0]
    ?? null
  useEffect(() => {
    if (selected && selected.instanceId !== selectedId)
      setSelectedId(selected.instanceId)
  }, [selected, selectedId])
  return [selected, setSelectedId] as const
}

// 系统运行：先看全部前后端副本的核心指标，原来的全部运行时指标收进可展开区域
export function RuntimeCard() {
  const t = useTranslations('Console.dashboard')
  const [open, setOpen] = useState(false)
  const runtime = usePolling<RuntimeMetrics>(() => getRuntimeMetrics().then(res => res.data), METRICS_POLL_INTERVAL)
  const frontend = usePolling<FrontendMetrics>(getFrontendMetrics, METRICS_POLL_INTERVAL)
  const backends = runtime.data?.instances ?? []
  const servingFrontend = frontend.data?.instance ?? null
  // 前端配置了 Redis 时后端能读到全部前端实例；否则只有处理本次请求的那个
  const reportedFrontends = runtime.data?.frontends ?? []
  const frontends = reportedFrontends.length > 0 ? reportedFrontends : (servingFrontend ? [servingFrontend] : [])
  const frontendNotice = frontend.data && !frontend.data.shared
    ? t('runtime_frontend_no_redis')
    : frontend.data && runtime.data && reportedFrontends.length === 0
      ? t('runtime_frontend_not_reported')
      : null
  const loading = !runtime.data

  return (
    <Card className="gap-4 py-4">
      <Collapsible open={open} onOpenChange={setOpen} className="grid gap-4">
        <CardHeader className="px-4">
          <CardTitle>{t('runtime_title')}</CardTitle>
          <CardDescription>
            {loading
              ? t('runtime_description')
              : t('runtime_summary', { count: backends.length + frontends.length, seconds: REPORT_INTERVAL_SECONDS })}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 px-4">
          {!!runtime.error && <MetricsError error={runtime.error} label={t('backend_metrics')} />}
          {!!frontend.error && <MetricsError error={frontend.error} label={t('frontend_metrics')} />}
          <SummaryTiles backends={backends} frontends={frontends} loading={loading} />
          {frontendNotice && (
            <Alert>
              <TriangleAlert className="text-amber-500" aria-hidden="true" />
              <AlertDescription><p>{frontendNotice}</p></AlertDescription>
            </Alert>
          )}
          <ReplicaGroup title={t('runtime_backend_replicas')} subtitle="Go · Hertz">
            {loading
              ? <TableSkeleton />
              : <BackendTable instances={backends} />}
          </ReplicaGroup>
          <ReplicaGroup title={t('runtime_frontend_replicas')} subtitle="Next.js · Node">
            {frontends.length === 0
              ? <TableSkeleton />
              : <FrontendTable instances={frontends} servingId={servingFrontend?.instanceId} />}
          </ReplicaGroup>
          <p className="text-xs text-muted-foreground">{t('runtime_note', { warning: CPU_WARNING, critical: CPU_CRITICAL, seconds: REPORT_INTERVAL_SECONDS })}</p>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="justify-self-start text-muted-foreground">
              {open ? t('runtime_details_hide') : t('runtime_details_show')}
              <ChevronDown className={cn('transition-transform', open && 'rotate-180')} aria-hidden="true" />
            </Button>
          </CollapsibleTrigger>
        </CardContent>
        <CollapsibleContent>
          <CardContent className="grid gap-6 px-4 md:grid-cols-2">
            <InstanceMetrics title={t('backend_metrics')} instances={backends} isCurrent={i => i.current} handler={backendMetricsHandler} reverse />
            <InstanceMetrics title={t('frontend_metrics')} instances={frontends} isCurrent={i => i.instanceId === servingFrontend?.instanceId} handler={frontendMetricsHandler} />
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

function SummaryTiles({ backends, frontends, loading }: { backends: RuntimeInstance[], frontends: FrontendInstance[], loading: boolean }) {
  const t = useTranslations('Console.dashboard')
  const backendHistory = sumHistories(backends.map(i => i.requestsHistory))
  const frontendHistory = sumHistories(frontends.map(i => i.requestsHistory))
  const backendInflight = sum(backends.map(i => i.core.inflightRequests))
  const frontendInflight = sum(frontends.map(i => i.core.inflightRequests))
  const rateTile = (label: string, history: number[], current: number) => ({
    label,
    value: formatRate(current),
    unit: t('runtime_unit_rps'),
    sub: history.length > 0 ? t('runtime_peak', { value: formatRate(Math.max(...history)) }) : '',
    trend: history.length > 1
      ? (
          <RuntimeSparkline
            values={history}
            width={84}
            height={26}
            label={t('runtime_trend_label', { name: label, min: formatRate(Math.min(...history)), max: formatRate(Math.max(...history)), current: formatRate(current) })}
            formatPoint={(value, index) => ({ value: `${formatRate(value)} ${t('runtime_unit_rps')}`, detail: pointAgo(t, history.length - 1 - index) })}
          />
        )
      : null,
  })
  const tiles = [
    rateTile(t('runtime_backend_rps'), backendHistory, sum(backends.map(i => i.core.requestsPerSecond))),
    rateTile(t('runtime_frontend_rps'), frontendHistory, sum(frontends.map(i => i.core.requestsPerSecond))),
    { label: t('runtime_inflight'), value: String(backendInflight + frontendInflight), unit: t('runtime_unit_count'), sub: t('runtime_inflight_split', { backend: backendInflight, frontend: frontendInflight }), trend: null },
    { label: t('runtime_replicas'), value: `${backends.length} + ${frontends.length}`, unit: '', sub: t('runtime_replicas_split'), trend: null },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map(tile => (
        <div key={tile.label} className="grid min-w-0 gap-0.5 rounded-md border px-3 py-2">
          <span className="text-xs text-muted-foreground">{tile.label}</span>
          {loading
            ? <Skeleton className="h-7 w-20" />
            : (
                <div className="flex items-end justify-between gap-2">
                  <span className={cn(jetBrainsMono.className, 'text-xl font-semibold tabular-nums')}>
                    {tile.value}
                    {tile.unit && <span className="ml-1 text-xs font-normal text-muted-foreground">{tile.unit}</span>}
                  </span>
                  {tile.trend}
                </div>
              )}
          <span className="truncate text-xs text-muted-foreground">{loading ? ' ' : tile.sub}</span>
        </div>
      ))}
    </div>
  )
}

function pointAgo(t: ReturnType<typeof useTranslations<'Console.dashboard'>>, stepsAgo: number) {
  return stepsAgo === 0 ? t('runtime_point_latest', { seconds: REPORT_INTERVAL_SECONDS }) : t('runtime_point_ago', { seconds: stepsAgo * REPORT_INTERVAL_SECONDS })
}

function ReplicaGroup({ title, subtitle, children }: { title: string, subtitle: string, children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-muted-foreground">{subtitle}</span>
      </div>
      <div className="overflow-x-auto rounded-md border">{children}</div>
    </section>
  )
}

function TableSkeleton() {
  return (
    <div className="grid gap-2 p-3" aria-busy="true">
      {Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}
    </div>
  )
}

/** 表格的一列：标题与单元格 */
interface Column<T> {
  key: string
  title: string
  render: (row: T) => ReactNode
}

function ReplicaTable<T extends Replica>({ rows, columns }: { rows: T[], columns: Column<T>[] }) {
  const t = useTranslations('Console.dashboard')
  return (
    <Table className="min-w-[60rem]">
      <TableHeader>
        <TableRow>
          <TableHead>{t('runtime_col_replica')}</TableHead>
          {columns.map(col => <TableHead key={col.key}>{col.title}</TableHead>)}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(row => (
          <TableRow key={row.id}>
            <TableCell><ReplicaName replica={row} /></TableCell>
            {columns.map(col => <TableCell key={col.key}>{col.render(row)}</TableCell>)}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function ReplicaName({ replica }: { replica: Replica }) {
  const t = useTranslations('Console.dashboard')
  const format = useFormatter()
  const now = useNow({ updateInterval: METRICS_POLL_INTERVAL })
  const uptime = Math.max(0, (now.getTime() - new Date(replica.startedAt).getTime()) / 1000)
  const [amount, unit] = uptime >= 86400 ? [uptime / 86400, 'day'] : uptime >= 3600 ? [uptime / 3600, 'hour'] : [uptime / 60, 'minute']
  const age = Math.max(0, Math.round((now.getTime() - new Date(replica.updatedAt).getTime()) / 1000))
  return (
    <div className="grid min-w-36 gap-0.5">
      <div className="flex items-center gap-1.5">
        <span className={cn(jetBrainsMono.className, 'font-medium')} title={replica.hostname}>{replica.label}</span>
        {replica.current && <Badge variant="secondary">{t('runtime_instance_serving')}</Badge>}
      </div>
      <span className="text-xs text-muted-foreground">
        {t('runtime_uptime', { duration: format.number(Math.floor(amount), { style: 'unit', unit, unitDisplay: 'long' }) })}
        {!replica.current && ` · ${t('runtime_instance_snapshot', { seconds: age })}`}
      </span>
    </div>
  )
}

type Level = 'warning' | 'critical' | null

/** 数值 + 细条：条形在同一列内比较；悬停或键盘聚焦时显示详细说明 */
function BarCell({ value, unit, ratio, tip, level = null }: { value: string, unit?: string, ratio: number, tip: ReactNode, level?: Level }) {
  const t = useTranslations('Console.dashboard')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div tabIndex={0} className="grid min-w-20 gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className={cn(jetBrainsMono.className, 'flex items-center gap-1 text-sm whitespace-nowrap tabular-nums')}>
            {value}
            {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
            {level && (
              <span className="flex items-center gap-0.5 text-xs font-medium text-foreground">
                <TriangleAlert className={cn('size-3.5', level === 'critical' ? 'text-red-600' : 'text-amber-500')} aria-hidden="true" />
                {level === 'critical' ? t('runtime_level_critical') : t('runtime_level_warning')}
              </span>
            )}
          </span>
          <div className="h-1 overflow-hidden rounded-full bg-primary/15">
            <div
              className={cn('h-full rounded-full', level === 'critical' ? 'bg-red-600' : level === 'warning' ? 'bg-amber-400' : 'bg-primary')}
              style={{ width: `${Math.max(2, Math.min(100, ratio * 100))}%` }}
            />
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}

/** 提示内容：数值在前，说明在后 */
function Tip({ value, lines }: { value: string, lines: string[] }) {
  return (
    <div className="grid gap-0.5">
      <span className="font-semibold tabular-nums">{value}</span>
      {lines.map(line => <span key={line} className="opacity-80">{line}</span>)}
    </div>
  )
}

const scaleOf = (values: number[], floor: number) => Math.max(floor, ...values)
const megabytes = (bytes: number) => String(Math.round(bytes / (1 << 20)))
const cpuLevel = (percent: number): Level => (percent > CPU_CRITICAL ? 'critical' : percent > CPU_WARNING ? 'warning' : null)

/** 两张表共有的列：请求/秒（趋势）、进行中、平均延迟、CPU、内存 */
function useCommonColumns<T extends Replica & { core: BackendCoreMetrics | FrontendCoreMetrics }>(rows: T[], kind: 'backend' | 'frontend'): Column<T>[] {
  const t = useTranslations('Console.dashboard')
  const historyMax = Math.max(0, ...rows.flatMap(r => r.history))
  const inflightScale = scaleOf(rows.map(r => r.core.inflightRequests), BAR_FLOOR.inflight)
  const latencyScale = scaleOf(rows.map(r => r.core.avgLatencyMs), BAR_FLOOR.latency)
  const memoryScale = scaleOf(rows.map(r => r.core.memoryRss), BAR_FLOOR.memory)
  return [
    {
      key: 'rps',
      title: t('runtime_col_rps'),
      render: (r) => {
        const name = r.label
        const history = r.history.length > 0 ? r.history : [r.core.requestsPerSecond]
        return (
          <div className="flex min-w-44 items-center gap-2">
            <RuntimeSparkline
              values={history}
              scaleMax={historyMax}
              label={t('runtime_trend_label', { name, min: formatRate(Math.min(...history)), max: formatRate(Math.max(...history)), current: formatRate(r.core.requestsPerSecond) })}
              formatPoint={(value, index) => ({ value: `${formatRate(value)} ${t('runtime_unit_rps')}`, detail: `${name} · ${pointAgo(t, history.length - 1 - index)}` })}
            />
            <span className={cn(jetBrainsMono.className, 'min-w-10 text-right text-sm tabular-nums')}>{formatRate(r.core.requestsPerSecond)}</span>
          </div>
        )
      },
    },
    {
      key: 'inflight',
      title: t('runtime_col_inflight'),
      render: r => (
        <BarCell
          value={String(r.core.inflightRequests)}
          unit={t('runtime_unit_count')}
          ratio={r.core.inflightRequests / inflightScale}
          tip={<Tip value={`${r.core.inflightRequests} ${t('runtime_unit_count')}`} lines={[t(kind === 'backend' ? 'runtime_tip_inflight_backend' : 'runtime_tip_inflight_frontend')]} />}
        />
      ),
    },
    {
      key: 'latency',
      title: t('runtime_col_latency'),
      render: r => (
        <BarCell
          value={String(Math.round(r.core.avgLatencyMs))}
          unit="ms"
          ratio={r.core.avgLatencyMs / latencyScale}
          tip={<Tip value={`${Math.round(r.core.avgLatencyMs)} ms`} lines={[t('runtime_tip_latency', { seconds: REPORT_INTERVAL_SECONDS }), t('runtime_tip_errors', { rate: (r.core.errorRate * 100).toFixed(1) })]} />}
        />
      ),
    },
    {
      key: 'cpu',
      title: 'CPU',
      render: r => (
        <BarCell
          value={String(Math.round(r.core.cpuPercent))}
          unit="%"
          ratio={r.core.cpuPercent / 100}
          level={cpuLevel(r.core.cpuPercent)}
          tip={<Tip value={`${r.core.cpuPercent.toFixed(1)}%`} lines={[t('runtime_tip_cpu', { cores: (r.core.cpuPercent / 100).toFixed(2) })]} />}
        />
      ),
    },
    {
      key: 'memory',
      title: t('runtime_col_memory'),
      render: (r) => {
        const heap = 'heapInuse' in r.core ? r.core.heapInuse : r.core.heapUsed
        return (
          <BarCell
            value={megabytes(r.core.memoryRss)}
            unit="MB"
            ratio={r.core.memoryRss / memoryScale}
            tip={<Tip value={formatDataSize({ size: r.core.memoryRss })} lines={[t(kind === 'backend' ? 'runtime_tip_memory_go' : 'runtime_tip_memory_node', { heap: formatDataSize({ size: heap }) })]} />}
          />
        )
      },
    },
  ]
}

function BackendTable({ instances }: { instances: RuntimeInstance[] }) {
  const t = useTranslations('Console.dashboard')
  const rows = instances.map(i => ({ ...i, id: i.instanceId, label: replicaLabel(instances, i), history: i.requestsHistory }))
  const common = useCommonColumns(rows, 'backend')
  const goroutineScale = scaleOf(rows.map(r => r.core.goroutines), BAR_FLOOR.goroutines)
  const dbScale = scaleOf(rows.map(r => r.core.dbOpen), BAR_FLOOR.db)
  const columns: Column<(typeof rows)[number]>[] = [
    ...common,
    {
      key: 'goroutines',
      title: 'Goroutine',
      render: r => (
        <BarCell
          value={r.core.goroutines.toLocaleString()}
          ratio={r.core.goroutines / goroutineScale}
          tip={<Tip value={r.core.goroutines.toLocaleString()} lines={[t('runtime_tip_goroutines')]} />}
        />
      ),
    },
    {
      key: 'db',
      title: t('runtime_col_db'),
      render: r => (
        <BarCell
          value={`${r.core.dbInUse}/${r.core.dbOpen}`}
          unit={t('runtime_unit_db')}
          ratio={r.core.dbOpen / dbScale}
          tip={<Tip value={t('runtime_tip_db', { inUse: r.core.dbInUse, open: r.core.dbOpen })} lines={[t('runtime_tip_db_pool')]} />}
        />
      ),
    },
  ]
  return <ReplicaTable rows={rows} columns={columns} />
}

function FrontendTable({ instances, servingId }: { instances: FrontendInstance[], servingId?: string }) {
  const t = useTranslations('Console.dashboard')
  const rows = instances.map(i => ({ ...i, id: i.instanceId, label: replicaLabel(instances, i), current: i.instanceId === servingId, history: i.requestsHistory }))
  const common = useCommonColumns(rows, 'frontend')
  const connectionScale = scaleOf(rows.map(r => r.core.connections), BAR_FLOOR.connections)
  const loopScale = scaleOf(rows.map(r => r.core.eventLoopP99Ms), BAR_FLOOR.eventLoop)
  const columns: Column<(typeof rows)[number]>[] = [
    ...common,
    {
      key: 'connections',
      title: t('runtime_col_connections'),
      render: r => (
        <BarCell
          value={String(r.core.connections)}
          unit={t('runtime_unit_count')}
          ratio={r.core.connections / connectionScale}
          tip={<Tip value={`${r.core.connections} ${t('runtime_unit_count')}`} lines={[t('runtime_tip_connections')]} />}
        />
      ),
    },
    {
      key: 'event_loop',
      title: t('runtime_col_event_loop'),
      render: r => (
        <BarCell
          value={String(Math.round(r.core.eventLoopP99Ms))}
          unit="ms"
          ratio={r.core.eventLoopP99Ms / loopScale}
          level={r.core.eventLoopP99Ms > EVENT_LOOP_WARNING_MS ? 'warning' : null}
          tip={<Tip value={`p99 ${r.core.eventLoopP99Ms.toFixed(1)} ms`} lines={[t('runtime_tip_event_loop')]} />}
        />
      ),
    },
  ]
  return <ReplicaTable rows={rows} columns={columns} />
}

/** 「全部指标」：按实例查看完整的运行时指标 */
function InstanceMetrics<T extends { instanceId: string, hostname: string, pid: number, metrics: Record<string, unknown> }>({ title, instances, isCurrent, handler, reverse = false }: {
  title: string
  instances: T[]
  isCurrent: (item: T) => boolean
  handler: MetricsHandler
  reverse?: boolean // 后端指标按接口返回的倒序展示，与之前的排列保持一致
}) {
  const t = useTranslations('Console.dashboard')
  const [instance, setInstance] = useSelectedInstance(instances, isCurrent)
  const entries = instance ? Object.entries(instance.metrics) : []
  if (reverse)
    entries.reverse()
  return (
    <div className="grid content-start gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {instances.length > 1 && instance && (
        <Select value={instance.instanceId} onValueChange={setInstance}>
          <SelectTrigger size="sm" className="w-auto min-w-48 justify-self-start" aria-label={t('runtime_instance')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {instances.map(item => (
              <SelectItem key={item.instanceId} value={item.instanceId}>
                <span className={jetBrainsMono.className}>{replicaLabel(instances, item)}</span>
                <span className="text-muted-foreground">{`PID ${item.pid}`}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {instance
        ? (
            <dl className="grid gap-1.5 text-sm">
              {entries.map(([key, value]) => (
                <div key={key} className="flex items-center justify-between gap-3 leading-relaxed">
                  <dt className="text-muted-foreground">{t.has(key) ? t(key) : key}</dt>
                  <dd className={cn(jetBrainsMono.className, 'text-right tabular-nums')}>{formatMetric(handler, key, value)}</dd>
                </div>
              ))}
            </dl>
          )
        : (
            <div className="grid gap-2" aria-busy="true">
              {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-5 w-full" />)}
            </div>
          )}
    </div>
  )
}

// 轮询失败在卡片内常驻提示，已有数据时继续展示旧数据
function MetricsError({ error, label }: { error: unknown, label: string }) {
  const t = useTranslations('Console.dashboard')
  const errorMessageT = useErrorMessageT()
  const message = errorMessageT(error)
  return (
    <Alert variant="destructive">
      <AlertDescription>
        {label}
        {' '}
        {t('load_failed')}
        {message && `: ${message}`}
      </AlertDescription>
    </Alert>
  )
}
