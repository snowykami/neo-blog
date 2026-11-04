import type { KatexOptions } from 'katex'
import * as cheerio from 'cheerio'
import { BLOCK_MATH_TYPE, MATH_SELECTOR, renderLatex } from '@/lib/math/latex'

/**
 * 渲染正文中的公式节点（服务端），在净化之后调用：
 * - 编辑器只保存 data-latex，这里把 KaTeX 的输出填进节点；KaTeX 输出的 MathML 会被净化删掉，所以先净化再渲染
 * - 公式内容由 KaTeX 转义，且不允许 \href 等可产生链接或任意属性的命令（见 KATEX_OPTIONS）
 * - output 为 mathml 时只输出 MathML（RSS 阅读器不加载 KaTeX 样式）
 */
export function renderMathHtml(html: string, output?: KatexOptions['output']): string {
  // 没有公式节点时跳过解析
  if (!html || !html.includes('-math"'))
    return html
  const $ = cheerio.load(html, null, false)
  const nodes = $(MATH_SELECTOR)
  if (nodes.length === 0)
    return html
  nodes.each((_, el) => {
    const $el = $(el)
    $el.html(renderLatex($el.attr('data-latex') ?? '', $el.attr('data-type') === BLOCK_MATH_TYPE, output))
  })
  return $.html()
}
