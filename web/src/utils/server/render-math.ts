import type { KatexOptions } from 'katex'
import * as cheerio from 'cheerio'
import { BLOCK_MATH_TYPE, MATH_SELECTOR, renderLatex } from '@/lib/math/latex'

/**
 * 渲染正文中的公式节点（服务端），在净化之后调用：
 * - 编辑器只保存 data-latex，这里把 KaTeX 的输出填进节点；KaTeX 输出的 MathML 会被净化删掉，所以先净化再渲染
 * - 公式内容由 KaTeX 转义，且不允许 \href 等可产生链接或任意属性的命令（见 KATEX_OPTIONS）
 * - 默认只输出 HTML、不输出 MathML：正文 HTML 每次客户端跳转都要完整进入 RSC，MathML 约占公式 gzip 体积的三成，
 *   而页面显示只用到 HTML 部分（KaTeX 的 HTML 本身对读屏软件隐藏）。读屏改由外层节点 role="math" + aria-label（LaTeX 源码）提供；
 *   KaTeX 的 MathML 在 Chrome 里不支持 \mathbb、\mathbf 等字体变体，所以不反过来只输出 MathML
 * - output 为 mathml 时只输出 MathML（RSS 阅读器不加载 KaTeX 样式）
 */
export function renderMathHtml(html: string, output: KatexOptions['output'] = 'html'): string {
  // 没有公式节点时跳过解析
  if (!html || !html.includes('-math"'))
    return html
  const $ = cheerio.load(html, null, false)
  const nodes = $(MATH_SELECTOR)
  if (nodes.length === 0)
    return html
  nodes.each((_, el) => {
    const $el = $(el)
    const latex = $el.attr('data-latex') ?? ''
    $el.html(renderLatex(latex, $el.attr('data-type') === BLOCK_MATH_TYPE, output))
    if (output === 'html')
      $el.attr({ 'role': 'math', 'aria-label': latex })
  })
  return $.html()
}
