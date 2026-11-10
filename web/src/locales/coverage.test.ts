import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createGraph,
  dynamicKeyPaths,
  messagePathsOfClosure,
  moduleClosure,
  readCatalog,
  relativePath,
  resolvePath,
  routeSegments,
  SRC_ROOT,
  WEB_ROOT,
} from '../../scripts/i18n-graph.mjs'
import { computeScopes, pathsForClosure, SCOPE_DIRS, scopeKey } from '../../scripts/i18n-scopes.mjs'
import { scopePaths } from './scopes'
import { SCOPES } from './scopes.generated'

const manifest = SCOPES as Record<string, readonly string[]>

const APP_ROOT = join(SRC_ROOT, 'app')
const DYNAMIC_FILES = ['src/components/console/data.ts']
const byDepth = [...SCOPE_DIRS].sort((a, b) => b.length - a.length)

const within = (dir: string, scope: string) => scope === '' || dir === scope || dir.startsWith(`${scope}/`)

/** 某个目录最终由哪个作用域提供文案：它所在目录最深的作用域祖先 */
const nearestScopeDir = (dir: string) => byDepth.find(scope => within(dir, scope)) ?? ''

const segmentDir = (segment: string) => (segment === APP_ROOT ? '' : segment.slice(APP_ROOT.length + 1))

// Docker 构建上下文只有 web/，读不到后端配置表时算出来的清单是降级的，此时跳过这些用例
const configKeysAvailable = computeScopes().configKeysAvailable

describe.skipIf(!configKeysAvailable)('i18n 作用域', () => {
  const graph = createGraph()
  const segments = routeSegments()
  const catalog = readCatalog('en')

  // 全量解析 src 的模块图，比单元测试慢得多，给足超时
  it('生成物与源码同步（重新运行 pnpm i18n:scopes）', { timeout: 60_000 }, () => {
    const { scopes } = computeScopes()
    for (const dir of SCOPE_DIRS) {
      const key = scopeKey(dir)
      expect(scopes.get(dir), `${key} 的清单已过期`).toEqual([...scopePaths(key as keyof typeof SCOPES)])
    }
    expect(Object.keys(manifest).sort()).toEqual(SCOPE_DIRS.map(scopeKey).sort())
  })

  it('每个作用域都有挂了对应 scope 的 layout', () => {
    for (const dir of SCOPE_DIRS) {
      const file = dir ? join(APP_ROOT, dir, 'layout.tsx') : join(APP_ROOT, 'layout.tsx')
      const key = scopeKey(dir)
      expect(existsSync(file), `${relativePath(file)} 不存在`).toBe(true)
      expect(readFileSync(file, 'utf8'), `${relativePath(file)} 没有挂上 scope="${key}"`).toContain(`scope="${key}"`)
    }
  })

  it('清单覆盖这一层能渲染到的全部文案', { timeout: 60_000 }, () => {
    const dynamicPaths = dynamicKeyPaths(catalog, DYNAMIC_FILES)
    const dynamicFiles = DYNAMIC_FILES.map(file => join(WEB_ROOT, file))
    const missing: string[] = []

    for (const scope of SCOPE_DIRS) {
      const needed = new Set<string>()
      for (const [segment, entries] of segments) {
        if (nearestScopeDir(segmentDir(segment)) !== scope)
          continue
        const closure = moduleClosure(entries, graph)
        const { paths, prefixes, open } = messagePathsOfClosure(closure, graph)
        const dynamicFile = dynamicFiles.find(file => closure.has(file))
        for (const path of pathsForClosure({ closure, paths, prefixes, open, catalog, dynamicPaths, dynamicFile: dynamicFile ?? '' }))
          needed.add(path)
      }
      const list = scopePaths(scopeKey(scope) as keyof typeof SCOPES)
      for (const path of needed) {
        if (!list.some(item => path === item || path.startsWith(`${item}.`)))
          missing.push(`${scopeKey(scope)} 缺少 ${path}`)
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

  it('用了文案的路由段都落在某个作用域之下', () => {
    const strays: string[] = []
    for (const [segment, entries] of segments) {
      const dir = segmentDir(segment)
      if (dir === '' || nearestScopeDir(dir) !== '')
        continue
      const { paths, open } = messagePathsOfClosure(moduleClosure(entries, graph), graph)
      if (paths.size > 0 || open.size > 0)
        strays.push(dir)
    }
    expect(strays).toEqual([])
  })
})
