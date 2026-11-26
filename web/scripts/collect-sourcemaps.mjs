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

// 清理 Next 16 Turbopack 在未使用 next/font 时生成的空数组路由项（`app[route] = []`）：
// Next 的 getPreloadableFonts 对空数组返回 `[]` 而非 `null`，触发 getLayerAssets 输出无意义的 `</>; rel=preconnect; crossorigin=""`（Lighthouse 报告 Unused preconnect）
function pruneEmptyFontManifestObj(manifest) {
  if (!manifest || typeof manifest !== 'object')
    return false
  let changed = false
  for (const section of ['app', 'pages']) {
    const map = manifest[section]
    if (!map || typeof map !== 'object')
      continue
    for (const [key, val] of Object.entries(map)) {
      if (Array.isArray(val) && val.length === 0) {
        delete map[key]
        changed = true
      }
    }
  }
  if (changed && Object.keys(manifest.app ?? {}).length === 0 && Object.keys(manifest.pages ?? {}).length === 0) {
    manifest.appUsingSizeAdjust = false
    manifest.pagesUsingSizeAdjust = false
  }
  return changed
}

const serverRoots = [
  join(root, '.next/server'),
  join(root, '.next/standalone/.next/server'),
  join(root, '.next/standalone/web/.next/server'),
]
let cleanedFontManifests = 0
let cleanedMetaPreconnects = 0
for (const srvRoot of serverRoots) {
  if (!existsSync(srvRoot))
    continue
  for (const file of walk(srvRoot)) {
    if (file.endsWith('next-font-manifest.json')) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'))
        if (pruneEmptyFontManifestObj(parsed)) {
          writeFileSync(file, JSON.stringify(parsed))
          cleanedFontManifests++
        }
      }
      catch {}
    }
    else if (file.endsWith('next-font-manifest.js')) {
      const src = readFileSync(file, 'utf8')
      const prefix = 'self.__NEXT_FONT_MANIFEST='
      const idx = src.indexOf(prefix)
      if (idx >= 0) {
        const jsonPart = src.slice(idx + prefix.length).trim().replace(/;$/, '')
        try {
          const parsed = JSON.parse(jsonPart)
          if (pruneEmptyFontManifestObj(parsed)) {
            writeFileSync(file, `${src.slice(0, idx)}${prefix}${JSON.stringify(parsed)}`)
            cleanedFontManifests++
          }
        }
        catch {}
      }
    }
    else if (file.endsWith('.meta')) {
      try {
        const meta = JSON.parse(readFileSync(file, 'utf8'))
        const linkHeader = meta?.headers?.['x-nextjs-prerender'] !== undefined || typeof meta?.headers?.link === 'string'
          ? meta.headers?.link
          : undefined
        if (typeof linkHeader === 'string' && linkHeader.includes('</>; rel=preconnect')) {
          const parts = linkHeader
            .split(',')
            .map(s => s.trim())
            .filter(s => s && !/^<\/\s*>;\s*rel="?preconnect"?/i.test(s))
          if (parts.length > 0)
            meta.headers.link = parts.join(', ')
          else
            delete meta.headers.link
          writeFileSync(file, JSON.stringify(meta))
          cleanedMetaPreconnects++
        }
      }
      catch {}
    }
  }
}
if (cleanedFontManifests > 0 || cleanedMetaPreconnects > 0) {
  console.log(`collect-sourcemaps: pruned ${cleanedFontManifests} empty font manifests and ${cleanedMetaPreconnects} root preconnect meta headers`)
}

const STANDALONE_CONFIG_ANCHOR = 'process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig)'

const RUNTIME_COMPRESS_PATCH = `// 运行时支持通过 COMPRESS / NEXT_COMPRESS 环境变量动态开关压缩
const compressEnv = process.env.COMPRESS ?? process.env.NEXT_COMPRESS
if (compressEnv !== undefined) {
  nextConfig.compress = compressEnv === 'true' || compressEnv === '1' || compressEnv === 'on'
}`

const RUNTIME_IMAGE_HOSTS_PATCH = `// 运行时支持通过 IMAGE_OPTIMIZE_HOSTS 动态覆盖 Next 图片优化远程白名单
const imageHostsEnv = process.env.IMAGE_OPTIMIZE_HOSTS ?? process.env.NEXT_PUBLIC_IMAGE_OPTIMIZE_HOSTS
if (imageHostsEnv !== undefined) {
  const hosts = []
  for (const part of imageHostsEnv.split(',')) {
    const trimmed = part.trim().toLowerCase()
    if (!trimmed) continue
    let host = ''
    if (trimmed.includes('://')) {
      try { host = new URL(trimmed).hostname.toLowerCase() } catch { continue }
    } else {
      host = trimmed.replace(/^\\/+|\\/+$/g, '').split('/')[0] ?? ''
    }
    if (host && !/\\s/.test(host) && !hosts.includes(host))
      hosts.push(host)
  }
  const remotePatterns = hosts.map(hostname => ({ protocol: 'https', hostname, port: '', pathname: '/**' }))
  if (typeof nextConfig.assetPrefix === 'string' && nextConfig.assetPrefix.startsWith('http')) {
    try {
      const assetUrl = new URL(nextConfig.assetPrefix)
      const proto = assetUrl.protocol.replace(/:$/, '')
      if (!remotePatterns.some(p => p.hostname === assetUrl.hostname && p.protocol === proto && (p.port ?? '') === assetUrl.port))
        remotePatterns.push({ hostname: assetUrl.hostname, protocol: proto, port: assetUrl.port })
    } catch {}
  }
  nextConfig.images = { ...nextConfig.images, remotePatterns }
}`

// 为 standalone 生产入口注入运行时 COMPRESS 与 IMAGE_OPTIMIZE_HOSTS 环境变量支持
const serverJsCandidates = [
  join(root, '.next/standalone/server.js'),
  join(root, '.next/standalone/web/server.js'),
]
for (const serverJsPath of serverJsCandidates) {
  if (!existsSync(serverJsPath))
    continue
  let content = readFileSync(serverJsPath, 'utf8')
  if (content.includes('imageHostsEnv'))
    continue
  if (!content.includes(STANDALONE_CONFIG_ANCHOR)) {
    console.error(`collect-sourcemaps: expected standalone config anchor in ${relative(root, serverJsPath)}`)
    process.exit(1)
  }
  const blocks = []
  if (!content.includes('compressEnv'))
    blocks.push(RUNTIME_COMPRESS_PATCH)
  blocks.push(RUNTIME_IMAGE_HOSTS_PATCH, STANDALONE_CONFIG_ANCHOR)
  content = content.replace(STANDALONE_CONFIG_ANCHOR, blocks.join('\n'))
  writeFileSync(serverJsPath, content)
  console.log(`collect-sourcemaps: enabled runtime env overrides in ${relative(root, serverJsPath)}`)
}
