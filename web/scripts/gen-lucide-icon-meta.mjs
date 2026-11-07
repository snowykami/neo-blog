/**
 * 生成行内图标选择器的检索数据：src/lib/inline-icon/lucide-meta.json
 * - 图标清单取自已安装的 lucide-react（只收主名，别名并入检索词），与正文渲染用的图标数据同一来源
 * - 检索词与分类取自 lucide.dev 的公开接口（lucide-react 包里没有），只保留已安装版本中存在的图标；
 *   接口里没有数据的图标仍会列出，只能按名字检索
 * - 输出提交到仓库（需要联网生成）；升级 lucide-react 后运行一次，lucide-meta.test.ts 会检查版本是否一致
 *
 * 用法：node scripts/gen-lucide-icon-meta.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lucideDir = join(root, 'node_modules/lucide-react')
const outputFile = join(root, 'src/lib/inline-icon/lucide-meta.json')

async function fetchJSON(url) {
  const res = await fetch(url)
  if (!res.ok)
    throw new Error(`GET ${url}: ${res.status}`)
  return res.json()
}

const { version } = JSON.parse(readFileSync(join(lucideDir, 'package.json'), 'utf8'))
const { dynamicIconImports } = await import(join(lucideDir, 'dynamic.mjs'))

// 主名 → 别名
const aliases = new Map()
for (const [key, load] of Object.entries(dynamicIconImports)) {
  const { __iconData } = await load()
  const name = __iconData.name ?? key
  if (!aliases.has(name))
    aliases.set(name, [])
  if (key !== name)
    aliases.get(name).push(key)
}

const [tags, categories] = await Promise.all([
  fetchJSON('https://lucide.dev/api/tags'),
  fetchJSON('https://lucide.dev/api/categories'),
])

const names = [...aliases.keys()].sort()
// 分类按图标数从多到少排列，即选择器中的展示顺序
const counts = new Map()
for (const name of names) {
  for (const category of categories[name] ?? [])
    counts.set(category, (counts.get(category) ?? 0) + 1)
}
const categoryList = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || (a < b ? -1 : 1))

const icons = names.map((name) => {
  const words = [...new Set([...aliases.get(name).map(alias => alias.replaceAll('-', ' ')), ...(tags[name] ?? [])].map(word => word.toLowerCase().replaceAll(',', ' ').trim()).filter(Boolean))]
  return [name, words.join(','), (categories[name] ?? []).map(category => categoryList.indexOf(category)).sort((a, b) => a - b)]
})

// 一个图标一行，格式符合 ESLint 的 JSON 规则，升级后的差异也便于查看
const lines = [
  '{',
  `  "version": ${JSON.stringify(version)},`,
  `  "categories": ${JSON.stringify(categoryList).replace(/","/g, '", "')},`,
  '  "icons": [',
  ...icons.map(([name, words, cats], index) => `    [${JSON.stringify(name)}, ${JSON.stringify(words)}, ${JSON.stringify(cats).replace(/,/g, ', ')}]${index < icons.length - 1 ? ',' : ''}`),
  '  ]',
  '}',
]
writeFileSync(outputFile, `${lines.join('\n')}\n`)
const missing = names.filter(name => !tags[name] && !categories[name]).length
process.stdout.write(`lucide-react ${version}: ${names.length} icons, ${categoryList.length} categories, ${missing} without metadata -> ${outputFile}\n`)
