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
 * 某个作用域相对父作用域多出来的文案路径（父作用域已覆盖的不再列出）。
 * 客户端的嵌套 Provider 会并上外层 Provider 的文案（见 components/i18n-scope.client.tsx），
 * 所以每层只需下发这一部分：客户端跳转时重新渲染的作用域 layout 不会把祖先的文案再发一遍
 */
export function scopeOwnPaths(scope: I18nScope): readonly string[] {
  const parent = SCOPE_PARENT[scope]
  if (!parent)
    return scopePaths(scope)
  const inherited = scopePaths(parent)
  return scopePaths(scope).filter(path => !inherited.some(item => covers(item, path)))
}

/**
 * 文案路径所在的下发单元：顶层命名空间（`Comment.reply` → `Comment`），
 * 按子命名空间拆分的命名空间（见 `SPLIT_NAMESPACES`）取两层（如 `Console.global.title` → `Console.global`）。与 scripts/i18n-graph.mjs 的 unitOf 一致
 */
export function unitOfPath(path: string): string {
  const segments = path.split('.')
  const depth = (SPLIT_NAMESPACES as readonly string[]).includes(segments[0]) ? 2 : 1
  return segments.slice(0, depth).join('.')
}
