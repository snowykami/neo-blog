/**
 * 生成文章正文按需加载的自托管网页字体：把 npm 字体包（已按 unicode-range 分片）里的 woff2 复制到
 * public/fonts/<字体>/<版本>/，并为每个字体写一份只含 woff2 的 public/fonts/<字体>.css。
 * 文章页只为用到的字体插入对应的 <link>（见 src/lib/content-theme.ts），浏览器再只下载正文里出现的字所在的分片。
 * 输出目录不提交到仓库（.gitignore），dev / build 前自动运行；字体包与本脚本都没有变化时跳过。
 *
 * 用法：node scripts/gen-webfonts.mjs
 */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = join(root, 'public/fonts')
const stampFile = join(outputDir, '.stamp')

/**
 * 字体键 → 字体包与其中的 CSS（一个字重一份）。字体键与 src/lib/content-theme.ts 的 WebFont 一致；
 * 中文字体每个字重约 100 个分片，CSS 约 30 KB（gzip），所以只引入必要的字重，加粗等交给浏览器合成
 */
export const WEBFONTS = {
  'noto-serif-sc': { pkg: '@fontsource/noto-serif-sc', css: ['400.css'] },
  'lxgw-wenkai': { pkg: 'lxgw-wenkai-screen-webfont', css: ['lxgwwenkaigbscreen.css'] },
  'zhi-mang-xing': { pkg: '@fontsource/zhi-mang-xing', css: ['400.css'] },
  'zcool-xiaowei': { pkg: '@fontsource/zcool-xiaowei', css: ['400.css'] },
  'zcool-kuaile': { pkg: '@fontsource/zcool-kuaile', css: ['400.css'] },
  'dancing-script': { pkg: '@fontsource/dancing-script', css: ['400.css'] },
}

/**
 * 只给歌词舞台用的额外字重与 Safari 兜底字库：
 * - 正文的宋体只带 400（加粗由浏览器合成），而歌词按 700 排版，单列一份 700 的 CSS；
 * - Safari 因防指纹沙盒屏蔽 macOS 本机 AssetsV2 目录下的楷体/圆体/仿宋/行楷，专供 Safari 按需加载同风格高字重分片字库
 */
export const LYRIC_FONTS = {
  'noto-serif-sc-bold': { pkg: '@fontsource/noto-serif-sc', css: ['700.css'] },
  'lxgw-wenkai-bold': { pkg: 'lxgw-wenkai-webfont', css: ['lxgwwenkai-bold.css'] },
  '975-maru-sc-bold': { pkg: 'cn-fontsource-975-maru-sc-bold', css: ['font.css'], srcDir: '.', weight: 700 },
  'zhuque-fangsong': { pkg: '@free-fonts/zhuque-fangsong', css: ['zhuque-fangsong.css'], srcDir: 'fonts' },
  'ma-shan-zheng': { pkg: '@fontsource/ma-shan-zheng', css: ['400.css'], weight: 700 },
  'dancing-script-bold': { pkg: '@fontsource/dancing-script', css: ['700.css'] },
}

const ALL_FONTS = { ...WEBFONTS, ...LYRIC_FONTS }

const FONT_FACE = /@font-face\s*\{[^}]*\}/g
const WOFF2_URL = /url\((['"]?)(?:\.\/)?(?:[\w-]+\/)?([\w.-]+\.woff2)\1\)/

/** 改写一份字体包 CSS：src 只保留 woff2 并指向 public 下的副本；返回改写后的 CSS 与引用到的文件 */
export function rewriteFontCss(css, baseUrl, options = {}) {
  const files = []
  const faces = (css.match(FONT_FACE) ?? []).map((face) => {
    const woff2 = face.match(WOFF2_URL)
    if (!woff2)
      return ''
    files.push(woff2[2])
    let next = face.replace(/src:[^;}]*;?/, `src: url(${baseUrl}/${woff2[2]}) format('woff2');`)
    if (/font-display:[^;}]*;?/.test(next))
      next = next.replace(/font-display:[^;}]*;?/, 'font-display: swap;')
    else
      next = next.replace(/\}$/, 'font-display: swap;}')
    if (options.weight != null) {
      if (/font-weight:[^;}]*;?/.test(next))
        next = next.replace(/font-weight:[^;}]*;?/, `font-weight: ${options.weight};`)
      else
        next = next.replace(/\}$/, `font-weight: ${options.weight};}`)
    }
    return next
  })
  return { css: faces.filter(Boolean).join('\n'), files }
}

function packageDir(pkg) {
  return join(root, 'node_modules', pkg)
}

function packageVersion(pkg) {
  return JSON.parse(readFileSync(join(packageDir(pkg), 'package.json'), 'utf8')).version
}

function stamp() {
  const hash = createHash('sha1').update(readFileSync(fileURLToPath(import.meta.url)))
  for (const { pkg } of Object.values(ALL_FONTS))
    hash.update(`${pkg}@${packageVersion(pkg)}`)
  return hash.digest('hex')
}

function generate() {
  rmSync(outputDir, { recursive: true, force: true })
  let fileCount = 0
  for (const [key, { pkg, css, srcDir = 'files', weight }] of Object.entries(ALL_FONTS)) {
    const version = packageVersion(pkg)
    const baseUrl = `/fonts/${key}/${version}`
    const fileDir = join(outputDir, key, version)
    mkdirSync(fileDir, { recursive: true })
    const parts = css.map((name) => {
      const result = rewriteFontCss(readFileSync(join(packageDir(pkg), name), 'utf8'), baseUrl, { weight })
      for (const file of result.files)
        copyFileSync(join(packageDir(pkg), srcDir, file), join(fileDir, file))
      fileCount += result.files.length
      return result.css
    })
    writeFileSync(join(outputDir, `${key}.css`), `/* ${pkg}@${version}，由 scripts/gen-webfonts.mjs 生成 */\n${parts.join('\n')}\n`)
  }
  return fileCount
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const current = stamp()
  if (existsSync(stampFile) && readFileSync(stampFile, 'utf8') === current)
    process.exit(0)
  const fileCount = generate()
  writeFileSync(stampFile, current)
  console.log(`webfonts: ${Object.keys(ALL_FONTS).length} fonts, ${fileCount} files`)
}
