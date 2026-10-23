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
  const content = generate()
  let current = ''
  try {
    current = readFileSync(outputFile, 'utf8')
  }
  catch {}
  if (process.argv.includes('--check')) {
    if (current !== content) {
      console.error('registry.generated.ts 不是最新的，请运行 pnpm gen:content')
      process.exit(1)
    }
  }
  else if (current !== content) {
    writeFileSync(outputFile, content)
    console.log(`content components: ${content.match(/ path: /g)?.length ?? 0} registered`)
  }
}
