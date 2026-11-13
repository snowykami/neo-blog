import type { KatexOptions } from 'katex'
import katex from 'katex'

/**
 * 数学公式（LaTeX）：编辑器、前台渲染、AI 写作共用的规则
 * - 存储格式与 @tiptap/extension-mathematics 一致：
 *   行内 <span data-type="inline-math" data-latex="…"></span>，独立成块 <div data-type="block-math" data-latex="…"></div>
 * - 书写约定与 Typora、Obsidian、GitHub 相同：行内 $…$，独立成块的公式单独一段写成 $$…$$
 */

export const INLINE_MATH_TYPE = 'inline-math'
export const BLOCK_MATH_TYPE = 'block-math'
export const MATH_SELECTOR = `[data-type="${INLINE_MATH_TYPE}"][data-latex], [data-type="${BLOCK_MATH_TYPE}"][data-latex]`

// 公式来自正文，不可信：不允许 \href、\url、\includegraphics、\htmlClass 等（trust 为 false），
// 限制尺寸与宏展开次数，语法错误时显示为红色原文而不抛异常
export const KATEX_OPTIONS: KatexOptions = {
  throwOnError: false,
  strict: 'ignore',
  trust: false,
  maxSize: 20,
  maxExpand: 500,
}

function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * 公式渲染为 HTML；output 为 mathml 时只输出 MathML（RSS 等不加载样式的场景）
 * 超出宏展开等限制时 KaTeX 仍会抛异常，此时显示原文
 */
export function renderLatex(latex: string, displayMode: boolean, output: KatexOptions['output'] = 'htmlAndMathml'): string {
  if (!latex.trim())
    return ''
  try {
    return katex.renderToString(latex, { ...KATEX_OPTIONS, displayMode, output })
  }
  catch {
    return `<code class="math-error">${escapeHtml(latex)}</code>`
  }
}

/** 浏览器中渲染容器内的公式节点 */
export function renderMathInElement(root: ParentNode) {
  root.querySelectorAll<HTMLElement>(MATH_SELECTOR).forEach((el) => {
    const latex = el.dataset.latex ?? ''
    if (!latex.trim()) {
      el.innerHTML = ''
      return
    }
    const display = el.dataset.type === BLOCK_MATH_TYPE
    el.innerHTML = renderLatex(latex, display)
  })
}

/** 浏览器中渲染 HTML 字符串里的公式节点（页面预览、版本预览等客户端生成的 HTML，需在净化之后调用） */
export function renderMathInHtml(html: string): string {
  if (!html.includes('-math"'))
    return html
  const template = document.createElement('template')
  template.innerHTML = html
  renderMathInElement(template.content)
  return template.innerHTML
}

// ---------- $ 分隔符 ----------

export interface MathMatch {
  // 在原文中的范围 [from, to)
  from: number
  to: number
  latex: string
  // $$…$$ 为 true
  double: boolean
}

const isSpace = (char: string | undefined) => char != null && /\s/.test(char)
const isDigit = (char: string | undefined) => char != null && char >= '0' && char <= '9'

/**
 * 从 index 处的 $ 开始匹配一个公式（参照 pandoc 的 tex_math_dollars）：
 * - $$…$$：内容不含 $、不为空白，可以跨行
 * - $…$：内容不含 $、不跨行；开头的 $ 后面、结尾的 $ 前面不能是空白，结尾的 $ 后面不能紧跟数字，
 *   所以「$5 和 $10」这类金额不会被识别为公式
 * - 反斜杠转义的 \$ 不作为分隔符（属于公式内容时原样保留）
 */
export function matchMathAt(text: string, index: number): MathMatch | null {
  if (text[index] !== '$')
    return null
  const double = text[index + 1] === '$'
  const start = index + (double ? 2 : 1)
  if (!double && (start >= text.length || isSpace(text[start])))
    return null
  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (char === '\\') {
      i++
      continue
    }
    if (!double && char === '\n')
      return null
    if (char !== '$')
      continue
    const latex = text.slice(start, i)
    if (double) {
      if (text[i + 1] !== '$' || !latex.trim())
        return null
      return { from: index, to: i + 2, latex: latex.trim(), double }
    }
    if (isSpace(text[i - 1]) || isDigit(text[i + 1]) || text[i + 1] === '$')
      return null
    return { from: index, to: i + 1, latex, double }
  }
  return null
}

/** 找出一段文字中的全部公式（互不重叠，按出现顺序）；匹配失败的 $ 按普通文字处理，从下一个 $ 继续 */
export function findMath(text: string): MathMatch[] {
  const result: MathMatch[] = []
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '\\') {
      i++
      continue
    }
    if (char !== '$')
      continue
    const match = matchMathAt(text, i)
    if (match) {
      result.push(match)
      i = match.to - 1
    }
    else if (text[i + 1] === '$') {
      // 未闭合的 $$ 整体按文字处理，避免其中的第二个 $ 被当成行内公式的开头
      i++
    }
  }
  return result
}

/** 以 text 末尾结束的公式（输入结尾的 $ 时触发转换） */
export function findMathAtEnd(text: string): MathMatch | null {
  const last = findMath(text).at(-1)
  return last && last.to === text.length ? last : null
}

/**
 * 文字末尾是否处在尚未闭合的公式中（已有开头的 $$，或后面紧跟非空白的 $）
 * 用于输入公式时暂停排版替换（^2 → ²、-> → → 等），否则 LaTeX 会被改坏
 */
export function isInOpenMath(text: string): boolean {
  let rest = ''
  let last = 0
  for (const match of findMath(text)) {
    rest += text.slice(last, match.from)
    last = match.to
  }
  rest += text.slice(last)
  for (let i = rest.length - 1; i >= 0; i--) {
    if (rest[i] === '\n')
      return false
    if (rest[i] !== '$' || rest[i - 1] === '\\')
      continue
    return rest[i - 1] === '$' || i + 1 >= rest.length || !isSpace(rest[i + 1])
  }
  return false
}

/** 整段文字只有一个 $$…$$ 时返回其内容（这样的段落转为独立成块的公式） */
export function matchBlockMath(text: string): string | null {
  const trimmed = text.trim()
  const match = matchMathAt(trimmed, 0)
  return match?.double && match.to === trimmed.length ? match.latex : null
}
