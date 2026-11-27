import type { TocHeading } from '@/models/toc'
import { createHash } from 'node:crypto'
import * as cheerio from 'cheerio'
import { COMPONENT_ROOT_SELECTOR } from '@/components/content-components/constants'
import { renderInlineIconsHtml } from '@/lib/inline-icon/icon'
import { applyContentAutoMatch } from './content-auto-match'
import { extractHeadingsFromRoot } from './heading-toc'
import { renderCodeBlocks } from './render-code'
import { renderMathHtml } from './render-math'
import { sanitizeContentHtml } from './sanitize-html'

// 正文处理（自动匹配 → 净化 → 标题锚点与目录 → 图片懒加载属性 → 代码块包装与着色 → 公式 → 行内图标）需要完整解析 HTML，开销较大
// 结果只取决于原始内容与已安装的图标库；复制按钮文案在出缓存后按页面语言替换并转义，避免多语言重复缓存同一篇正文
const MAX_ENTRIES = 200
const BASE_COPY_LABEL_TOKEN = '__NEO_BLOG_CODE_COPY_LABEL__'
const SKIP_IMAGE_ANCESTOR_SELECTOR = `pre, code, ${COMPONENT_ROOT_SELECTOR}`

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

/**
 * 单遍 Cheerio AST 遍历同时完成标题锚点目录提取（复用 heading-toc 同源实现）与正文 <img> 懒加载属性补齐，
 * 避免对大篇幅 HTML 重复执行两次完整解析与序列化
 */
function prepareHeadingsAndImages(html: string): { html: string, headings: TocHeading[] } {
  if (!html)
    return { html, headings: [] }
  const hasHeadingCandidate = /<h[1-4]\b/i.test(html)
  const hasImageCandidate = /<img\b/i.test(html)
  if (!hasHeadingCandidate && !hasImageCandidate)
    return { html, headings: [] }

  const $ = cheerio.load(html, null, false)
  let changed = false
  let headings: TocHeading[] = []

  if (hasHeadingCandidate) {
    const extracted = extractHeadingsFromRoot($)
    headings = extracted.headings
    if (extracted.mutated)
      changed = true
  }

  if (hasImageCandidate) {
    $('img').each((_, el) => {
      const $img = $(el)
      if ($img.closest(SKIP_IMAGE_ANCESTOR_SELECTOR).length > 0)
        return
      if ($img.attr('alt') === undefined) {
        $img.attr('alt', '')
        changed = true
      }
      if (!$img.attr('loading')) {
        $img.attr('loading', 'lazy')
        changed = true
      }
      if (!$img.attr('decoding')) {
        $img.attr('decoding', 'async')
        changed = true
      }
    })
  }

  return { html: changed ? $.html() : html, headings }
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
  // 先自动匹配再净化，防止正文中的脚本 / 事件处理器造成存储型 XSS；净化后再单遍完成标题目录与图片属性补齐，
  // 接着做代码块、公式与行内图标展开（它们由可信模板构造）
  const matched = applyContentAutoMatch(raw)
  const safe = sanitizeContentHtml(matched)
  const copyToken = pickCopyToken(safe)
  const { html: withHeadingsAndImages, headings } = prepareHeadingsAndImages(safe)
  const withCode = renderCodeBlocks(withHeadingsAndImages, copyToken)
  const withMath = renderMathHtml(withCode)
  const html = await renderInlineIconsHtml(withMath)
  const entry: CachedRenderResult = {
    html,
    copyToken: html.includes(copyToken) ? copyToken : '',
    headings,
  }
  renderCache.set(key, entry)
  if (renderCache.size > MAX_ENTRIES) {
    const oldest = renderCache.keys().next().value
    if (oldest !== undefined)
      renderCache.delete(oldest)
  }
  return applyCopyLabel(entry, copyLabel)
}
