// 部署新版本后，旧页面按需加载的代码块已不存在，会抛出 ChunkLoadError
// 此时刷新一次即可加载新版本；冷却期内不再自动刷新，避免新版本本身有问题时反复刷新

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
