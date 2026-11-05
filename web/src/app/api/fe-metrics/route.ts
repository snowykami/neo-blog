import { NextResponse } from 'next/server'
import { getLoginUserServer } from '@/api/user.server'
import { getServerMetrics } from '@/lib/server-metrics'
import { isAdmin } from '@/utils/common/permission'

// 处理本次请求的前端实例的运行时指标（仅管理员）。字段为 snake_case，与写进 Redis 的快照相同；
// shared 表示本实例配置了 REDIS_URL，全部前端实例会出现在后端返回的列表里
export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getLoginUserServer().then(res => res.data).catch(() => null)
  if (!user || !isAdmin({ user })) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }
  return NextResponse.json(getServerMetrics(), { headers: { 'Cache-Control': 'no-store' } })
}
