'use client'

import type { ReactNode } from 'react'
import type { Level } from './runtime-shared'
import type { DatabaseMetrics, DependencyMetrics, RedisMetrics } from '@/models/misc'
import { Check, Database, Layers, TriangleAlert } from 'lucide-react'
import { useNow, useTranslations } from 'next-intl'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { formatDataSize } from '@/utils/common/datasize'
import { formatRate, jetBrainsMono, pointAgo, Tip } from './runtime-shared'
import { RuntimeSparkline } from './runtime-sparkline'

// 依赖服务：数据库与 Redis 各一张小卡。左边是最怕满的那一项（连接数 / 内存），右边是速率趋势，下面是次要指标

// 连接数、内存占上限的比例超过这两个值时标「偏高」「将满」
const USAGE_WARNING = 0.8
const USAGE_CRITICAL = 0.95
const CACHE_HIT_WARNING = 0.99
const LONG_QUERY_WARNING_SECONDS = 30
const REDIS_CPU_WARNING = 70

const usageLevel = (ratio: number): Level => (ratio > USAGE_CRITICAL ? 'critical' : ratio > USAGE_WARNING ? 'warning' : null)
const percent = (ratio: number, digits = 1) => `${(ratio * 100).toFixed(digits)}%`

export function DependencyCards({ metrics, loading }: { metrics: DependencyMetrics | null, loading: boolean }) {
  const t = useTranslations('Console.dashboard')
  const now = useNow({ updateInterval: 5000 })
  const age = metrics ? Math.max(0, Math.round((now.getTime() - new Date(metrics.updatedAt).getTime()) / 1000)) : null
  return (
    <section className="@container grid gap-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold">{t('runtime_dependencies')}</h3>
        {age !== null && <span className="text-xs text-muted-foreground">{t('runtime_dependencies_updated', { seconds: age })}</span>}
      </div>
      <div className="grid gap-3 @3xl:grid-cols-2">
        {loading || !metrics
          ? Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-56 w-full" />)
          : (
              <>
                {metrics.database ? <DatabaseCard db={metrics.database} /> : <Skeleton className="h-56 w-full" />}
                {metrics.redis ? <RedisCard redis={metrics.redis} /> : <NoRedisCard />}
              </>
            )}
      </div>
      {/* 阈值说明只针对 Postgres 与 Redis，SQLite 且没有 Redis 时不显示 */}
      {(metrics?.database?.driver === 'postgres' || metrics?.redis) && (
        <p className="text-xs text-muted-foreground">{t('runtime_dependencies_note', { warning: USAGE_WARNING * 100, critical: USAGE_CRITICAL * 100 })}</p>
      )}
    </section>
  )
}

function DepCard({ icon, title, subtitle, status, children }: { icon: ReactNode, title: string, subtitle: string, status: ReactNode, children: ReactNode }) {
  return (
    <div className="@container grid min-w-0 content-start gap-3 rounded-md border p-3">
      {/* 窄屏时状态徽标换到下一行，不把标题挤没 */}
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
        <span className="mt-0.5 text-muted-foreground">{icon}</span>
        <div className="grid min-w-40 flex-1">
          <span className="text-sm font-semibold">{title}</span>
          <span className={cn(jetBrainsMono.className, 'truncate text-xs text-muted-foreground')} title={subtitle}>{subtitle}</span>
        </div>
        {status}
      </div>
      {children}
    </div>
  )
}

/** 状态徽标：正常时绿勾；有问题时直接写出问题，图标与文字一起出现 */
function StatusBadge({ problems, level }: { problems: string[], level: Level }) {
  const t = useTranslations('Console.dashboard')
  const ok = problems.length === 0
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border px-2 text-xs leading-5 text-muted-foreground">
      {ok
        ? <Check className="size-3.5 shrink-0 text-green-600" aria-hidden="true" />
        : <TriangleAlert className={cn('size-3.5 shrink-0', level === 'critical' ? 'text-red-600' : 'text-amber-500')} aria-hidden="true" />}
      <span className="truncate">{ok ? t('runtime_status_ok') : problems.join(' · ')}</span>
    </span>
  )
}

function LevelFlag({ level, labels }: { level: Level, labels?: { warning: string, critical: string } }) {
  const t = useTranslations('Console.dashboard')
  if (!level)
    return null
  const text = level === 'critical' ? (labels?.critical ?? t('runtime_level_full')) : (labels?.warning ?? t('runtime_level_warning'))
  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-medium text-foreground">
      <TriangleAlert className={cn('size-3.5', level === 'critical' ? 'text-red-600' : 'text-amber-500')} aria-hidden="true" />
      {text}
    </span>
  )
}

/** 悬停或键盘聚焦时显示说明的区块 */
function Hint({ tip, className, children }: { tip: ReactNode, className?: string, children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div tabIndex={0} className={cn('min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}>{children}</div>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}

function Stat({ label, value, tip, level = null }: { label: string, value: string, tip: ReactNode, level?: Level }) {
  return (
    <Hint tip={tip} className="grid">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn(jetBrainsMono.className, 'flex items-center gap-1 text-sm font-medium tabular-nums')}>
        {value}
        {level && <TriangleAlert className={cn('size-3.5', level === 'critical' ? 'text-red-600' : 'text-amber-500')} aria-label={level} />}
      </span>
    </Hint>
  )
}

/** 速率趋势：标签 + 迷你趋势线 + 当前值 */
function Trend({ label, values, current, unit, name }: { label: string, values: number[], current: number, unit: string, name: string }) {
  const t = useTranslations('Console.dashboard')
  const history = values.length > 0 ? values : [current]
  return (
    <div className="grid justify-items-start gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-end gap-2">
        <RuntimeSparkline
          values={history}
          width={140}
          height={32}
          label={t('runtime_dep_trend_label', { name, min: formatRate(Math.min(...history)), max: formatRate(Math.max(...history)), current: formatRate(current) })}
          formatPoint={(value, index) => ({ value: `${formatRate(value)} ${unit}`, detail: `${name} · ${pointAgo(t, history.length - 1 - index)}` })}
        />
        <span className={cn(jetBrainsMono.className, 'text-xl leading-none font-semibold tabular-nums')}>{formatRate(current)}</span>
      </div>
    </div>
  )
}

function DatabaseCard({ db }: { db: DatabaseMetrics }) {
  const t = useTranslations('Console.dashboard')
  const isPostgres = db.driver === 'postgres'
  const title = isPostgres ? 'PostgreSQL' : 'SQLite'
  const subtitle = `${title} ${db.version} · ${db.location}`
  if (db.error) {
    return (
      <DepCard icon={<Database className="size-4" />} title={title} subtitle={db.location || title} status={<StatusBadge problems={[t('runtime_unavailable')]} level="critical" />}>
        <p className="text-sm text-muted-foreground">{t('runtime_database_unavailable')}</p>
      </DepCard>
    )
  }
  if (!isPostgres) {
    return (
      <DepCard icon={<Database className="size-4" />} title={title} subtitle={subtitle} status={<StatusBadge problems={[]} level={null} />}>
        <div className="grid grid-cols-3 gap-x-3 gap-y-2">
          <Stat label={t('runtime_db_size')} value={formatDataSize({ size: db.sizeBytes })} tip={<Tip value={formatDataSize({ size: db.sizeBytes })} lines={[t('runtime_tip_sqlite_file')]} />} />
          <Stat label={t('runtime_db_wal')} value={formatDataSize({ size: db.walBytes })} tip={<Tip value={formatDataSize({ size: db.walBytes })} lines={[t('runtime_tip_sqlite_wal')]} />} />
          <Stat label={t('runtime_db_pool')} value={`${db.poolInUse}/${db.poolOpen}`} tip={<Tip value={t('runtime_tip_db', { inUse: db.poolInUse, open: db.poolOpen })} lines={[t('runtime_tip_sqlite_single')]} />} />
        </div>
        <p className="text-xs text-muted-foreground">{t('runtime_sqlite_note')}</p>
      </DepCard>
    )
  }

  const max = Math.max(1, db.maxConnections)
  const ratio = db.totalConnections / max
  const level = usageLevel(ratio)
  const other = Math.max(0, db.totalConnections - db.active - db.idleInTransaction - db.idle)
  const problems = [
    level && t(level === 'critical' ? 'runtime_problem_connections_full' : 'runtime_problem_connections'),
    db.waiting > 0 && t('runtime_problem_waiting', { count: db.waiting }),
    db.deadlocksRecent > 0 && t('runtime_problem_deadlocks'),
  ].filter((p): p is string => Boolean(p))
  const statusLevel: Level = db.deadlocksRecent > 0 || level === 'critical' ? 'critical' : problems.length > 0 ? 'warning' : null
  // 几种状态各用同一主题色的深浅，偏高 / 将满由旁边的图标和文字标出
  const segments = [
    { key: 'active', label: t('runtime_conn_active'), count: db.active, className: 'bg-primary' },
    { key: 'idle_tx', label: t('runtime_conn_idle_tx'), count: db.idleInTransaction, className: 'bg-primary/65' },
    { key: 'idle', label: t('runtime_conn_idle'), count: db.idle, className: 'bg-primary/35' },
    { key: 'other', label: t('runtime_conn_other'), count: other, className: 'bg-muted-foreground/40' },
  ]
  const longest = `${db.longestQuerySeconds.toFixed(1)} s`

  return (
    <DepCard icon={<Database className="size-4" />} title={title} subtitle={subtitle} status={<StatusBadge problems={problems} level={statusLevel} />}>
      <div className="grid items-end gap-4 @sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Hint
          className="grid gap-1"
          tip={(
            <Tip
              value={`${db.totalConnections} / ${db.maxConnections}`}
              lines={[
                segments.map(s => `${s.label} ${s.count}`).join(' · '),
                db.waiting > 0 ? t('runtime_problem_waiting', { count: db.waiting }) : t('runtime_tip_no_waiting'),
                t('runtime_tip_idle_tx'),
              ]}
            />
          )}
        >
          <span className="text-xs text-muted-foreground">{t('runtime_db_connections')}</span>
          <span className={cn(jetBrainsMono.className, 'flex flex-wrap items-baseline gap-1 tabular-nums')}>
            <span className="text-xl font-semibold">{db.totalConnections}</span>
            <span className="text-xs text-muted-foreground">{`/ ${db.maxConnections} · ${percent(ratio, 0)}`}</span>
            <LevelFlag level={level} />
          </span>
          <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-primary/10">
            {segments.filter(s => s.count > 0).map(s => (
              <div key={s.key} className={s.className} style={{ width: `${(s.count / max) * 100}%` }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            {segments.filter(s => s.count > 0 || s.key !== 'other').map(s => (
              <span key={s.key} className="inline-flex items-center gap-1">
                <i className={cn('inline-block size-2 rounded-xs', s.className)} />
                {`${s.label} ${s.count}`}
              </span>
            ))}
          </div>
        </Hint>
        <Trend label={t('runtime_db_tps')} values={db.transactionsHistory} current={db.transactionsPerSecond} unit={t('runtime_unit_rps')} name={t('runtime_db_tps_name')} />
      </div>
      <div className="grid grid-cols-3 gap-x-3 gap-y-2 border-t pt-2.5">
        <Stat
          label={t('runtime_db_cache_hit')}
          value={percent(db.cacheHitRatio)}
          level={db.cacheHitRatio > 0 && db.cacheHitRatio < CACHE_HIT_WARNING ? 'warning' : null}
          tip={<Tip value={percent(db.cacheHitRatio, 2)} lines={[t('runtime_tip_cache_hit')]} />}
        />
        <Stat label={t('runtime_db_rows')} value={formatRate(db.rowsPerSecond)} tip={<Tip value={`${formatRate(db.rowsPerSecond)} ${t('runtime_unit_rows')}`} lines={[t('runtime_tip_rows')]} />} />
        <Stat label={t('runtime_db_size')} value={formatDataSize({ size: db.sizeBytes })} tip={<Tip value={formatDataSize({ size: db.sizeBytes })} lines={['pg_database_size']} />} />
        <Stat
          label={t('runtime_db_longest')}
          value={longest}
          level={db.longestQuerySeconds > LONG_QUERY_WARNING_SECONDS ? 'warning' : null}
          tip={<Tip value={longest} lines={[t('runtime_tip_longest')]} />}
        />
        <Stat label={t('runtime_db_waiting')} value={String(db.waiting)} level={db.waiting > 0 ? 'warning' : null} tip={<Tip value={t('runtime_tip_sessions_value', { count: db.waiting })} lines={[t('runtime_tip_waiting')]} />} />
        <Stat
          label={t('runtime_db_deadlocks')}
          value={`${db.deadlocksRecent} · ${db.tempFilesRecent}`}
          level={db.deadlocksRecent > 0 ? 'critical' : null}
          tip={<Tip value={t('runtime_tip_deadlocks_value', { deadlocks: db.deadlocksRecent, temp: db.tempFilesRecent })} lines={[t('runtime_tip_deadlocks')]} />}
        />
      </div>
    </DepCard>
  )
}

function RedisCard({ redis }: { redis: RedisMetrics }) {
  const t = useTranslations('Console.dashboard')
  const subtitle = `Redis ${redis.version} · ${redis.location}`
  if (redis.error) {
    return (
      <DepCard icon={<Layers className="size-4" />} title="Redis" subtitle={redis.location || 'Redis'} status={<StatusBadge problems={[t('runtime_unavailable')]} level="critical" />}>
        <p className="text-sm text-muted-foreground">{t('runtime_redis_unavailable')}</p>
      </DepCard>
    )
  }
  const ratio = redis.maxMemory > 0 ? redis.usedMemory / redis.maxMemory : 0
  const level = redis.maxMemory > 0 ? usageLevel(ratio) : null
  const problems = [
    level && t(level === 'critical' ? 'runtime_problem_memory_full' : 'runtime_problem_memory'),
    redis.evictedPerMinute > 0 && t('runtime_problem_evicted', { count: redis.evictedPerMinute }),
  ].filter((p): p is string => Boolean(p))
  const statusLevel: Level = redis.evictedPerMinute > 0 || level === 'critical' ? 'critical' : problems.length > 0 ? 'warning' : null
  const topGroup = Math.max(1, ...redis.keyGroups.map(g => g.count))
  const groupLabel = (group: string) => (t.has(`runtime_key_group_${group}`) ? t(`runtime_key_group_${group}`) : group)

  return (
    <DepCard icon={<Layers className="size-4" />} title="Redis" subtitle={subtitle} status={<StatusBadge problems={problems} level={statusLevel} />}>
      <div className="grid items-end gap-4 @sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Hint
          className="grid gap-1"
          tip={<Tip value={redis.maxMemory > 0 ? `${formatDataSize({ size: redis.usedMemory })} / ${formatDataSize({ size: redis.maxMemory })}` : formatDataSize({ size: redis.usedMemory })} lines={[t('runtime_tip_redis_memory')]} />}
        >
          <span className="text-xs text-muted-foreground">{t('runtime_redis_memory')}</span>
          <span className={cn(jetBrainsMono.className, 'flex flex-wrap items-baseline gap-1 tabular-nums')}>
            <span className="text-xl font-semibold">{formatDataSize({ size: redis.usedMemory })}</span>
            <span className="text-xs text-muted-foreground">
              {redis.maxMemory > 0 ? `/ ${formatDataSize({ size: redis.maxMemory })} · ${percent(ratio, 0)}` : t('runtime_redis_no_limit')}
            </span>
            <LevelFlag level={level} />
          </span>
          <div className="h-2 overflow-hidden rounded-full bg-primary/10">
            <div
              className={cn('h-full rounded-full', level === 'critical' ? 'bg-red-600' : level === 'warning' ? 'bg-amber-400' : 'bg-primary')}
              style={{ width: `${redis.maxMemory > 0 ? Math.max(1, Math.min(100, ratio * 100)) : 0}%` }}
            />
          </div>
          <div className={cn(jetBrainsMono.className, 'flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular-nums')}>
            <span>{t('runtime_redis_rss', { size: formatDataSize({ size: redis.rss }) })}</span>
            <span>{t('runtime_redis_fragmentation', { ratio: redis.fragmentation.toFixed(2) })}</span>
          </div>
        </Hint>
        <Trend label={t('runtime_redis_ops')} values={redis.opsHistory} current={redis.opsPerSecond} unit={t('runtime_unit_rps')} name={t('runtime_redis_ops_name')} />
      </div>
      <div className="grid grid-cols-3 gap-x-3 gap-y-2 border-t pt-2.5">
        <Stat
          label={t('runtime_redis_clients')}
          value={redis.blockedClients > 0 ? `${redis.clients} · ${t('runtime_redis_blocked', { count: redis.blockedClients })}` : String(redis.clients)}
          tip={<Tip value={t('runtime_tip_clients_value', { count: redis.clients })} lines={[t('runtime_tip_redis_clients')]} />}
        />
        <Stat label={t('runtime_redis_hit')} value={percent(redis.hitRatio)} tip={<Tip value={percent(redis.hitRatio, 2)} lines={[t('runtime_tip_redis_hit')]} />} />
        <Stat
          label="CPU"
          value={`${redis.cpuPercent.toFixed(1)}%`}
          level={redis.cpuPercent > REDIS_CPU_WARNING ? 'warning' : null}
          tip={<Tip value={`${redis.cpuPercent.toFixed(1)}%`} lines={[t('runtime_tip_redis_cpu')]} />}
        />
        <Stat label={t('runtime_redis_keys')} value={redis.keys.toLocaleString()} tip={<Tip value={t('runtime_tip_keys_value', { count: redis.keys })} lines={[t('runtime_tip_redis_keys')]} />} />
        <Stat label={t('runtime_redis_expired')} value={formatRate(redis.expiredPerSecond)} tip={<Tip value={t('runtime_tip_expired_value', { value: formatRate(redis.expiredPerSecond) })} lines={[t('runtime_tip_redis_expired')]} />} />
        <Stat
          label={t('runtime_redis_evicted')}
          value={t('runtime_redis_evicted_value', { count: redis.evictedPerMinute })}
          level={redis.evictedPerMinute > 0 ? 'critical' : null}
          tip={<Tip value={t('runtime_tip_evicted_value', { count: redis.evictedPerMinute })} lines={[t('runtime_tip_redis_evicted')]} />}
        />
      </div>
      {redis.keyGroups.length > 0 && (
        <div className="grid gap-1">
          <span className="text-xs text-muted-foreground">
            {t('runtime_redis_key_groups')}
            {!redis.keyGroupsComplete && ` ${t('runtime_redis_key_groups_partial')}`}
          </span>
          {redis.keyGroups.map(g => (
            <Hint key={g.group} tip={<Tip value={t('runtime_tip_keys_value', { count: g.count })} lines={[groupLabel(g.group)]} />} className="grid grid-cols-[6.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-xs">
              <span className="truncate">{groupLabel(g.group)}</span>
              <div className="h-2">
                <div className="h-full rounded-r-sm bg-primary" style={{ width: `${Math.max(2, (g.count / topGroup) * 100)}%` }} />
              </div>
              <span className={cn(jetBrainsMono.className, 'text-right tabular-nums')}>{g.count.toLocaleString()}</span>
            </Hint>
          ))}
        </div>
      )}
    </DepCard>
  )
}

function NoRedisCard() {
  const t = useTranslations('Console.dashboard')
  return (
    <DepCard
      icon={<Layers className="size-4" />}
      title="Redis"
      subtitle={t('runtime_redis_not_used')}
      status={<span className="shrink-0 rounded-full border px-2 text-xs leading-5 text-muted-foreground">{t('runtime_redis_memory_store')}</span>}
    >
      <div className="grid gap-1 text-sm text-muted-foreground">
        <p>{t('runtime_redis_not_used_note')}</p>
        <p>{t('runtime_redis_not_used_hint')}</p>
      </div>
    </DepCard>
  )
}
