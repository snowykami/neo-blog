import type { TocHeading } from '@/models/toc'
import { createHash } from 'node:crypto'
import * as cheerio from 'cheerio'
import { renderInlineIconsHtml } from '@/lib/inline-icon/icon'
import { applyContentAutoMatch } from './content-auto-match'
import { extractHeadings } from './heading-toc'
import { renderCodeBlocks } from './render-code'
import { renderMathHtml } from './render-math'
import { sanitizeContentHtml } from './sanitize-html'

// 正文处理（自动匹配 → 净化 → 标题锚点与目录 → 图片懒加载属性 → 代码块包装与着色 → 公式 → 行内图标）需要完整解析 HTML，开销较大
// 结果只取决于原始内容与已安装的图标库；复制按钮文案在出缓存后按页面语言替换并转义，避免多语言重复缓存同一篇正文
const MAX_ENTRIES = 200
const BASE_COPY_LABEL_TOKEN = '__NEO_BLOG_CODE_COPY_LABEL__'

interface CachedRenderResult {
  html: string
  copyToken: string
  headings: TocHeading[]
}

const renderCache = new Map<string, CachedRenderResult>()

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 选一个在当前正文与可能展开的代码块/公式中都不出现的安全占位符 */
function pickCopyToken(html: string): string {
  let token = BASE_COPY_LABEL_TOKEN
  while (html.includes(token))
    token += '_'
  return token
}

/** 为正文内联 <img> 补充懒加载与异步解码属性（已有对应属性时保持原值） */
function enhanceContentImages(html: string): string {
  if (!html || !html.includes('<img'))
    return html
  const $ = cheerio.load(html, null, false)
  let changed = false
  $('img').each((_, el) => {
    const $img = $(el)
    if (!$img.attr('loading')) {
      $img.attr('loading', 'lazy')
      changed = true
    }
    if (!$img.attr('decoding')) {
      $img.attr('decoding', 'async')
      changed = true
    }
  })
  return changed ? $.html() : html
}

function applyCopyLabel(entry: CachedRenderResult, copyLabel: string): { html: string, headings: TocHeading[] } {
  return {
    html: entry.copyToken ? entry.html.replaceAll(entry.copyToken, escapeHtml(copyLabel)) : entry.html,
    headings: entry.headings,
  }
}

/** copyLabel：代码块复制按钮的文字（CodeBlock.copy，随页面语言） */
export async function renderContentHtml(raw: string, { copyLabel = '' }: { copyLabel?: string } = {}): Promise<{ html: string, headings: TocHeading[] }> {
  const key = createHash('sha1').update(raw).digest('hex')
  const cached = renderCache.get(key)
  if (cached) {
    // 重新插入以维持最近使用顺序
    renderCache.delete(key)
    renderCache.set(key, cached)
    return applyCopyLabel(cached, copyLabel)
  }
  // 先自动匹配再净化，防止正文中的脚本 / 事件处理器造成存储型 XSS；净化后再为标题注入锚点并提取目录、为图片补全懒加载属性，
  // 再包装代码块并着色（highlight.js 的输出由代码文本转义生成，不经过净化），再渲染公式（KaTeX 的输出不经过净化，也不影响标题文字），
  // 最后按图标名填入图标的 SVG（同样不经过净化，来自图标库本身）
  const { html: headedHtml, headings } = extractHeadings(sanitizeContentHtml(applyContentAutoMatch(raw)))
  const baseHtml = enhanceContentImages(headedHtml)
  const copyToken = baseHtml.includes('<pre') ? pickCopyToken(baseHtml) : ''
  const renderedHtml = await renderInlineIconsHtml(
    renderMathHtml(copyToken ? renderCodeBlocks(baseHtml, copyToken) : baseHtml),
  )
  const entry: CachedRenderResult = { html: renderedHtml, copyToken, headings }
  renderCache.set(key, entry)
  if (renderCache.size > MAX_ENTRIES)
    renderCache.delete(renderCache.keys().next().value!)
  return applyCopyLabel(entry, copyLabel)
}
