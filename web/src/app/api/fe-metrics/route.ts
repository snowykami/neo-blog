// ...existing code...
import os from 'node:os'
import process from 'node:process'
import v8 from 'node:v8'
import { NextResponse } from 'next/server'
import { getLoginUserServer } from '@/api/user.server'
import { isAdmin } from '@/utils/common/permission'

export async function GET() {
  const user = await getLoginUserServer().then(res => res.data).catch(() => null)
  if (!user || !isAdmin({ user })) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }
  const mem = process.memoryUsage() // bytes
  const heapStats = v8.getHeapStatistics()
  const cpu = process.cpuUsage() // microseconds
  const load = os.loadavg() // 1,5,15 min
  const metrics = {
    uptime: process.uptime(), // seconds
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,

    loadavg1m5mAnd15m: `${(load[0] / os.cpus().length * 100).toFixed(1)}/${(load[1] / os.cpus().length * 100).toFixed(1)}/${(load[2] / os.cpus().length * 100).toFixed(1)}%`,
    memoryRss: mem.rss,
    memoryHeapTotal: mem.heapTotal,
    memoryHeapUsed: mem.heapUsed,
    memoryExternal: mem.external,
    memoryArrayBuffers: mem.arrayBuffers,

    v8TotalHeapSize: heapStats.total_heap_size,
    v8TotalHeapSizeExecutable: heapStats.total_heap_size_executable,
    v8TotalPhysicalSize: heapStats.total_physical_size,
    v8TotalAvailableSize: heapStats.total_available_size,
    v8UsedHeapSize: heapStats.used_heap_size,
    v8HeapSizeLimit: heapStats.heap_size_limit,
    v8MallocedMemory: heapStats.malloced_memory,
    v8PeakMallocedMemory: heapStats.peak_malloced_memory,
    v8DoesZapGarbage: heapStats.does_zap_garbage,
    // 事件循环相关

    cpuUserUsec: cpu.user,
    cpuSystemUsec: cpu.system,
  }

  return NextResponse.json(metrics)
}
