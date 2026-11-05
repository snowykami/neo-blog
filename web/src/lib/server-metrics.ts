import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import http from 'node:http'
import os from 'node:os'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import process from 'node:process'
import v8 from 'node:v8'
import { Redis } from 'ioredis'

// 前端（Next.js）实例的运行时指标：统计本进程处理的 HTTP 请求与连接，每 15 秒算一次核心指标；
// 配置了 REDIS_URL 时把快照写进与后端相同的 Redis（键前缀 REDIS_KEY_PREFIX，默认 neo-blog:），后台「系统运行」据此列出全部前端副本。
// 键名与字段和后端 internal/service/runtime_metrics.go 的 frontendMetricsKeyPrefix、dto.FrontendInstanceDto 一致（snake_case）

const REPORT_INTERVAL = 15_000
const SNAPSHOT_TTL_SECONDS = 45
const HISTORY_POINTS = 40 // 趋势线保留的上报次数（共 10 分钟）
const KEY_PREFIX = 'fe_runtime_metrics:'
const DEFAULT_REDIS_PREFIX = 'neo-blog:'
const ERROR_LOG_INTERVAL = 60_000
// 探针每几秒请求一次，会掩盖真实流量
const SKIPPED_PATHS = new Set(['/healthz', '/readyz'])

export interface FrontendCore {
  requests_per_second: number
  inflight_requests: number
  avg_latency_ms: number
  error_rate: number // 5xx 占比，0～1
  cpu_percent: number // 1 核 = 100
  memory_rss: number
  heap_used: number
  connections: number // 当前打开的 HTTP 连接
  event_loop_p99_ms: number
}

export interface FrontendSnapshot {
  instance_id: string
  hostname: string
  pid: number
  started_at: string
  updated_at: string
  core: FrontendCore
  requests_history: number[]
  metrics: Record<string, number | string | boolean> // 全部 Node 运行时指标（camelCase 键）
}

interface MetricsState {
  started: boolean
  instanceId: string
  startedAt: Date
  inflight: number
  connections: number
  total: number
  errors: number
  latencyMs: number
  last: { at: number, total: number, errors: number, latencyMs: number, cpu: NodeJS.CpuUsage }
  history: number[]
  core: FrontendCore
  eventLoop: ReturnType<typeof monitorEventLoopDelay> | null
  redis: Redis | null
  lastErrorLogAt: number
}

// 放在 globalThis 上：instrumentation 与路由处理函数分别打包，但运行在同一个进程里，需要共用同一份状态
const STATE_KEY = Symbol.for('neo-blog.server-metrics')

function state(): MetricsState {
  const holder = globalThis as unknown as Record<symbol, MetricsState | undefined>
  holder[STATE_KEY] ??= {
    started: false,
    instanceId: randomUUID(),
    startedAt: new Date(),
    inflight: 0,
    connections: 0,
    total: 0,
    errors: 0,
    latencyMs: 0,
    last: { at: performance.now(), total: 0, errors: 0, latencyMs: 0, cpu: process.cpuUsage() },
    history: [],
    core: { requests_per_second: 0, inflight_requests: 0, avg_latency_ms: 0, error_rate: 0, cpu_percent: 0, memory_rss: 0, heap_used: 0, connections: 0, event_loop_p99_ms: 0 },
    eventLoop: null,
    redis: null,
    lastErrorLogAt: 0,
  }
  return holder[STATE_KEY]
}

function trackRequest(s: MetricsState, req: IncomingMessage, res: ServerResponse) {
  const path = (req.url ?? '').split('?')[0]
  if (SKIPPED_PATHS.has(path))
    return
  s.inflight++
  const start = performance.now()
  // close 在响应结束或连接中断时都会触发，且只触发一次
  res.once('close', () => {
    s.inflight--
    s.total++
    s.latencyMs += performance.now() - start
    if (res.statusCode >= 500)
      s.errors++
  })
}

function trackSocket(s: MetricsState, socket: Socket) {
  s.connections++
  socket.once('close', () => {
    s.connections--
  })
}

// sample 按与上次之间的增量计算核心指标
function sample(s: MetricsState) {
  const now = performance.now()
  const elapsed = (now - s.last.at) / 1000
  const requests = s.total - s.last.total
  const cpu = process.cpuUsage(s.last.cpu)
  const mem = process.memoryUsage()
  s.core = {
    requests_per_second: elapsed > 0 ? requests / elapsed : 0,
    inflight_requests: s.inflight,
    avg_latency_ms: requests > 0 ? (s.latencyMs - s.last.latencyMs) / requests : 0,
    error_rate: requests > 0 ? (s.errors - s.last.errors) / requests : 0,
    cpu_percent: elapsed > 0 ? (cpu.user + cpu.system) / 1e6 / elapsed * 100 : 0,
    memory_rss: mem.rss,
    heap_used: mem.heapUsed,
    connections: s.connections,
    event_loop_p99_ms: s.eventLoop ? s.eventLoop.percentile(99) / 1e6 : 0,
  }
  s.eventLoop?.reset()
  s.last = { at: now, total: s.total, errors: s.errors, latencyMs: s.latencyMs, cpu: process.cpuUsage() }
  s.history = [...s.history, s.core.requests_per_second].slice(-HISTORY_POINTS)
}

// collectNodeMetrics 全部 Node 运行时指标（后台「全部指标」里展示）。键名沿用 camelCase，与后台的指标名称与格式化一致；
// 后端原样转交这个对象，响应转换时 camelCase 的键保持不变
function collectNodeMetrics(): Record<string, number | string | boolean> {
  const mem = process.memoryUsage()
  const heap = v8.getHeapStatistics()
  const cpu = process.cpuUsage()
  const cpus = os.cpus().length || 1
  const load = os.loadavg().map(v => (v / cpus * 100).toFixed(1))
  return {
    uptime: process.uptime(),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    cpus,
    loadavg1m5mAnd15m: `${load.join('/')}%`,
    memoryRss: mem.rss,
    memoryHeapTotal: mem.heapTotal,
    memoryHeapUsed: mem.heapUsed,
    memoryExternal: mem.external,
    memoryArrayBuffers: mem.arrayBuffers,
    v8TotalHeapSize: heap.total_heap_size,
    v8TotalHeapSizeExecutable: heap.total_heap_size_executable,
    v8TotalPhysicalSize: heap.total_physical_size,
    v8TotalAvailableSize: heap.total_available_size,
    v8UsedHeapSize: heap.used_heap_size,
    v8HeapSizeLimit: heap.heap_size_limit,
    v8MallocedMemory: heap.malloced_memory,
    v8PeakMallocedMemory: heap.peak_malloced_memory,
    v8DoesZapGarbage: heap.does_zap_garbage,
    cpuUserUsec: cpu.user,
    cpuSystemUsec: cpu.system,
  }
}

function snapshot(s: MetricsState): FrontendSnapshot {
  return {
    instance_id: s.instanceId,
    hostname: os.hostname(),
    pid: process.pid,
    started_at: s.startedAt.toISOString(),
    updated_at: new Date().toISOString(),
    // 进行中的请求与连接数取实时值，其余为最近一次计算的结果
    core: { ...s.core, inflight_requests: s.inflight, connections: s.connections },
    requests_history: s.history,
    metrics: collectNodeMetrics(),
  }
}

function logError(s: MetricsState, err: unknown) {
  if (Date.now() - s.lastErrorLogAt < ERROR_LOG_INTERVAL)
    return
  s.lastErrorLogAt = Date.now()
  console.warn('[server-metrics] report to redis failed:', err instanceof Error ? err.message : err)
}

async function publish(s: MetricsState) {
  if (!s.redis)
    return
  const prefix = process.env.REDIS_KEY_PREFIX || DEFAULT_REDIS_PREFIX
  try {
    await s.redis.set(`${prefix}${KEY_PREFIX}${s.instanceId}`, JSON.stringify(snapshot(s)), 'EX', SNAPSHOT_TTL_SECONDS)
  }
  catch (err) {
    logError(s, err)
  }
}

/**
 * 启动本实例的指标采集，由 instrumentation.ts 在 Node.js 运行时调用一次。
 * 通过包装 http.Server 的 emit 统计请求与连接：对 Next.js 自己创建的服务同样生效，不需要改启动方式
 */
export function startServerMetrics() {
  const s = state()
  if (s.started)
    return
  s.started = true

  const originalEmit = http.Server.prototype.emit
  http.Server.prototype.emit = function emit(this: http.Server, event: string | symbol, ...args: unknown[]) {
    if (event === 'request')
      trackRequest(s, args[0] as IncomingMessage, args[1] as ServerResponse)
    else if (event === 'connection')
      trackSocket(s, args[0] as Socket)
    return originalEmit.apply(this, [event, ...args] as Parameters<typeof originalEmit>)
  } as typeof originalEmit

  s.eventLoop = monitorEventLoopDelay({ resolution: 20 })
  s.eventLoop.enable()

  const url = process.env.REDIS_URL
  if (url) {
    // 连不上 Redis 时不影响页面：命令直接失败、限频记日志，后台退化为只显示处理请求的那个前端实例
    s.redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false })
    s.redis.on('error', err => logError(s, err))
    // 连上后先上报一次，后台马上能看到这个实例；之后每次上报前按增量计算核心指标
    s.redis.connect().then(() => publish(s)).catch(err => logError(s, err))
  }

  const timer = setInterval(() => {
    sample(s)
    void publish(s)
  }, REPORT_INTERVAL)
  timer.unref()
}

/** 本实例的最新快照（后台在前端没有配置 Redis 时用它显示处理本次请求的前端实例） */
export function getServerMetrics(): { shared: boolean, instance: FrontendSnapshot } {
  const s = state()
  return { shared: Boolean(s.redis), instance: snapshot(s) }
}
