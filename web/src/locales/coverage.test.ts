import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createGraph,
  messagePathsOfClosure,
  moduleClosure,
  readCatalog,
  relativePath,
  resolvePath,
  routeSegments,
  SRC_ROOT,
  unitOf,
} from '../../scripts/i18n-graph.mjs'
import { checkConfigKeys, computeScopes, KEY_TABLES, keyTablePaths, SCOPE_DIRS, scopeKey } from '../../scripts/i18n-scopes.mjs'
import { scopePaths, unitOfPath } from './scopes'
import { SCOPES } from './scopes.generated'

const manifest = SCOPES as Record<string, readonly string[]>

const APP_ROOT = join(SRC_ROOT, 'app')
const byDepth = [...SCOPE_DIRS].sort((a, b) => b.length - a.length)

const within = (dir: string, scope: string) => scope === '' || dir === scope || dir.startsWith(`${scope}/`)

/** 某个目录最终由哪个作用域提供文案：它所在目录最深的作用域祖先 */
const nearestScopeDir = (dir: string) => byDepth.find(scope => within(dir, scope)) ?? ''

const segmentDir = (segment: string) => (segment === APP_ROOT ? '' : segment.slice(APP_ROOT.length + 1))

describe('i18n 作用域', () => {
  const graph = createGraph()
  const segments = routeSegments()
  const catalog = readCatalog('en')
  // 全量解析 src 的模块图，比单元测试慢得多，只算一次
  const computed = computeScopes()

  it('生成物与源码同步（重新运行 pnpm i18n:scopes）', { timeout: 60_000 }, () => {
    for (const dir of SCOPE_DIRS) {
      const key = scopeKey(dir)
      expect(computed.scopes.get(dir), `${key} 的清单已过期`).toEqual([...scopePaths(key as keyof typeof SCOPES)])
    }
    expect(Object.keys(manifest).sort()).toEqual(SCOPE_DIRS.map(scopeKey).sort())
  })

  it('没有只能下发整份文案的用法', () => {
    expect(computed.errors).toEqual([])
  })

  it('清单按整棵命名空间下发：除键表外每条都是一个下发单元', () => {
    const tablePaths = new Set(KEY_TABLES.flatMap(table => [...keyTablePaths(catalog, table)]))
    const strays = Object.values(manifest).flat().filter(path => unitOf(path) !== path && !tablePaths.has(path))
    expect(strays).toEqual([])
  })

  it('运行时与生成器对下发单元的划分一致', () => {
    for (const path of ['Comment', 'Comment.reply', 'Console', 'Console.global', 'Console.global.title', 'Console.editor.ai.habit', 'Response.error_details.x'])
      expect(unitOfPath(path)).toBe(unitOf(path))
  })

  it('每个作用域都有挂了对应 scope 的 layout', () => {
    for (const dir of SCOPE_DIRS) {
      const file = dir ? join(APP_ROOT, dir, 'layout.tsx') : join(APP_ROOT, 'layout.tsx')
      const key = scopeKey(dir)
      expect(existsSync(file), `${relativePath(file)} 不存在`).toBe(true)
      expect(readFileSync(file, 'utf8'), `${relativePath(file)} 没有挂上 scope="${key}"`).toContain(`scope="${key}"`)
    }
  })

  it('清单覆盖这一层模块闭包用到的全部下发单元', { timeout: 60_000 }, () => {
    const missing: string[] = []
    for (const scope of SCOPE_DIRS) {
      const list = scopePaths(scopeKey(scope) as keyof typeof SCOPES)
      for (const [segment, entries] of segments) {
        if (nearestScopeDir(segmentDir(segment)) !== scope)
          continue
        const { units } = messagePathsOfClosure(moduleClosure(entries, graph), graph)
        for (const unit of units.keys()) {
          if (!list.some(item => unit === item || unit.startsWith(`${item}.`)))
            missing.push(`${scopeKey(scope)} 缺少 ${unit}`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('清单里的路径在基准语言里都存在', () => {
    const broken: string[] = []
    for (const scope of Object.keys(manifest)) {
      for (const path of scopePaths(scope as keyof typeof SCOPES)) {
        if (resolvePath(catalog, path) === undefined)
          broken.push(`${scope}: ${path}`)
      }
    }
    expect(broken).toEqual([])
  })

  it('后端配置表的文案键齐全且由全局配置页作用域下发', () => {
    expect(checkConfigKeys(catalog, computed.scopes)).toEqual([])
  })

  it('用了文案的路由段都落在某个作用域之下', () => {
    const strays: string[] = []
    for (const [segment, entries] of segments) {
      const dir = segmentDir(segment)
      if (dir === '' || nearestScopeDir(dir) !== '')
        continue
      const { units, shallow } = messagePathsOfClosure(moduleClosure(entries, graph), graph)
      if (units.size > 0 || shallow.size > 0)
        strays.push(dir)
    }
    expect(strays).toEqual([])
  })
})
