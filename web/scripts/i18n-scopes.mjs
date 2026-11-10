/**
 * 生成 i18n 作用域：为每个路由段算出「这一级要下发哪些文案」，并写出
 *   1) src/locales/scopes.generated.ts —— 作用域 → 下发单元清单
 *   2) 各作用域目录下的 layout.tsx —— 只做一件事：用 I18nScope 包住子树
 *
 * 下发粒度是「单元」而不是单条键：顶层命名空间整棵下发（Comment、Common…），
 * 只有特别大的 Console 再按子命名空间拆（Console.global、Console.posts…）。
 * 单元内具体用到哪些键不再分析，变量键（t(option.label)、翻译函数被传出）因此不会漏。
 * 唯一的例外是声明过的键表（KEY_TABLES），见下。
 *
 * 用法：
 *   node scripts/i18n-scopes.mjs           写入生成物
 *   node scripts/i18n-scopes.mjs --check   只校验（测试、CI 与镜像构建用），不写文件；任何一项不通过都以非零退出
 */
import { Buffer } from 'node:buffer'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import {
  createGraph,
  listSourceFiles,
  messagePathsOfClosure,
  moduleClosure,
  readCatalog,
  resolvePath,
  routeSegments,
  SPLIT_NAMESPACES,
  SRC_ROOT,
  WEB_ROOT,
} from './i18n-graph.mjs'

/** 需要单独一层作用域的目录（相对 src/app/[locale]）；'' 是根布局 */
export const SCOPE_DIRS = [
  '',
  '(main)',
  '(main)/a',
  '(main)/c',
  '(main)/c/[slug]',
  '(main)/l',
  '(main)/notification-settings',
  '(main)/notifications',
  '(main)/p/[id]',
  '(main)/page/[id]',
  '(main)/privacy',
  '(main)/random',
  '(main)/u/[username]',
  '(player)',
  '(player)/music',
  'auth',
  'console',
  'console/(dashboard)',
  'console/ai-agents',
  'console/ai-agents/[id]',
  'console/ai-agents/runs',
  'console/api-tokens',
  'console/categories',
  'console/comments',
  'console/errors',
  'console/errors/[id]',
  'console/files',
  'console/global',
  'console/labels',
  'console/lyric-effects',
  'console/lyric-effects/[id]',
  'console/notification-deliveries',
  'console/oidc',
  'console/pages',
  'console/pages/edit/[id]',
  'console/pages/html/[id]',
  'console/posts',
  'console/posts/edit/[id]',
  'console/posts/preview/[id]',
  'console/runtime',
  'console/storages',
  'console/user-preference',
  'console/user-profile',
  'console/user-security',
  'console/users',
  'console/visit-insights',
  'console/visits',
  'console/visits/[id]',
]

const SCOPES_FILE = join(SRC_ROOT, 'locales', 'scopes.generated.ts')

/**
 * 作用域目录的根：根布局在 [locale] 段下（前台与后台都在里面），作用域名仍按 [locale] 以下的相对路径取，不带语言段。
 * app/ 根目录只剩接口、RSS、sitemap 与 global-error / global-not-found：它们不在任何作用域里，自带文案或不用文案
 */
export const APP_ROOT = join(SRC_ROOT, 'app', '[locale]')

/** 路由段目录 → 相对 APP_ROOT 的作用域目录；不在 APP_ROOT 下时返回 null */
export function segmentDir(segment) {
  if (segment === APP_ROOT)
    return ''
  return segment.startsWith(`${APP_ROOT}/`) ? segment.slice(APP_ROOT.length + 1) : null
}

/**
 * 后端配置表（internal/config/items.go）用到的 Console.global 文案键，由 Go 测试生成并校验与配置表一致
 * （internal/config/i18n_keys_test.go）。放在 web/ 里，镜像构建上下文只有 web/ 时也能校验
 */
export const CONFIG_KEYS_FILE = join(SRC_ROOT, 'locales', 'config-keys.generated.json')

/**
 * 这些作用域的 layout 是手写的，生成器只写清单、不覆盖文件：
 * 要带上页面外壳的；以及要在 loading.tsx 的骨架流出之前判定 404 / 跳转的动态页（文章、用户、分类，见各自的 layout.tsx）
 */
export const MANUAL_SCOPE_DIRS = new Set(['', '(main)', '(player)', 'console', 'auth', '(main)/p/[id]', '(main)/u/[username]', '(main)/c/[slug]'])

/**
 * 键表：只放文案键的数据文件，导入它的组件用 `t(变量)` 取其中的键。
 * 控制台菜单（侧边栏、标签页、页面标题）的标题写在 data.ts 里，取的是 Console 下各子命名空间的 title，
 * 若按「命名空间太浅 + 变量键」整棵带上，每个控制台页面都要背上 40 KB 的 Console。
 * 所以：直接导入键表的文件里、该命名空间下的变量键视为由键表覆盖，下发键表里写到的那几条键（只认叶子键）。
 * 其余「命名空间太浅 + 变量键」的用法一律整棵下发。
 */
export const KEY_TABLES = [
  { file: 'src/components/console/data.ts', namespace: 'Console' },
]

/**
 * 「JSX 在这里创建、却在别处渲染」的目录 → 实际渲染它的作用域。
 *
 * 灵动岛的浮层就是这种：文章页把 panel 塞进 IslandActivity，真正渲染它的是顶栏的 TopbarIsland，
 * 而顶栏挂载在 (main) 布局里。React context 跟着渲染位置走，所以浮层里取的文案属于 (main) 作用域，
 * 只按模块图给页面作用域是不够的。
 */
export const RENDERED_BY_SCOPE = {
  '(main)': ['src/components/layout/topbar-island'],
  // 后台的文章预览自带前台外壳（MainShell），顶栏同样挂在这一层
  'console/posts/preview/[id]': ['src/components/layout/topbar-island'],
}

/** 键表文件里能在文案中解析为叶子键的字符串字面量 → 完整路径 */
export function keyTablePaths(catalog, { file, namespace }) {
  const sf = ts.createSourceFile(file, readFileSync(join(WEB_ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true)
  const out = new Set()
  const visit = (node) => {
    if (ts.isStringLiteralLike(node)) {
      const path = `${namespace}.${node.text}`
      if (typeof resolvePath(catalog, path) === 'string')
        out.add(path)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** 路径 a 是否覆盖 b（a 是 b 的前缀） */
const covers = (a, b) => a === b || b.startsWith(`${a}.`)

/** 去掉被前缀覆盖的路径 */
function collapse(paths) {
  const sorted = [...new Set(paths)].sort((a, b) => a.length - b.length)
  const kept = []
  for (const path of sorted) {
    if (!kept.some(k => covers(k, path)))
      kept.push(path)
  }
  return kept.sort()
}

const isAncestorDir = (parent, dir) => parent !== dir && (parent === '' ? dir !== '' : dir.startsWith(`${parent}/`))

/**
 * 每个作用域要下发的路径（已并上祖先作用域）。返回
 *   scopes   目录 → 路径清单
 *   wholes   因「命名空间太浅 + 变量键」整棵下发的位置（提示用）
 *   errors   无法给出安全清单的用法（如 useTranslations() 不带命名空间又用变量键）
 */
export function computeScopes() {
  const graph = createGraph()
  const catalog = readCatalog('en')
  const segments = routeSegments()
  const tables = KEY_TABLES.map(table => ({ ...table, absolute: join(WEB_ROOT, table.file), paths: keyTablePaths(catalog, table) }))
  const wholes = []
  const errors = []

  // 每个入口归属于「它所在目录最深的作用域祖先」：子目录有自己的作用域时不会再算进父级
  const byDepth = [...SCOPE_DIRS].sort((a, b) => b.length - a.length)
  const within = (dir, scope) => scope === '' || dir === scope || dir.startsWith(`${scope}/`)
  const nearestScopeDir = dir => byDepth.find(scope => within(dir, scope)) ?? ''
  const entriesByScope = new Map(SCOPE_DIRS.map(dir => [dir, []]))
  for (const [segment, entries] of segments) {
    const dir = segmentDir(segment)
    if (dir !== null)
      entriesByScope.get(nearestScopeDir(dir))?.push(...entries)
  }

  const own = new Map()
  for (const dir of SCOPE_DIRS) {
    const entries = [...(entriesByScope.get(dir) ?? [])]
    // 交给这一层渲染的模块（灵动岛浮层）：把它们的闭包也并进来
    for (const prefix of RENDERED_BY_SCOPE[dir] ?? []) {
      const absolute = join(WEB_ROOT, prefix)
      entries.push(...listSourceFiles().filter(file => file.startsWith(`${absolute}/`)))
    }
    const closure = moduleClosure(entries, graph)
    const { units, shallow } = messagePathsOfClosure(closure, graph)
    const needed = new Set(units.keys())

    for (const table of tables) {
      if (closure.has(table.absolute))
        table.paths.forEach(path => needed.add(path))
    }
    for (const [namespace, files] of shallow) {
      for (const file of files) {
        const table = tables.find(t => t.namespace === namespace && graph.deps(file).includes(t.absolute))
        if (table)
          continue
        const where = `${relative(WEB_ROOT, file)}（作用域 ${scopeKey(dir)}）`
        if (namespace === '') {
          errors.push(`${where}：useTranslations() 没有命名空间，键却是变量，只能下发整份文案；请给翻译函数指定命名空间`)
          continue
        }
        needed.add(namespace)
        wholes.push(`${where} → 整棵 ${namespace}`)
      }
    }
    own.set(dir, needed)
  }

  // 并上祖先作用域：嵌套 provider 会替掉整棵文案树，子作用域必须自带祖先用到的文案
  const scopes = new Map()
  for (const dir of SCOPE_DIRS) {
    const needed = new Set(own.get(dir))
    for (const parent of SCOPE_DIRS) {
      if (isAncestorDir(parent, dir))
        own.get(parent).forEach(path => needed.add(path))
    }
    scopes.set(dir, collapse([...needed]))
  }

  return { scopes, catalog, wholes: [...new Set(wholes)].sort(), errors: [...new Set(errors)].sort() }
}

/**
 * 配置表文案键的校验：清单必须存在（缺失直接失败，不再跳过），每个键在基准语言里都有文案，
 * 并且全局配置页的作用域下发了它们
 */
export function checkConfigKeys(catalog, scopes) {
  if (!existsSync(CONFIG_KEYS_FILE))
    return [`缺少 ${relative(WEB_ROOT, CONFIG_KEYS_FILE)}：在仓库根目录运行 UPDATE_CONFIG_I18N_KEYS=1 go test ./internal/config/ 生成`]
  const { namespace, keys } = JSON.parse(readFileSync(CONFIG_KEYS_FILE, 'utf8'))
  const problems = []
  const delivered = scopes.get('console/global') ?? []
  for (const key of keys) {
    const path = `${namespace}.${key}`
    if (typeof resolvePath(catalog, path) !== 'string')
      problems.push(`配置表用到的文案 ${path} 在 en.json 里不存在`)
    else if (!delivered.some(item => covers(item, path)))
      problems.push(`作用域 console/global 没有下发配置表用到的 ${path}`)
  }
  return problems
}

export function scopeKey(dir) {
  return dir === '' ? 'root' : dir
}

function generateManifest(scopes) {
  // 每个作用域只写自己这一层新增的路径，父作用域由 SCOPE_PARENT 给出，运行时向上合并（见 src/locales/scopes.ts）
  const parents = {}
  for (const dir of SCOPE_DIRS) {
    const key = scopeKey(dir)
    const ancestor = SCOPE_DIRS
      .filter(other => isAncestorDir(other, dir))
      .sort((a, b) => b.length - a.length)[0]
    parents[key] = ancestor === undefined ? null : scopeKey(ancestor)
  }

  const entries = SCOPE_DIRS.map((dir) => {
    const key = scopeKey(dir)
    const parent = parents[key]
    const inherited = new Set(parent ? scopes.get(parent === 'root' ? '' : parent) : [])
    const own = scopes.get(dir).filter(path => ![...inherited].some(p => path === p || path.startsWith(`${p}.`)))
    const lines = own.map(p => `    '${p}',`).join('\n')
    return `  '${key}': [\n${lines}${lines ? '\n' : ''}  ],`
  })

  const parentEntries = SCOPE_DIRS.map((dir) => {
    const key = scopeKey(dir)
    return `  '${key}': ${parents[key] === null ? 'null' : `'${parents[key]}'`},`
  })

  return `// 由 pnpm i18n:scopes 生成，请勿手改（改动源文件后重新运行即可）
// 每个作用域只列「自己这一层新增」的文案路径，父作用域见 SCOPE_PARENT，运行时向上合并（src/locales/scopes.ts）
// 每条都是整棵子树：顶层命名空间（Comment），或 SPLIT_NAMESPACES 下的子命名空间（Console.global）；
// 更深的路径只来自键表（scripts/i18n-scopes.mjs 的 KEY_TABLES，如控制台菜单标题）

/** 按子命名空间拆分下发的顶层命名空间（运行时据此判断缺失的文案属于哪个下发单元） */
export const SPLIT_NAMESPACES = [${SPLIT_NAMESPACES.map(ns => `'${ns}'`).join(', ')}] as const

export const SCOPES = {
${entries.join('\n')}
} as const

export const SCOPE_PARENT: Record<keyof typeof SCOPES, keyof typeof SCOPES | null> = {
${parentEntries.join('\n')}
}

export type I18nScope = keyof typeof SCOPES
`
}

function scopeLayoutSource(dir) {
  const key = scopeKey(dir)
  return `// 由 pnpm i18n:scopes 生成，请勿手改
// 只为这一层子树准备它用到的文案，避免整份语言表随页面下发（见 src/components/i18n-scope.tsx）
import { I18nScope as I18nScopeProvider } from '@/components/i18n-scope'

export default function Layout({ children }: { children: React.ReactNode }) {
  return <I18nScopeProvider scope="${key}">{children}</I18nScopeProvider>
}
`
}

function main() {
  const check = process.argv.includes('--check')
  const { scopes, catalog, wholes, errors } = computeScopes()
  const problems = [...errors, ...checkConfigKeys(catalog, scopes)]

  // 清单里的单元在基准语言里必须存在：多半是笔误，或文案还没补
  for (const [dir, paths] of scopes) {
    for (const path of paths) {
      if (resolvePath(catalog, path) === undefined)
        problems.push(`作用域 ${scopeKey(dir)} 用到的 ${path} 在 en.json 里不存在`)
    }
  }

  const outputs = [{ file: SCOPES_FILE, content: generateManifest(scopes) }]
  for (const dir of SCOPE_DIRS) {
    if (MANUAL_SCOPE_DIRS.has(dir))
      continue
    outputs.push({ file: join(APP_ROOT, dir, 'layout.tsx'), content: scopeLayoutSource(dir) })
  }

  const stale = []
  for (const { file, content } of outputs) {
    const current = existsSync(file) ? readFileSync(file, 'utf8') : null
    if (current === content)
      continue
    if (check) {
      stale.push(relative(WEB_ROOT, file))
      continue
    }
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content)
  }

  if (!check) {
    const sizes = SCOPE_DIRS.map((dir) => {
      const bytes = scopes.get(dir).reduce((sum, path) => sum + Buffer.byteLength(JSON.stringify(resolvePath(catalog, path) ?? '')), 0)
      return { dir: dir || 'root', count: scopes.get(dir).length, bytes }
    })
    console.log('作用域文案体积（en 为基准，未压缩）：')
    for (const row of [...sizes].sort((a, b) => b.bytes - a.bytes))
      console.log(`  ${(row.bytes / 1024).toFixed(1).padStart(7)} KB  ${String(row.count).padStart(4)} 条  ${row.dir}`)
  }

  if (wholes.length > 0)
    console.log(`\n命名空间太浅、键又是变量，已整棵下发：\n  ${wholes.join('\n  ')}`)

  if (stale.length > 0)
    problems.push(`生成物与源码不同步（运行 pnpm i18n:scopes 更新）：${stale.join('、')}`)
  if (problems.length > 0) {
    console.error(`\n✗ i18n 作用域校验失败：\n  ${problems.join('\n  ')}`)
    process.exit(1)
  }
  if (check)
    console.log('✓ i18n 作用域生成物是最新的，配置表文案键齐全')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main()
