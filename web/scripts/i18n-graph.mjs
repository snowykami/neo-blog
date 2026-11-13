/**
 * i18n 命名空间依赖图：给「按命名空间拆包」做分析和校验。
 *
 * 做两件事：
 *   1) 用 TypeScript 编译器解析 src 下每个文件的 import / export / 动态 import（解析 @/ 别名与相对路径），
 *      从路由入口求模块闭包，得到「这个路由段渲染时会用到哪些文案」
 *   2) 解析每个文件用到的「下发单元」：`useTranslations('Comment')` → 整棵 `Comment`；
 *      Console 太大，再按子命名空间拆：`useTranslations('Console')` + `c('global.title')` → `Console.global`。
 *      单元内具体取哪些键不再关心，变量键（`t(option.label)`）自然被覆盖
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
const TRANSLATOR_HOOKS = new Set(['useTranslations', 'getTranslations', 'useFormatterT'])

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

/**
 * 按「下发单元」切分时，哪些顶层命名空间要再往下拆一层：
 * Console 与 ContentComponents 体积较大，具体页面只用其中一部分子树（如前台只用少量展示组件，不用编辑器/组件库文案），
 * 因此按 `<命名空间>.<子命名空间>` 拆成两层按需下发；
 * 其余命名空间都不大，整棵下发即可（与按单条键下发相比只多几 KB，却不再怕动态键漏掉）
 */
export const SPLIT_NAMESPACES = ['Console', 'ContentComponents']

/** 下发单元的层数：SPLIT_NAMESPACES 下是两层（Console.global、ContentComponents.weatherCard），其余一层（Comment） */
const unitDepth = path => (SPLIT_NAMESPACES.includes(path.split('.')[0]) ? 2 : 1)

/** 某条路径所在的下发单元：顶层命名空间，或 Console.<子命名空间> */
export function unitOf(path) {
  return path.split('.').slice(0, unitDepth(path)).join('.')
}

/** 命名空间本身是否已经能确定下发单元（'Comment'、'Console.global' 可以；''、'Console' 不行） */
function isUnitDeep(namespace) {
  return namespace !== '' && namespace.split('.').length >= unitDepth(namespace)
}

/**
 * 文件里取用的文案落在哪些下发单元：
 *   `useTranslations('Comment')` 之后不管取什么键都是 `Comment`；
 *   `useTranslations('Console')` + `c('global.title')` → `Console.global`。
 * 命名空间不足以确定单元、键又不是字面量（`consoleT(item.title)`、翻译函数被传出）时，
 * 记进 shallow，交给生成器整棵带上（或由声明过的键表覆盖，见 i18n-scopes.mjs 的 KEY_TABLES）。
 * 返回 { units, shallow }
 */
export function messagePathsOfFile(file, graph) {
  const sf = parseFile(file)
  const units = new Set()
  const shallow = new Set()
  const useDynamic = (namespace) => {
    if (isUnitDeep(namespace))
      units.add(unitOf(namespace))
    else
      shallow.add(namespace)
  }

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

  // 按调用点向上找最近的同名声明，避免同一文件里不同组件各自 `const t = useTranslations('X')` 相互污染
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

  const hookCalls = []
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      // t('key') / t.rich('key') / t.markup('key') / t.has('key')
      const target = ts.isPropertyAccessExpression(callee) ? callee.expression : callee
      if (ts.isIdentifier(target) && TRANSLATOR_HOOKS.has(target.text)) {
        const arg = node.arguments[0]
        hookCalls.push({ node, namespace: arg && ts.isStringLiteralLike(arg) ? arg.text : '' })
      }
      else if (ts.isIdentifier(target)) {
        const { found, namespace } = findTranslatorNamespace(target)
        if (found) {
          const arg = node.arguments[0]
          const literals = collectStringLiterals(arg)
          if (isUnitDeep(namespace)) {
            units.add(unitOf(namespace))
          }
          else if (literals.length > 0) {
            for (const key of literals)
              units.add(unitOf(namespace ? `${namespace}.${key}` : key))
          }
          else if (arg && ts.isTemplateExpression(arg) && arg.head.text.includes('.')) {
            // `` t(`global.${key}`) ``：模板串里确定的那几段足够定位单元时按单元取
            const head = arg.head.text.slice(0, arg.head.text.lastIndexOf('.'))
            useDynamic(namespace ? `${namespace}.${head}` : head)
          }
          else {
            useDynamic(namespace)
          }
        }
      }
    }
    // 翻译函数被当成值传出去（foo(t)、props 里的 t、return t）：接收方取哪些键无从得知
    else if (ts.isIdentifier(node)) {
      const parent = node.parent
      const isCallee = parent && ts.isCallExpression(parent)
        && (parent.expression === node || (ts.isPropertyAccessExpression(parent.expression) && parent.expression.expression === node))
      const isDeclarationName = parent && (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isFunctionDeclaration(parent)) && parent.name === node
      const isPropertyName = parent && ts.isPropertyAccessExpression(parent) && parent.name === node
      if (!isCallee && !isDeclarationName && !isPropertyName) {
        const { found, namespace } = findTranslatorNamespace(node)
        if (found)
          useDynamic(namespace)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  // useTranslations 的结果没有赋给变量（helper hook 直接返回翻译函数，如 useOperationT）：
  // 调用方用它取哪些键无从得知
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
      useDynamic(namespace)
  }

  return { units, shallow }
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

/**
 * 闭包里用到的下发单元，以及「命名空间太浅、键又是变量」的用法。
 * 都返回「单元 / 命名空间 → 文件集合」，便于排查
 */
export function messagePathsOfClosure(closure, graph = createGraph()) {
  const units = new Map()
  const shallow = new Map()
  const record = (map, key, file) => {
    if (!map.has(key))
      map.set(key, new Set())
    map.get(key).add(file)
  }
  for (const file of closure) {
    const result = graph.paths(file)
    for (const unit of result.units) record(units, unit, file)
    for (const ns of result.shallow) record(shallow, ns, file)
  }
  return { units, shallow }
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
