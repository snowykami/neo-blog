import type { I18nScope } from './scopes.generated'
import { SCOPE_PARENT, SCOPES, SPLIT_NAMESPACES } from './scopes.generated'

const cache = new Map<string, readonly string[]>()

const covers = (a: string, b: string) => a === b || b.startsWith(`${a}.`)

/** 去掉被更短路径覆盖的条目（父作用域列了整棵子树时，子作用域的明细就不必重复） */
function collapse(paths: string[]) {
  const sorted = [...new Set(paths)].sort((a, b) => a.length - b.length)
  const kept: string[] = []
  for (const path of sorted) {
    if (!kept.some(item => covers(item, path)))
      kept.push(path)
  }
  return kept.sort()
}

/**
 * 某个作用域需要下发的文案路径：沿 SCOPE_PARENT 向上合并各层新增的条目。
 * 生成物只存增量（见 scripts/i18n-scopes.mjs），避免每个作用域都抄一遍祖先清单。
 */
export function scopePaths(scope: I18nScope): readonly string[] {
  const cached = cache.get(scope)
  if (cached)
    return cached

  const chain: I18nScope[] = []
  for (let current: I18nScope | null = scope; current; current = SCOPE_PARENT[current])
    chain.push(current)
  const resolved = collapse(chain.reverse().flatMap(level => SCOPES[level] as readonly string[]))
  cache.set(scope, resolved)
  return resolved
}

/**
 * 文案路径所在的下发单元：顶层命名空间（`Comment.reply` → `Comment`），
 * 按子命名空间拆分的 Console 取两层（`Console.global.title` → `Console.global`）。与 scripts/i18n-graph.mjs 的 unitOf 一致
 */
export function unitOfPath(path: string): string {
  const segments = path.split('.')
  const depth = (SPLIT_NAMESPACES as readonly string[]).includes(segments[0]) ? 2 : 1
  return segments.slice(0, depth).join('.')
}
