import type { RobotsTxtConfigInput } from '@/lib/seo'
import process from 'node:process'
import { cacheLife, cacheTag } from 'next/cache'
import { connection } from 'next/server'
import { CacheTag } from '@/lib/cache-tags'
import { buildRobotsTxtContent } from '@/lib/seo'

// Lighthouse robots-txt 抓取超时为 5s：后端冷启动或异常时必须在 2.5s 内快速熔断回退，绝不阻塞爬虫与审计工具
const ROBOTS_FETCH_TIMEOUT_MS = 2500

function resolveBackendOrigin(): string {
  return (
    process.env.BACKEND_URL
    || (process.env.NODE_ENV === 'production' ? 'http://neo-blog-backend:8888' : 'http://localhost:8888')
  ).replace(/\/+$/, '')
}

interface RawSiteInfoResponse {
  data?: {
    base_url?: string
    seo?: {
      allow_indexing?: boolean
      sitemap_enabled?: boolean
      robots_extra_rules?: string
    }
  }
}

// 独立轻量读取 SEO 索引字段，避免引入 misc.server.ts 的图标库动态映射（约 1500+ 模块），冷编译与响应耗时降至毫秒级
async function loadRobotsSiteConfig(): Promise<RobotsTxtConfigInput> {
  'use cache'
  cacheLife('site')
  cacheTag(CacheTag.Site)

  const res = await fetch(`${resolveBackendOrigin()}/api/v1/misc/site-info`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(ROBOTS_FETCH_TIMEOUT_MS),
  })
  if (!res.ok)
    throw new Error(`Failed to load site-info for robots.txt: ${res.status}`)

  const body = (await res.json()) as RawSiteInfoResponse
  const data = body?.data
  return {
    baseUrl: data?.base_url ?? '',
    allowIndexing: data?.seo?.allow_indexing ?? true,
    sitemapEnabled: data?.seo?.sitemap_enabled ?? true,
    robotsExtraRules: data?.seo?.robots_extra_rules ?? '',
  }
}

export async function GET() {
  await connection()
  let config: RobotsTxtConfigInput | null = null
  try {
    config = await loadRobotsSiteConfig()
  }
  catch {
    // 后端暂不可达时即时回退默认放行规则，且标记 no-store 避免外层 CDN 缓存降级内容
  }

  const txt = buildRobotsTxtContent(config ?? { allowIndexing: true, sitemapEnabled: false })
  return new Response(txt, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': config
        ? 'public, max-age=60, stale-while-revalidate=300'
        : 'no-store',
    },
  })
}
