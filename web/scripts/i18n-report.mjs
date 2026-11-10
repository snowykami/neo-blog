/**
 * i18n 作用域报告：每个作用域要下发多少文案、占多少字节，以及和整份语言表相比省了多少。
 *
 * 用法：node scripts/i18n-report.mjs [--locale zh] [--verbose]
 */
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { MESSAGES_DIR, resolvePath } from './i18n-graph.mjs'
import { computeScopes, scopeKey } from './i18n-scopes.mjs'

const args = process.argv.slice(2)
const locale = args.includes('--locale') ? args[args.indexOf('--locale') + 1] : 'zh'
const verbose = args.includes('--verbose')

const messages = JSON.parse(readFileSync(join(MESSAGES_DIR, `${locale}.json`), 'utf8'))
const KB = bytes => `${(bytes / 1024).toFixed(1)} KB`

/** 一组路径拼起来后的字节数（按路径取子树，重复前缀由 collapse 保证不会重复计算） */
function bytesOf(paths) {
  return paths.reduce((sum, path) => {
    const value = resolvePath(messages, path)
    return sum + (value === undefined ? 0 : Buffer.byteLength(JSON.stringify(value)))
  }, 0)
}

const { scopes, catalog, wholes } = computeScopes()
const fullBytes = Buffer.byteLength(JSON.stringify(messages))

console.log(`语言 ${locale}：整份文案 ${KB(fullBytes)}，${Object.keys(messages).length} 个顶层命名空间\n`)

const rows = [...scopes.entries()]
  .map(([dir, paths]) => ({ scope: scopeKey(dir), count: paths.length, bytes: bytesOf(paths) }))
  .sort((a, b) => b.bytes - a.bytes)

console.log('各作用域需要下发的文案（相对整份语言表）：')
for (const row of rows) {
  const ratio = ((row.bytes / fullBytes) * 100).toFixed(0)
  console.log(`  ${KB(row.bytes).padStart(8)}  占 ${String(ratio).padStart(3)}%  ${String(row.count).padStart(4)} 条  ${row.scope}`)
  if (verbose && row.scope !== 'root') {
    const sample = scopes.get(row.scope === 'root' ? '' : row.scope).slice(0, 6).join(', ')
    console.log(`            ${sample} …`)
  }
}

const missing = []
for (const [scope, paths] of scopes) {
  for (const path of paths) {
    if (resolvePath(catalog, path) === undefined)
      missing.push(`${scopeKey(scope)}: ${path}`)
  }
}
if (missing.length > 0)
  console.log(`\n⚠ 这些路径在 en.json（基准语言）里不存在：\n  ${missing.sort().join('\n  ')}`)

if (wholes.length > 0) {
  console.log(`\n命名空间太浅、键又是变量，已整棵下发的位置（共 ${wholes.length} 处）：`)
  console.log(`  ${wholes.join('\n  ')}`)
}
