import type { TocHeading } from '@/models/toc'
import { createHash } from 'node:crypto'
import { renderInlineIconsHtml } from '@/lib/inline-icon/icon'
import { applyContentAutoMatch } from './content-auto-match'
import { extractHeadings } from './heading-toc'
import { renderMathHtml } from './render-math'
import { sanitizeContentHtml } from './sanitize-html'

// 正文处理（自动匹配 → 净化 → 标题锚点与目录 → 公式 → 行内图标）需要完整解析 HTML，开销较大
// 结果只取决于原始内容（与已安装的图标库），按内容哈希缓存，内容变化后自然失效
const MAX_ENTRIES = 200
const renderCache = new Map<string, { html: string, headings: TocHeading[] }>()

export async function renderContentHtml(raw: string): Promise<{ html: string, headings: TocHeading[] }> {
  const key = createHash('sha1').update(raw).digest('hex')
  const cached = renderCache.get(key)
  if (cached) {
    // 重新插入以维持最近使用顺序
    renderCache.delete(key)
    renderCache.set(key, cached)
    return cached
  }
  // 先自动匹配再净化，防止正文中的脚本 / 事件处理器造成存储型 XSS；净化后再为标题注入锚点并提取目录，
  // 再渲染公式（KaTeX 的输出不经过净化，也不影响标题文字），最后按图标名填入图标的 SVG（同样不经过净化，来自图标库本身）
  const { html, headings } = extractHeadings(sanitizeContentHtml(applyContentAutoMatch(raw)))
  const result = { html: await renderInlineIconsHtml(renderMathHtml(html)), headings }
  renderCache.set(key, result)
  if (renderCache.size > MAX_ENTRIES)
    renderCache.delete(renderCache.keys().next().value!)
  return result
}
