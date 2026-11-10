/**
 * 生成文章组件注册表：扫描 src/components 下所有 *.content.ts / *.content.tsx（组件定义，默认导出），
 * 写入 src/components/content-components/registry.generated.ts，组件库按文件所在目录展示
 *
 * 用法：node scripts/gen-content-components.mjs [--check]
 * --check：只检查生成结果是否最新，不一致时退出码为 1（测试与 CI 使用）
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
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

/** 从定义文件里读组件名：defineContentComponent({ name: 'card', … }) */
function componentName(file) {
  const match = readFileSync(file, 'utf8').match(/\bname:\s*'([^']+)'/)
  if (!match)
    throw new Error(`${relative(root, file)} 里找不到 name: '…'，无法生成运行时注册表`)
  return match[1]
}

export function generateRuntime() {
  const entries = walk(componentsDir)
    .map((file) => {
      const importPath = `@/components/${relative(componentsDir, file).split(sep).join('/').replace(/\.tsx?$/, '')}`
      return { name: componentName(file), importPath }
    })
    .sort((a, b) => (a.name < b.name ? -1 : 1))

  const duplicated = entries.filter((entry, index) => index > 0 && entries[index - 1].name === entry.name)
  if (duplicated.length > 0)
    throw new Error(`组件名重复：${duplicated.map(entry => entry.name).join(', ')}`)

  return [
    '// 此文件由 scripts/gen-content-components.mjs 生成，请勿手动修改',
    '// 组件名 → 按需加载定义模块（只取 component 字段渲染，schema 与 zod 留在后台/编辑器侧）',
    'import type { AnyContentComponentDef } from \'./types\'',
    '',
    'export const CONTENT_COMPONENT_LOADERS: Record<string, () => Promise<{ default: AnyContentComponentDef }>> = {',
    ...entries.map(entry => `  ${/^[A-Z_$][\w$]*$/i.test(entry.name) ? entry.name : `'${entry.name}'`}: () => import('${entry.importPath}'),`),
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
