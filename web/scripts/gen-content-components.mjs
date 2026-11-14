/**
 * 生成文章组件注册表（写路径与读路径两份产物，不可混用）：
 * 1. registry.generated.ts（写路径 / 后台编辑器专用）：扫描 src/components 下所有 *.content.ts / *.content.tsx，
 *    静态导入全部组件定义（含 zod schema、表单推导、降级生成），严禁被前台访客组件引入；
 * 2. runtime-registry.generated.ts（读路径 / 前台访客专用）：从 *.content.ts(x) 中静态提取 name、version、heights
 *    以及 `component: dynamic(() => import('...'))` 指向的纯展示视图路径，让前台按需直连纯视图，彻底跳过 *.content.ts 与 zod（省约 144 KiB raw / 42 KiB gzip）。
 *
 * 用法：node scripts/gen-content-components.mjs [--check]
 * --check：同时检查两份生成物是否最新，不一致时退出码为 1（测试与 CI 使用）
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const componentsDir = join(root, 'src/components')
export const outputFile = join(componentsDir, 'content-components/registry.generated.ts')
/** 运行时按需加载组件定义用（名字 → import），不含 schema，供访客侧渲染组件卡片等场景 */
export const runtimeOutputFile = join(componentsDir, 'content-components/runtime-registry.generated.ts')
const DEFINITION_SUFFIX = /\.content\.tsx?$/

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory())
      return walk(full)
    return DEFINITION_SUFFIX.test(entry.name) ? [full] : []
  })
}

/** 组件库中的路径：相对 src/components，去掉后缀；文件名与所在目录同名（或为 index）时只保留目录 */
function libraryPath(file) {
  const segments = relative(componentsDir, file).split(sep)
  const base = segments.pop().replace(DEFINITION_SUFFIX, '')
  if (base !== 'index' && base !== segments.at(-1))
    segments.push(base)
  return segments.join('/')
}

function identifier(path) {
  return path
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((word, index) => (index === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1)))
    .join('')
}

/**
 * 从定义文件里读取前台运行时渲染所需的元信息（name、version、heights、纯展示视图路径）：
 * 只用正则抽取字面量而不引入文件模块，避免把 zod / schema 带入运行时注册表（load() 必须直指纯视图模块）
 */
function runtimeEntry(file) {
  const source = readFileSync(file, 'utf8')
  const rel = relative(root, file)
  const nameMatch = source.match(/\bname:\s*'([^']+)'/)
  if (!nameMatch)
    throw new Error(`${rel} 里找不到 name: '…'，无法生成运行时注册表`)

  const versionMatch = source.match(/\bversion:\s*(\d+)/)
  if (!versionMatch)
    throw new Error(`${rel} 里找不到 version: <number>，无法生成运行时注册表`)

  const compMatch = source.match(/\bcomponent:\s*dynamic\(\(\)\s*=>\s*import\('([^']+)'\)\)/)
  if (!compMatch)
    throw new Error(`${rel} 里找不到 component: dynamic(() => import('…'))，无法生成运行时注册表`)

  const viewSpec = compMatch[1]
  const resolvedBase = viewSpec.startsWith('@/')
    ? join(root, 'src', viewSpec.slice(2))
    : resolve(dirname(file), viewSpec)
  const viewFile = ['', '.tsx', '.ts', '/index.tsx', '/index.ts']
    .map(suffix => resolvedBase + suffix)
    .find(candidate => existsSync(candidate) && statSync(candidate).isFile())
  if (!viewFile)
    throw new Error(`${rel} 指向的视图模块不存在：${viewSpec}`)

  const relFromComponents = relative(componentsDir, viewFile).split(sep).join('/')
  if (relFromComponents.startsWith('..'))
    throw new Error(`${rel} 的视图模块必须在 src/components 下：${relFromComponents}`)
  const viewImportPath = `@/components/${relFromComponents.replace(/\/index\.tsx?$/, '').replace(/\.tsx?$/, '')}`

  const heightsMatch = source.match(/\bheights:\s*(\[[^\]]+\])/)
  const heights = heightsMatch ? heightsMatch[1].replace(/\s+/g, ' ').trim() : null

  return {
    name: nameMatch[1],
    version: Number.parseInt(versionMatch[1], 10),
    heights,
    viewImportPath,
  }
}

export function generateRuntime() {
  const entries = walk(componentsDir)
    .map(runtimeEntry)
    .sort((a, b) => (a.name < b.name ? -1 : 1))

  const duplicated = entries.filter((entry, index) => index > 0 && entries[index - 1].name === entry.name)
  if (duplicated.length > 0)
    throw new Error(`组件名重复：${duplicated.map(entry => entry.name).join(', ')}`)

  return [
    '// 此文件由 scripts/gen-content-components.mjs 生成，请勿手动修改',
    '// 前台读路径专用：组件名 → 按需加载纯展示视图（直接指向视图模块，彻底跳过 *.content.ts 与 zod）',
    '// 若需完整 schema / 默认值 / 编辑器配置（写路径），请仅在后台代码中使用 registry.ts',
    'import type { RuntimeContentComponentSpec } from \'./runtime\'',
    '',
    'export const CONTENT_COMPONENT_LOADERS: Record<string, RuntimeContentComponentSpec> = {',
    ...entries.map((entry) => {
      const key = /^[A-Z_$][\w$]*$/i.test(entry.name) ? entry.name : `'${entry.name}'`
      const parts = [`version: ${entry.version}`]
      if (entry.heights)
        parts.push(`heights: ${entry.heights}`)
      parts.push(`load: () => import('${entry.viewImportPath}')`)
      return `  ${key}: { ${parts.join(', ')} },`
    }),
    '}',
    '',
  ].join('\n')
}

export function generate() {
  const entries = walk(componentsDir)
    .map((file) => {
      const path = libraryPath(file)
      const importPath = `@/components/${relative(componentsDir, file).split(sep).join('/').replace(/\.tsx?$/, '')}`
      return { path, importPath, name: identifier(path) }
    })
    .sort((a, b) => (a.importPath < b.importPath ? -1 : 1))

  return [
    '// 此文件由 scripts/gen-content-components.mjs 根据 src/components/**/*.content.{ts,tsx} 生成，请勿手动修改',
    '// 新增组件：在组件旁添加 <名称>.content.ts(x) 并默认导出 defineContentComponent(...)，然后运行 pnpm gen:content',
    'import type { ContentComponentEntry } from \'./types\'',
    ...entries.map(entry => `import ${entry.name} from '${entry.importPath}'`),
    '',
    'export const GENERATED_CONTENT_COMPONENTS: ContentComponentEntry[] = [',
    ...entries.map(entry => `  { path: '${entry.path}', def: ${entry.name} },`),
    ']',
    '',
  ].join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outputs = [
    { file: outputFile, content: generate(), label: 'registry.generated.ts' },
    { file: runtimeOutputFile, content: generateRuntime(), label: 'runtime-registry.generated.ts' },
  ]
  let stale = 0
  for (const { file, content, label } of outputs) {
    let current = ''
    try {
      current = readFileSync(file, 'utf8')
    }
    catch {}
    if (current === content)
      continue
    if (process.argv.includes('--check')) {
      console.error(`${label} 不是最新的，请运行 pnpm gen:content`)
      stale += 1
      continue
    }
    writeFileSync(file, content)
    console.log(`content components: ${label} 已更新`)
  }
  if (stale > 0)
    process.exit(1)
}
