import type { SidebarCard } from './sidebar-cards'
import type { Label } from '@/models/label'
import type { MisskeyFeed } from '@/models/misskey'
import type { Post } from '@/models/post'
import { cacheLife, cacheTag } from 'next/cache'
import { getLabels } from '@/api/label'
import { getCachedSiteInfo } from '@/api/misc.server'
import { getMisskeyFeed } from '@/api/misskey'
import { listPosts } from '@/api/post'
import { CacheTag, skipBackendAtBuild } from '@/lib/cache-tags'
import { OrderBy } from '@/models/common'
import { getSidebarCards } from './sidebar-cards'

export interface SidebarInitialData {
  hotPosts?: Post[]
  latestPosts?: Post[]
  labels?: Label[]
  misskeyFeed?: MisskeyFeed
}

async function loadSidebarPosts(orderBy: OrderBy.Heat | OrderBy.CreatedAt): Promise<Post[]> {
  'use cache'
  cacheLife('site')
  cacheTag(CacheTag.Posts)
  const res = await listPosts({ orderBy, page: 1, size: 5, desc: true, noContent: true })
  return res.data.posts ?? []
}

async function loadSidebarLabels(): Promise<Label[]> {
  'use cache'
  cacheLife('site')
  cacheTag(CacheTag.Posts)
  const res = await getLabels()
  return (res.data.labels ?? []).filter(l => (l.postCount ?? 0) > 0)
}

// 首屏 SSR 仅预取前 12 条动态（约 3～4 屏可视高度），控制 RSC HTML 体积与首屏 DOM 规模；用户下滑时按需从后端内存缓存加载后续批次
export const SIDEBAR_MISSKEY_SSR_LIMIT = 12

async function loadSidebarMisskey(): Promise<MisskeyFeed | undefined> {
  'use cache'
  cacheLife('site')
  cacheTag(CacheTag.Site)
  const res = await getMisskeyFeed({ limit: SIDEBAR_MISSKEY_SSR_LIMIT })
  // 后端冷启动或刚开启配置、异步抓取仍在飞行中时返回 undefined 交由客户端单次补拉，稳态（!enabled 或已有 fetchedAt）直接复用缓存零客户端请求
  if (res.data.enabled && !res.data.fetchedAt && res.data.notes.length === 0)
    return undefined
  return res.data
}

/**
 * 服务端预取侧边栏卡片数据（热门文章、最新文章、标签云、Misskey 动态）：
 * 按后台配置的侧边栏卡片按需加载并跨请求缓存，避免每次客户端路由挂载重复请求接口；
 * 预取失败时返回 undefined，交由客户端兜底拉取。
 */
export async function getCachedSidebarData(exclude?: SidebarCard['type'][]): Promise<SidebarInitialData> {
  skipBackendAtBuild()
  const siteInfo = await getCachedSiteInfo()
  const types = new Set(
    getSidebarCards(siteInfo)
      .filter(card => !exclude?.includes(card.type))
      .map(card => card.type),
  )

  const [hotPosts, latestPosts, labels, misskeyFeed] = await Promise.all([
    types.has('hot_posts') ? loadSidebarPosts(OrderBy.Heat).catch(() => undefined) : Promise.resolve(undefined),
    types.has('latest_posts') ? loadSidebarPosts(OrderBy.CreatedAt).catch(() => undefined) : Promise.resolve(undefined),
    types.has('labels') ? loadSidebarLabels().catch(() => undefined) : Promise.resolve(undefined),
    types.has('misskey') ? loadSidebarMisskey().catch(() => undefined) : Promise.resolve(undefined),
  ])

  return { hotPosts, latestPosts, labels, misskeyFeed }
}
