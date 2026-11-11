// 部署新版本后，旧页面按需加载的代码块已不存在，会抛出 ChunkLoadError
// 此时刷新一次即可加载新版本；冷却期内不再自动刷新，避免新版本本身有问题时反复刷新

/**
 * 本页面运行的前端版本：构建时注入的 commit（APP_VERSION），未注入时由 next.config.ts 按构建生成，每次构建都不同。
 * 本地开发为空。必须使用全局 process：构建时只会内联全局 process.env.NEXT_PUBLIC_*，导入的 process 不会被替换
 */
// eslint-disable-next-line node/prefer-global/process
export const CURRENT_APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION?.trim() ?? ''

/**
 * 服务器上是否已经部署了与本页面不同的版本（请求 /api/version）；未知版本、请求失败时返回 false
 */
export async function isNewVersionDeployed(): Promise<boolean> {
  if (!CURRENT_APP_VERSION)
    return false
  try {
    const res = await fetch('/api/version', { cache: 'no-store' })
    if (!res.ok)
      return false
    const { version } = await res.json() as { version?: string }
    return !!version && version !== CURRENT_APP_VERSION
  }
  catch {
    return false
  }
}

const CHUNK_RELOAD_KEY = 'neo-chunk-reload-at'
const CHUNK_RELOAD_COOLDOWN_MS = 60_000

/** 是否为代码块加载失败（Turbopack / webpack 的 ChunkLoadError、动态 import 失败），会沿 cause 向上查找 */
export function isChunkLoadError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== 'object' || depth > 3)
    return false
  const { name, message, cause } = error as { name?: unknown, message?: unknown, cause?: unknown }
  if (name === 'ChunkLoadError')
    return true
  if (typeof message === 'string' && /Failed to load chunk|Loading (?:CSS )?chunk \S+ failed|Failed to fetch dynamically imported module|Importing a module script failed/i.test(message))
    return true
  return isChunkLoadError(cause, depth + 1)
}

/** 刷新页面以加载新版本；冷却期内已经刷新过时返回 false */
export function reloadForChunkError(): boolean {
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY)) || 0
    if (Date.now() - last < CHUNK_RELOAD_COOLDOWN_MS)
      return false
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()))
  }
  catch {
    // 无法使用 sessionStorage 时无法防止循环刷新，不自动刷新
    return false
  }
  window.location.reload()
  return true
}
