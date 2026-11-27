export type RouterNavigationType = 'push' | 'replace' | 'traverse'

export interface NavigationTransitionSnapshot {
  active: boolean
  targetPath: string | null
  targetSearch: string
  navigationType: RouterNavigationType | null
  startedAt: number
  seq: number
}

export interface CommittedNavigationLocation {
  origin: string
  pathname: string
  search: string
}

const IDLE_SNAPSHOT: NavigationTransitionSnapshot = {
  active: false,
  targetPath: null,
  targetSearch: '',
  navigationType: null,
  startedAt: 0,
  seq: 0,
}

let currentSnapshot: NavigationTransitionSnapshot = IDLE_SNAPSHOT
let committedLocation: CommittedNavigationLocation | null = null
let nextSeq = 0
const listeners = new Set<() => void>()
const routerTransitionListeners = new Set<(seq: number) => void>()

function emit() {
  for (const listener of listeners)
    listener()
}

export function normalizeNavigationPathname(raw: string): string {
  if (!raw)
    return '/'
  const normalized = raw
    .split('/')
    .map((segment) => {
      if (!segment)
        return ''
      try {
        return encodeURIComponent(decodeURIComponent(segment))
      }
      catch {
        return segment
      }
    })
    .join('/')
  if (!normalized)
    return '/'
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized
}

export function normalizeNavigationSearch(raw: string): string {
  const query = raw.startsWith('?') ? raw.slice(1) : raw
  if (!query)
    return ''
  const serialized = new URLSearchParams(query).toString()
  return serialized ? `?${serialized}` : ''
}

export function setCommittedNavigationLocation(pathname: string, search: string, origin?: string) {
  const resolvedOrigin = origin ?? (typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
  committedLocation = {
    origin: resolvedOrigin,
    pathname: normalizeNavigationPathname(pathname),
    search: normalizeNavigationSearch(search),
  }
}

function resolveBaseLocation(override?: { origin: string, pathname: string, search: string }): CommittedNavigationLocation | null {
  if (override) {
    return {
      origin: override.origin,
      pathname: normalizeNavigationPathname(override.pathname),
      search: normalizeNavigationSearch(override.search),
    }
  }
  if (committedLocation)
    return committedLocation
  if (typeof window === 'undefined')
    return null
  return {
    origin: window.location.origin,
    pathname: normalizeNavigationPathname(window.location.pathname),
    search: normalizeNavigationSearch(window.location.search),
  }
}

/**
 * 判断此次路由过渡是否为需要向用户展示进度条/详情骨架的真实页面跳转：
 * - 统一归一化路径百分号编码与 URLSearchParams 查询串，防止 %20 与 + 编码差异造成假阳性卡死
 * - 优先对比已提交路由快照 committedLocation，确保浏览器 popstate（window.location 先变）也能准确识别前进/后退
 * - 排除仅 #hash 锚点变化、与当前已提交地址完全一致的空跳，以及同路径下的 replace 查询同步（如 /music 秒级进度、nuqs 浅筛选）
 */
export function shouldTrackNavigationTransition(
  rawTargetUrl: string,
  navigationType: RouterNavigationType,
  currentLocation?: { origin: string, pathname: string, search: string },
): { pathname: string, search: string } | null {
  const loc = resolveBaseLocation(currentLocation)
  if (!loc)
    return null

  const baseHref = `${loc.origin}${loc.pathname}${loc.search}`
  let parsed: URL
  try {
    parsed = new URL(rawTargetUrl, baseHref)
  }
  catch {
    return null
  }

  if (parsed.origin !== loc.origin)
    return null

  const targetPathname = normalizeNavigationPathname(parsed.pathname)
  const targetSearch = normalizeNavigationSearch(parsed.search)
  if (targetPathname === loc.pathname && targetSearch === loc.search)
    return null

  if (navigationType === 'replace' && targetPathname === loc.pathname)
    return null

  return { pathname: targetPathname, search: targetSearch }
}

export function notifyNavigationStart(
  url: string,
  navigationType: RouterNavigationType,
  options?: { fromRouterTransition?: boolean },
) {
  const loc = resolveBaseLocation()
  const target = shouldTrackNavigationTransition(url, navigationType)
  if (!target) {
    // 慢导航尚未完成时若用户点回当前已提交路由（或同页锚点、回退回原页）取消了刚才的慢跳转，需立即收起挂起的骨架与进度条
    if (currentSnapshot.active && loc) {
      try {
        const parsed = new URL(url, `${loc.origin}${loc.pathname}${loc.search}`)
        const sameOrigin = parsed.origin === loc.origin
        const normPath = normalizeNavigationPathname(parsed.pathname)
        const isBackgroundMusicSync = navigationType === 'replace' && normPath === '/music'
        if (sameOrigin && !isBackgroundMusicSync)
          notifyNavigationComplete()
      }
      catch {
        // 忽略非法地址
      }
    }
    return
  }

  nextSeq += 1
  const seq = nextSeq
  currentSnapshot = {
    active: true,
    targetPath: target.pathname,
    targetSearch: target.search,
    navigationType,
    startedAt: Date.now(),
    seq,
  }
  emit()

  if (options?.fromRouterTransition) {
    for (const listener of routerTransitionListeners)
      listener(seq)
  }
}

export function notifyNavigationComplete() {
  if (!currentSnapshot.active)
    return
  currentSnapshot = {
    ...IDLE_SNAPSHOT,
    seq: currentSnapshot.seq,
  }
  emit()
}

export function subscribeNavigationTransition(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function subscribeRouterTransitionStart(listener: (seq: number) => void): () => void {
  routerTransitionListeners.add(listener)
  return () => {
    routerTransitionListeners.delete(listener)
  }
}

export function getCommittedNavigationLocation(): CommittedNavigationLocation | null {
  return committedLocation
}

export function getNavigationTransitionSnapshot(): NavigationTransitionSnapshot {
  return currentSnapshot
}

export function getServerNavigationTransitionSnapshot(): NavigationTransitionSnapshot {
  return IDLE_SNAPSHOT
}

export function resetNavigationTransitionForTests() {
  currentSnapshot = IDLE_SNAPSHOT
  committedLocation = null
  nextSeq = 0
  listeners.clear()
  routerTransitionListeners.clear()
}
