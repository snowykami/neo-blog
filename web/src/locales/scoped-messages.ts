import type { I18nScope } from './scopes.generated'
import { getFallbackChain, LOCALE_DATA } from '.'
import { mergeLocaleMessages } from './registry'
import { scopePaths } from './scopes'
import 'server-only'

type Messages = Record<string, unknown>

const cache = new Map<string, Messages>()

/** 按路径写入，逐层建对象：'Console.global.title' → { Console: { global: { title } } } */
function assignPath(target: Messages, path: string, value: unknown) {
  const segments = path.split('.')
  let node = target
  for (const segment of segments.slice(0, -1)) {
    if (typeof node[segment] !== 'object' || node[segment] === null)
      node[segment] = {}
    node = node[segment] as Messages
  }
  node[segments.at(-1)!] = value
}

function resolvePath(source: Messages, path: string): unknown {
  let node: unknown = source
  for (const segment of path.split('.')) {
    if (typeof node !== 'object' || node === null || !(segment in (node as Messages)))
      return undefined
    node = (node as Messages)[segment]
  }
  return node
}

/**
 * 按路径挑出文案，沿语言回退链逐层合并
 *
 * 路径是整棵命名空间（`Comment`）、子命名空间（`Console.global`）或单独一条键（键表里的菜单标题）。
 * 语言变体是稀疏覆盖（zh-HK 只写与 zh-TW 不同的条目），所以同一路径要沿回退链逐层合并，
 * 直接取第一个能查到的值会丢掉上级语言里其余键。
 */
export function pickMessages(locale: string, paths: readonly string[]): Messages {
  const chain = getFallbackChain(locale).map(code => LOCALE_DATA[code] ?? {})
  return mergeLocaleMessages(chain.map((data) => {
    const slice: Messages = {}
    for (const path of paths) {
      const value = resolvePath(data as Messages, path)
      if (value !== undefined)
        assignPath(slice, path, value)
    }
    return slice
  }))
}

/** 某个作用域需要的文案（清单见 scopes.generated.ts），按语言缓存 */
export function getScopedMessages(locale: string, scope: I18nScope): Messages {
  const key = `${locale}\u0000${scope}`
  const cached = cache.get(key)
  if (cached)
    return cached
  const messages = pickMessages(locale, scopePaths(scope))
  cache.set(key, messages)
  return messages
}
