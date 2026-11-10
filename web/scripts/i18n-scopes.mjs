/**
 * 生成 i18n 作用域：为每个路由段算出「这一级真正需要的文案」，并写出
 *   1) src/locales/scopes.generated.ts —— 作用域 → 文案路径清单
 *   2) 各作用域目录下的 layout.tsx —— 只做一件事：用 I18nScope 包住子树
 *
 * 用法：
 *   node scripts/i18n-scopes.mjs           写入生成物
 *   node scripts/i18n-scopes.mjs --check   只校验生成物是否最新（测试与 CI 用），不写文件
 */
import { Buffer } from 'node:buffer'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  createGraph,
  dynamicKeyPaths,
  listSourceFiles,
  messagePathsOfClosure,
  moduleClosure,
  readCatalog,
  resolvePath,
  routeSegments,
  SRC_ROOT,
  stringLiteralsOfFile,
  WEB_ROOT,
} from './i18n-graph.mjs'

/** 需要单独一层作用域的目录（相对 src/app）；'' 是根布局 */
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
const APP_ROOT = join(SRC_ROOT, 'app')
const DYNAMIC_SOURCE = 'src/components/console/data.ts'

/** 这些作用域的 layout 是手写的（要带上页面外壳），生成器只写清单、不覆盖文件 */
export const MANUAL_SCOPE_DIRS = new Set(['', '(main)', '(player)', 'console', 'auth'])

/**
 * 一个闭包需要哪些文案路径。
 *
 * 静态能解析到的键按具体路径取。键由变量决定的调用点（`t(group.key)`、`t.has(key) ? t(key) : key`）
 * 退一步用两条兜底：
 *   1) 该命名空间自己那一层的标量键
 *   2) 出现动态调用的那些文件里的字符串字面量中，能对上文案的键（本地常量表通常就写在同一个文件里）
 * 另外 data.ts 里写的菜单标题由变量取用，单独展开。
 */
/** 这些命名空间的键由后端数据决定（错误码表），前端没有任何字面量可循：整棵带上 */
const ALWAYS_WHOLE_NAMESPACES = ['Response.error_details']

export function pathsForClosure({ closure, paths, prefixes, open, catalog, dynamicPaths, dynamicFile }) {
  const needed = new Set(paths.keys())
  const prefixMap = prefixes instanceof Map ? prefixes : new Map()

  // 模板串前缀：`` t(`trend_${x}`) `` 在 Console.dashboard 里挑出所有 trend_ 开头的叶子键
  for (const [key] of prefixMap) {
    const [ns, prefix] = key.split('::')
    for (const leaf of leavesOf(catalog, ns)) {
      if (leaf.slice(ns.length + 1).startsWith(prefix))
        needed.add(leaf)
    }
  }

  // 键空间未知（`t(变量)`、翻译函数被传出）：带该命名空间自己那一层的标量键 +
  // 出现这种用法的文件里的字面量键（本地常量表通常就写在同一处）
  const openEntries = open instanceof Map ? open : new Map([[open, new Set()]])
  for (const [ns, files] of openEntries) {
    for (const [key, value] of Object.entries(catalog[ns] ?? {})) {
      if (!value || typeof value !== 'object')
        needed.add(`${ns}.${key}`)
    }
    for (const file of files ?? []) {
      for (const literal of stringLiteralsOfFile(file)) {
        if (!literal || literal.length > 80)
          continue
        // 字面量可能本身就是带点的子路径（`t('types.comment_created')` 传给被调函数的那种），
        // 只要在文案里解得开就收下；解不开的（类名、URL）自然会被筛掉
        const candidate = `${ns}.${literal}`
        if (typeof resolvePath(catalog, candidate) === 'string')
          needed.add(candidate)
      }
    }
  }
  // 键完全由后端决定、且前端拿不到任何字面量的命名空间：整棵带上
  for (const ns of ALWAYS_WHOLE_NAMESPACES)
    needed.add(ns)

  // 控制台菜单标题写在 data.ts 里、由变量取用
  if (closure.has(dynamicFile)) {
    for (const path of dynamicPaths)
      needed.add(path)
  }
  return needed
}

/** 某棵子树下的全部叶子键路径 */
function leavesOf(catalog, prefix) {
  const out = []
  const walk = (node, path) => {
    for (const [key, value] of Object.entries(node ?? {})) {
      const next = `${path}.${key}`
      if (value && typeof value === 'object')
        walk(value, next)
      else
        out.push(next)
    }
  }
  walk(resolvePath(catalog, prefix), prefix)
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

/**
 * 某个目录这一级需要的文案路径：只看直接放在该目录的入口文件（page/layout/error…），
 * 子目录有自己的作用域；再并上所有祖先作用域，保证继承链完整
 */
/**
 * 后端配置表决定的文案键：internal/config/items.go 里 tab 的 Title、Section 的 Title/Description、
 * item 的 Label/Description 都是前端 `t(...)` 的键，前端源码里根本没有这些字符串，
 * 静态分析无从得知，只能从配置表里读出来（读不到时返回 null，调用方退回整棵 Console.global）
 */
export function configNamespacePaths(catalog, namespace = 'Console.global') {
  const file = join(WEB_ROOT, '..', 'internal', 'config', 'items.go')
  let source = ''
  try {
    source = readFileSync(file, 'utf8')
  }
  catch {
    return null
  }
  const paths = new Set()
  for (const match of source.matchAll(/\b(?:Title|Label|Description):\s*"([^"]+)"/g)) {
    const path = `${namespace}.${match[1]}`
    if (typeof resolvePath(catalog, path) === 'string')
      paths.add(path)
  }

  // 枚举型字段的选项文案：后端用 options(值列表, "前缀") 现拼键名（如 ncm_song_level_exhigh）,
  // 前端只写 t(option.label)，静态分析看不到具体键，按前缀把文案里已有的选项全带上
  const prefixes = new Set()
  // 第一个参数本身可能带逗号（options([]string{"a", "b"}, "前缀")），所以不能排除逗号
  for (const match of source.matchAll(/options\([\s\S]*?,\s*"([^"]+)"\)/g))
    prefixes.add(match[1])
  if (prefixes.size > 0) {
    const subtree = resolvePath(catalog, namespace) ?? {}
    for (const key of Object.keys(subtree)) {
      if ([...prefixes].some(prefix => key.startsWith(prefix)))
        paths.add(`${namespace}.${key}`)
    }
  }
  return paths
}

/**
 * 「JSX 在这里创建、却在别处渲染」的目录 → 实际渲染它的作用域。
 *
 * 灵动岛的浮层就是这种：文章页把 panel 塞进 IslandActivity，真正渲染它的是顶栏的 TopbarIsland，
 * 而顶栏挂载在 (main) 布局里。React context 跟着渲染位置走，所以浮层里取的文案属于 (main) 作用域，
 * 只按模块图给页面作用域是不够的。
 */
export const RENDERED_BY_SCOPE = {
  '(main)': ['src/components/layout/topbar-island'],
}

export function computeScopes() {
  const graph = createGraph()
  const catalog = readCatalog('en')
  const segments = routeSegments()
  const dynamicPaths = dynamicKeyPaths(catalog, [DYNAMIC_SOURCE])
  const dynamicFile = join(WEB_ROOT, DYNAMIC_SOURCE)

  const dynamicNamespaces = []
  // 每个入口归属于「它所在目录最深的作用域祖先」：子目录有自己的作用域时不会再算进父级
  const byDepth = [...SCOPE_DIRS].sort((a, b) => b.length - a.length)
  const within = (dir, scope) => scope === '' || dir === scope || dir.startsWith(`${scope}/`)
  const nearestScopeDir = dir => byDepth.find(scope => within(dir, scope)) ?? ''
  const entriesByScope = new Map(SCOPE_DIRS.map(dir => [dir, []]))
  for (const [segment, entries] of segments) {
    const dir = segment === APP_ROOT ? '' : segment.slice(APP_ROOT.length + 1)
    const scope = nearestScopeDir(dir)
    entriesByScope.get(scope)?.push(...entries)
  }

  // 控制台全局配置页的键由后端配置表决定（internal/config/items.go），整页按配置表补齐
  // Docker 构建上下文只有 web/，读不到仓库根目录的 internal/config/items.go
  const configPaths = configNamespacePaths(catalog)
  const own = new Map()
  for (const dir of SCOPE_DIRS) {
    const entries = [...(entriesByScope.get(dir) ?? [])]
    // 交给这一层渲染的模块（灵动岛浮层）：把它们的闭包也并进来
    for (const prefix of RENDERED_BY_SCOPE[dir] ?? []) {
      const absolute = join(WEB_ROOT, prefix)
      entries.push(...listSourceFiles().filter(file => file.startsWith(`${absolute}/`)))
    }
    const closure = moduleClosure(entries, graph)
    const { paths, prefixes, open } = messagePathsOfClosure(closure, graph)
    if (open.size > 0)
      dynamicNamespaces.push(...[...open.keys()].map(ns => `${dir || 'root'} → ${ns}`))
    const needed = pathsForClosure({ closure, paths, prefixes, open, catalog, dynamicPaths, dynamicFile })
    if (dir === 'console/global') {
      if (configPaths) {
        for (const path of configPaths) needed.add(path)
      }
      // 配置表解析不到时，整棵 Console.global 一起带上：缺文案比多几 KB 更糟
      else {
        needed.add('Console.global')
      }
    }
    own.set(dir, needed)
  }

  // 并上祖先作用域：嵌套 provider 会替掉整棵文案树，子作用域必须自带祖先用到的文案
  const resolved = new Map()
  for (const dir of SCOPE_DIRS) {
    const needed = new Set(own.get(dir))
    for (const parent of SCOPE_DIRS) {
      if (parent === dir)
        continue
      const isAncestor = parent === '' ? dir !== '' : dir.startsWith(`${parent}/`)
      if (!isAncestor)
        continue
      for (const path of own.get(parent)) {
        needed.add(path)
      }
    }
    resolved.set(dir, collapse([...needed]))
  }

  // 核心 = 根作用域
  return { scopes: resolved, catalog, dynamicNamespaces, configKeysAvailable: configPaths !== null }
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
      .filter(other => other !== dir && (other === '' ? dir !== '' : dir.startsWith(`${other}/`)))
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
// 名字带点的是单条键（Console.global.title），不带点的是整棵子树（Comment）

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
  const { scopes, catalog, dynamicNamespaces, configKeysAvailable } = computeScopes()

  if (!configKeysAvailable && check) {
    console.log('· 跳过 i18n 作用域校验：当前目录树里没有 internal/config/items.go（Docker 构建上下文只有 web/），'
      + '以仓库里已提交的 scopes.generated.ts 为准')
    return
  }
  // 读不到后端配置表时算出来的清单是降级的：宁可报错也不覆盖生成物
  if (!configKeysAvailable && !check) {
    console.error('✗ 读不到 internal/config/items.go（控制台配置页的文案键来源）\n'
      + '  请在仓库根目录的完整检出里运行 pnpm i18n:scopes；Docker 构建上下文只有 web/，构建时只跑 --check 并会自动跳过')
    process.exit(1)
  }
  const problems = []

  // 代码里用到但文案里没有的路径：多半是笔误，或文案还没补
  const allPaths = new Set()
  for (const paths of scopes.values()) {
    for (const path of paths) allPaths.add(path)
  }
  const missing = [...allPaths].filter(path => resolvePath(catalog, path) === undefined)

  const outputs = [{ file: SCOPES_FILE, content: generateManifest(scopes) }]
  for (const dir of SCOPE_DIRS) {
    if (MANUAL_SCOPE_DIRS.has(dir))
      continue
    outputs.push({ file: join(APP_ROOT, dir, 'layout.tsx'), content: scopeLayoutSource(dir) })
  }

  for (const { file, content } of outputs) {
    const current = existsSync(file) ? readFileSync(file, 'utf8') : null
    if (current === content)
      continue
    if (check) {
      problems.push(`${relative(WEB_ROOT, file)} 与源码不同步`)
      continue
    }
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content)
  }

  const sizes = SCOPE_DIRS.map((dir) => {
    const bytes = scopes.get(dir).reduce((sum, path) => {
      const value = resolvePath(catalog, path)
      return sum + Buffer.byteLength(JSON.stringify(value ?? ''))
    }, 0)
    return { dir: dir || 'root', count: scopes.get(dir).length, bytes }
  })

  if (!check) {
    console.log('作用域文案体积（en 为基准）：')
    for (const row of [...sizes].sort((a, b) => b.bytes - a.bytes))
      console.log(`  ${(row.bytes / 1024).toFixed(1).padStart(7)} KB  ${String(row.count).padStart(4)} 条  ${row.dir}`)
  }

  if (dynamicNamespaces.length > 0)
    console.log(`\n键由变量决定、按「该层标量 + data.ts 展开」补全的位置：\n  ${dynamicNamespaces.join('\n  ')}`)

  if (missing.length > 0)
    console.warn(`\n⚠ 这些路径在 en.json 里不存在（检查拼写或补文案）：\n  ${missing.sort().join('\n  ')}`)

  if (problems.length > 0) {
    console.error(`\n✗ 生成物与源码不同步：\n  ${problems.join('\n  ')}\n  运行 pnpm i18n:scopes 更新`)
    process.exit(1)
  }
  if (check)
    console.log('✓ i18n 作用域生成物是最新的')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main()
