/**
 * 构建后收起浏览器代码的 source map（错误报告还原调用栈用，见 src/lib/telemetry/symbolicate.ts）：
 * 把 .next/static 下的 .map 移到不对外提供的 .next/sourcemaps，按 JS 的访问地址（/_next/static/...）建立索引 index.json，
 * 并去掉 JS 末尾指向 source map 的 sourceMappingURL 注释（Turbopack 的 source map 文件名与 JS 不同，只能从注释找到）。
 * 源码因此不会被公开访问到；部署时把 .next/sourcemaps 一起放进运行镜像（见 Dockerfile）。
 *
 * 用法：node scripts/collect-sourcemaps.mjs（pnpm build 的最后一步）
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const staticDir = join(root, '.next/static')
const outputDir = join(root, '.next/sourcemaps')
const MAPPING_COMMENT = /\n\/\/# sourceMappingURL=(\S+)\s*$/

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory())
      walk(path, files)
    else
      files.push(path)
  }
  return files
}

if (!existsSync(staticDir)) {
  console.error('collect-sourcemaps: .next/static not found, run next build first')
  process.exit(1)
}
rmSync(outputDir, { recursive: true, force: true })
mkdirSync(outputDir, { recursive: true })

const toPosix = path => path.split(sep).join('/')
const index = {}
const files = walk(staticDir)
for (const file of files.filter(f => f.endsWith('.js'))) {
  const code = readFileSync(file, 'utf8')
  const match = MAPPING_COMMENT.exec(code)
  if (!match || match[1].startsWith('data:'))
    continue
  const mapFile = resolve(dirname(file), match[1])
  writeFileSync(file, code.slice(0, match.index + 1))
  if (!existsSync(mapFile))
    continue
  const target = join(outputDir, relative(staticDir, mapFile))
  mkdirSync(dirname(target), { recursive: true })
  renameSync(mapFile, target)
  index[`/_next/static/${toPosix(relative(staticDir, file))}`] = toPosix(relative(outputDir, target))
}
// 没有被任何 JS 引用的 source map（如 CSS 的）也不留在公开目录里
for (const file of files.filter(f => f.endsWith('.map') && existsSync(f)))
  unlinkSync(file)
writeFileSync(join(outputDir, 'index.json'), JSON.stringify(index))
console.log(`collect-sourcemaps: moved ${Object.keys(index).length} source maps to .next/sourcemaps`)

// 为 standalone 生产入口注入运行时 COMPRESS / NEXT_COMPRESS 环境变量支持（默认延续构建配置，设置 false / 0 时在运行时关闭）
const serverJsCandidates = [
  join(root, '.next/standalone/server.js'),
  join(root, '.next/standalone/web/server.js'),
]
for (const serverJsPath of serverJsCandidates) {
  if (existsSync(serverJsPath)) {
    let content = readFileSync(serverJsPath, 'utf8')
    const target = 'process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig)'
    const patch = `// 运行时支持通过 COMPRESS / NEXT_COMPRESS 环境变量动态开关压缩
const compressEnv = process.env.COMPRESS ?? process.env.NEXT_COMPRESS
if (compressEnv !== undefined) {
  nextConfig.compress = compressEnv === 'true' || compressEnv === '1' || compressEnv === 'on'
}
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig)`
    if (content.includes(target) && !content.includes('compressEnv')) {
      content = content.replace(target, patch)
      writeFileSync(serverJsPath, content)
      console.log(`collect-sourcemaps: enabled runtime COMPRESS env in ${relative(root, serverJsPath)}`)
    }
  }
}
