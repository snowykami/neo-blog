/**
 * i18n 命名空间依赖图：给「按命名空间拆包」做分析和校验。
 *
 * 做两件事：
 *   1) 用 TypeScript 编译器解析 src 下每个文件的 import / export / 动态 import（解析 @/ 别名与相对路径），
 *      从路由入口求模块闭包，得到「这个路由段渲染时会用到哪些文案」
 *   2) 解析每个文件里实际取用的文案键：`const t = useTranslations('Comment')` + `t('reply')`
 *      → 命名空间路径 `Comment`；`const c = useTranslations('Console')` + `c('global.title')`
 *      → 深层路径 `Console.global.title`，只带这些键，不会把整个 Console 拖进来
 *
 * 组件被别的目录引用也会被带进来，所以结果不依赖目录约定。
 * 供 scripts/i18n-scopes.mjs 与 src/locales/coverage.test.ts 共用。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

export const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const SRC_ROOT = join(WEB_ROOT, 'src')
export const MESSAGES_DIR = join(SRC_ROOT, 'locales')

const ENTRY_FILES = new Set(['page.tsx', 'layout.tsx', 'template.tsx', 'error.tsx', 'not-found.tsx', 'loading.tsx', 'global-error.tsx'])
const SCRIPT_EXT = /\.(?:tsx|ts)$/
const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']
const stringLiteralCache = new Map()
const TRANSLATOR_HOOKS = new Set(['useTranslations', 'getTranslations', 'useFormatterT'])

/** 文案在运行时由变量决定取哪个键的文件：把里面能对上文案的字符串字面量整体算作需要（如控制台菜单标题） */
const DYNAMIC_KEY_FILES = ['src/components/console/data.ts']

/** src 下所有脚本文件（跳过测试与生成物） */
export function listSourceFiles() {
  const out = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (SCRIPT_EXT.test(name) && !name.includes('.test.'))
        out.push(full)
    }
  }
  walk(SRC_ROOT)
  return out
}

function parseFile(file) {
  const source = readFileSync(file, 'utf8')
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
}

/** 条件表达式里的字面量键：t(a ? 'x' : 'y') → ['x', 'y']；不是字面量时返回空数组 */
function collectStringLiterals(node) {
  if (!node)
    return []
  if (ts.isStringLiteralLike(node))
    return [node.text]
  if (ts.isConditionalExpression(node))
    return [...collectStringLiterals(node.whenTrue), ...collectStringLiterals(node.whenFalse)]
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node))
    return collectStringLiterals(node.expression)
  return []
}

/** 文件里出现的全部字符串字面量（给动态键做兜底匹配用） */
export function stringLiteralsOfFile(file) {
  const cache = stringLiteralCache.get(file)
  if (cache)
    return cache
  const out = new Set()
  const visit = (node) => {
    if (ts.isStringLiteralLike(node))
      out.add(node.text)
    ts.forEachChild(node, visit)
  }
  visit(parseFile(file))
  stringLiteralCache.set(file, out)
  return out
}

/**
 * 文件里取用的文案路径：`useTranslations('Comment')` + `t('reply')` → `Comment.reply`；
 * `useTranslations('Console')` + `c('global.title')` → `Console.global.title`。
 * 键不是字面量时：模板串记下前缀，其余（变量键、翻译函数被传出、helper hook 返回翻译函数）记进 open。
 * 返回 { paths, prefixes, open }：具体路径、模板串前缀、键空间未知（要整棵带上）的命名空间
 */
export function messagePathsOfFile(file, graph) {
  const sf = parseFile(file)
  const paths = new Set()
  // 模板串前缀（`` t(`trend_${x}`) `` → 'trend_'）：具体键交给生成器按文案里的叶子键展开
  const prefixes = new Set()
  // helper hook 直接返回翻译函数（useAIAgentT 之类）：调用方用它取哪些键无从得知，整棵子树都要带上
  const open = new Set()

  // 按调用点向上找最近的同名声明，避免同一文件里不同组件各自 `const t = useTranslations('X')` / `useTranslations()` 相互污染
  // import 进来的 helper（useCommonT/useConfigT…）→ 命名空间
  const helperAliases = new Map()
  if (graph) {
    for (const statement of sf.statements) {
      if (!ts.isImportDeclaration(statement) || !statement.importClause?.namedBindings || !ts.isNamedImports(statement.importClause.namedBindings))
        continue
      const from = resolveImport(file, statement.moduleSpecifier.text)
      if (!from)
        continue
      const helpers = graph.helpers(from)
      for (const element of statement.importClause.namedBindings.elements) {
        const original = (element.propertyName ?? element.name).text
        const namespace = helpers.get(original)
        if (namespace !== undefined)
          helperAliases.set(element.name.text, namespace)
      }
    }
  }

  const findTranslatorNamespace = (idNode) => {
    const name = idNode.text
    for (let node = idNode.parent; node; node = node.parent) {
      const statements = ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node)
        ? node.statements
        : (ts.isArrowFunction(node) || ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) && node.body && ts.isBlock(node.body)
            ? node.body.statements
            : null
      if (!statements)
        continue
      for (const statement of statements) {
        if (!ts.isVariableStatement(statement))
          continue
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name || !declaration.initializer)
            continue
          let init = declaration.initializer
          if (ts.isAwaitExpression(init))
            init = init.expression
          if (ts.isCallExpression(init) && ts.isIdentifier(init.expression)) {
            if (TRANSLATOR_HOOKS.has(init.expression.text)) {
              const arg = init.arguments[0]
              return { found: true, namespace: arg && ts.isStringLiteralLike(arg) ? arg.text : '' }
            }
            if (helperAliases.has(init.expression.text))
              return { found: true, namespace: helperAliases.get(init.expression.text) }
          }
        }
      }
    }
    return { found: false, namespace: '' }
  }

  // 翻译函数被整体传出（作为参数、return、放进 useCallback）时，取哪些键无法静态确定
  const declaredNamespaces = new Map() // 变量名 → 命名空间
  const passedAround = new Set() // 变量名集合：出现过「整体传出」的用法
  const hookCalls = []

  const visitCalls = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      // t('key') / t.rich('key') / t.markup('key')
      const target = ts.isPropertyAccessExpression(callee) ? callee.expression : callee
      if (ts.isIdentifier(target)) {
        if (TRANSLATOR_HOOKS.has(target.text) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
          hookCalls.push({ node, namespace: node.arguments[0].text })
        }
        else {
          const { found, namespace } = findTranslatorNamespace(target)
          if (found) {
            const arg = node.arguments[0]
            const literals = collectStringLiterals(arg)
            if (arg && ts.isStringLiteralLike(arg)) {
              paths.add(namespace ? `${namespace}.${arg.text}` : arg.text)
            }
            else if (literals.length > 0) {
              // t(a ? 'x' : 'y') 这类：分支都是字面量，逐条精确取
              for (const key of literals)
                paths.add(namespace ? `${namespace}.${key}` : key)
            }
            else if (arg && ts.isTemplateExpression(arg)) {
              // 模板串：`` t(`trend_${x}`) ``、`` t(`platforms.${id}`) `` —— 前缀是确定的，
              // 具体键由生成器在文案里按前缀挑叶子键（见 pathsForClosure）
              prefixes.add(`${namespace}::${arg.head.text}`)
            }
            else {
              passedAround.add(target.text)
            }
            declaredNamespaces.set(target.text, namespace)
          }
        }
      }
    }
    ts.forEachChild(node, visitCalls)
  }
  visitCalls(sf)

  // 翻译函数被当成值传出去（foo(…, t)、props 里的 t、return t）：
  // 接收方会用它取哪些键无从得知，文件里的字面量键由生成器兜底（见 pathsForClosure）
  const visitIdentifiers = (node) => {
    if (ts.isIdentifier(node)) {
      const parent = node.parent
      const isCallee = parent && ts.isCallExpression(parent)
        && (parent.expression === node || (ts.isPropertyAccessExpression(parent.expression) && parent.expression.expression === node))
      const isDeclarationName = parent && (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isFunctionDeclaration(parent)) && parent.name === node
      const isPropertyName = parent && ts.isPropertyAccessExpression(parent) && parent.name === node
      if (!isCallee && !isDeclarationName && !isPropertyName) {
        const { found, namespace } = findTranslatorNamespace(node)
        if (found) {
          passedAround.add(node.text)
          declaredNamespaces.set(node.text, namespace)
        }
      }
    }
    ts.forEachChild(node, visitIdentifiers)
  }
  visitIdentifiers(sf)

  // 变量声明以外的地方调用 useTranslations：helper hook 直接返回翻译函数（useOperationT 之类），
  // 调用方用它取哪些键无从得知，整棵命名空间都要带上
  for (const { node, namespace } of hookCalls) {
    // `const t = await getTranslations('X')` 的父节点是 AwaitExpression，不能只看上一层
    let top = node
    let parent = node.parent
    while (parent && (ts.isAwaitExpression(parent) || ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent))) {
      top = parent
      parent = parent.parent
    }
    const declared = parent && ts.isVariableDeclaration(parent) && parent.initializer === top
    if (!declared)
      open.add(namespace)
  }
  // 显式声明了变量，但翻译函数被传出（formatApiError(t, …)）：同样按整棵命名空间处理
  for (const name of passedAround) {
    if (declaredNamespaces.has(name))
      open.add(declaredNamespaces.get(name))
  }

  return { paths, prefixes, open }
}

/**
 * 文件里「返回翻译函数」的 helper：`export const useCommonT = () => useTranslations('Common')`、
 * `export function useConfigT() { const t = useTranslations('Console.global'); return useCallback(k => t(k)) }`。
 * 调用方 `const tr = useConfigT()` 之后 `tr('x')` 的命名空间就是它，静态解析据此还原。
 * 返回 Map<名称, 命名空间>
 */
export function helperNamespacesOfFile(file) {
  const sf = parseFile(file)
  const helpers = new Map()
  const namespacesIn = (node) => {
    const found = new Set()
    const visit = (child) => {
      if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && TRANSLATOR_HOOKS.has(child.expression.text)) {
        const arg = child.arguments[0]
        found.add(arg && ts.isStringLiteralLike(arg) ? arg.text : '')
      }
      ts.forEachChild(child, visit)
    }
    visit(node)
    return found
  }
  const record = (name, node) => {
    const found = namespacesIn(node)
    if (found.size === 1)
      helpers.set(name, [...found][0])
  }
  for (const statement of sf.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      record(statement.name.text, statement.body)
    }
    else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          record(declaration.name.text, declaration.initializer)
        }
      }
    }
  }
  return helpers
}

/** 解析 import 说明符到 src 内的真实文件 */
function resolveImport(fromFile, specifier) {
  const target = specifier.startsWith('@/')
    ? join(SRC_ROOT, specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(dirname(fromFile), specifier)
      : null
  if (!target)
    return null
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = target + suffix
    try {
      if (statSync(candidate).isFile())
        return candidate
    }
    catch {}
  }
  return null
}

function dependenciesOfFile(file, sf) {
  const specs = new Set()
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
      specs.add(node.moduleSpecifier.text)
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0]))
      specs.add(node.arguments[0].text)
    ts.forEachChild(node, visit)
  }
  visit(sf)
  const out = []
  for (const spec of specs) {
    const resolved = resolveImport(file, spec)
    if (resolved)
      out.push(resolved)
  }
  return out
}

/** 模块图缓存：依赖与文案路径都按文件惰性解析一次 */
export function createGraph() {
  const parseds = new Map()
  const deps = new Map()
  const paths = new Map()
  const helpers = new Map()
  const parsed = (file) => {
    if (!parseds.has(file))
      parseds.set(file, parseFile(file))
    return parseds.get(file)
  }
  return {
    deps(file) {
      if (!deps.has(file))
        deps.set(file, dependenciesOfFile(file, parsed(file)))
      return deps.get(file)
    },
    helpers(file) {
      if (!helpers.has(file))
        helpers.set(file, helperNamespacesOfFile(file))
      return helpers.get(file)
    },
    paths(file) {
      if (!paths.has(file))
        paths.set(file, messagePathsOfFile(file, this))
      return paths.get(file)
    },
    parsed,
  }
}

/** 从若干入口文件出发的模块闭包 */
export function moduleClosure(entries, graph = createGraph()) {
  const seen = new Set()
  const queue = [...entries]
  while (queue.length > 0) {
    const file = queue.pop()
    if (seen.has(file))
      continue
    seen.add(file)
    for (const dep of graph.deps(file)) {
      if (!seen.has(dep))
        queue.push(dep)
    }
  }
  return seen
}

/** 闭包里需要的文案路径，返回「路径 → 文件集合」便于排查 */
export function messagePathsOfClosure(closure, graph = createGraph()) {
  const out = new Map()
  const prefixes = new Map()
  const open = new Map()
  for (const file of closure) {
    const { paths, prefixes: filePrefixes, open: fileOpen } = graph.paths(file)
    for (const path of paths) {
      if (!out.has(path))
        out.set(path, new Set())
      out.get(path).add(file)
    }
    for (const prefix of filePrefixes) {
      if (!prefixes.has(prefix))
        prefixes.set(prefix, new Set())
      prefixes.get(prefix).add(file)
    }
    for (const ns of fileOpen ?? []) {
      if (!open.has(ns))
        open.set(ns, new Set())
      open.get(ns).add(file)
    }
  }
  return { paths: out, prefixes, open }
}

/** 路由入口分组：目录 → 该目录下的入口文件 */
export function routeSegments(files = listSourceFiles()) {
  const segments = new Map()
  for (const file of files) {
    if (!ENTRY_FILES.has(file.split('/').pop()))
      continue
    const dir = dirname(file)
    if (!segments.has(dir))
      segments.set(dir, [])
    segments.get(dir).push(file)
  }
  return segments
}

/**
 * 文案由变量决定取哪个键的地方（如控制台菜单标题）：把文件里能对上文案的字符串字面量全部算进来。
 * catalog 传入某个语言的文案，只有真实存在的路径才会被保留。
 */
export function dynamicKeyPaths(catalog, files = DYNAMIC_KEY_FILES) {
  const out = new Set()
  // 只认叶子键：`id: 'dashboard'` 这类值会撞上 Console.dashboard 这棵子树，把整棵带进来没有意义
  const exists = (path) => {
    let node = catalog
    for (const part of path.split('.')) {
      if (!node || typeof node !== 'object' || !(part in node))
        return false
      node = node[part]
    }
    return typeof node === 'string'
  }
  for (const rel of files) {
    const sf = parseFile(join(WEB_ROOT, rel))
    const visit = (node) => {
      if (ts.isStringLiteralLike(node)) {
        for (const prefix of ['', 'Console.', 'Common.']) {
          const candidate = prefix + node.text
          if (node.text.includes('.') && exists(candidate))
            out.add(candidate)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return out
}

export function relativePath(file) {
  return relative(WEB_ROOT, file)
}

/** 读取某个语言的文案（构建期用，默认 en 作为键结构的基准） */
export function readCatalog(locale = 'en') {
  return JSON.parse(readFileSync(join(MESSAGES_DIR, `${locale}.json`), 'utf8'))
}

/** 按路径取文案子树；不存在返回 undefined */
export function resolvePath(catalog, path) {
  let node = catalog
  for (const part of path.split('.')) {
    if (!node || typeof node !== 'object' || !(part in node))
      return undefined
    node = node[part]
  }
  return node
}

export { ENTRY_FILES }
