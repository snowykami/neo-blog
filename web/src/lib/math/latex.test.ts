import { Marked } from 'marked'
import { describe, expect, it } from 'vitest'
import { extractHeadings } from '@/utils/server/heading-toc'
import { renderMathHtml } from '@/utils/server/render-math'
import { findMath, findMathAtEnd, matchBlockMath, renderLatex, renderMathInHtml } from './latex'
import { markedMath } from './marked-math'

const latexOf = (text: string) => findMath(text).map(match => match.latex)

describe('$ 分隔符', () => {
  it('识别行内 $…$ 与 $$…$$', () => {
    expect(latexOf('质能方程 $E=mc^2$ 与 $$a+b$$。')).toEqual(['E=mc^2', 'a+b'])
  })

  it('金额等普通美元符号不是公式', () => {
    expect(latexOf('票价 $5 和 $10，另付 $3.')).toEqual([])
    expect(latexOf('$5-$10')).toEqual([])
    expect(latexOf('从 $x$5 开始')).toEqual([])
    expect(latexOf('$ x$ 与 $x $')).toEqual([])
  })

  it('匹配失败的 $ 不影响后面的公式', () => {
    expect(latexOf('花了 $5 买了 $x$ 个')).toEqual(['x'])
    expect(latexOf('$$ 未闭合 $y$')).toEqual(['y'])
  })

  it('转义的 \\$ 不作为分隔符', () => {
    expect(latexOf('价格 \\$x$ 不是公式')).toEqual([])
    expect(latexOf('$\\$5$')).toEqual(['\\$5'])
  })

  it('行内公式不跨行，$$…$$ 可以跨行', () => {
    expect(latexOf('$a\nb$')).toEqual([])
    expect(latexOf('$$\na\n$$')).toEqual(['a'])
  })

  it('输入结尾的 $ 时找到刚闭合的公式', () => {
    expect(findMathAtEnd('结论是 $x^2$')?.latex).toBe('x^2')
    expect(findMathAtEnd('结论是 $x^2$ 成立')).toBeNull()
    expect(findMathAtEnd('$$x$')).toBeNull()
    expect(findMathAtEnd('$$x$$')).toMatchObject({ latex: 'x', double: true })
  })

  it('整段只有 $$…$$ 时为公式块', () => {
    expect(matchBlockMath(' $$\\frac{a}{b}$$ ')).toBe('\\frac{a}{b}')
    expect(matchBlockMath('$$a$$ 后文')).toBeNull()
    expect(matchBlockMath('$a$')).toBeNull()
  })
})

describe('用 KaTeX 渲染', () => {
  it('不允许 \\href 等命令产生链接', () => {
    // 命令被拒绝并显示为红色原文（源码只出现在 annotation 的文字中）
    const html = renderLatex('\\href{javascript:alert(1)}{x}', false)
    expect(html).not.toMatch(/<a[\s>]/)
    expect(html).not.toContain('href=')
  })

  it('语法错误时显示原文而不抛异常', () => {
    expect(renderLatex('\\frac{', false)).toContain('katex-error')
  })

  it('可以只输出 MathML', () => {
    const html = renderLatex('x^2', true, 'mathml')
    expect(html).toContain('<math')
    expect(html).not.toContain('katex-html')
  })
})

describe('ai 写作的 Markdown 中的公式', () => {
  const marked = new Marked({ gfm: true }, markedMath())

  it('单独成段的 $$ 为公式块，段落中的为行内公式', () => {
    const html = marked.parse('前文 $a<b$ 结束\n\n$$\n\\sum_i x_i\n$$\n\n票价 $5 和 $10', { async: false })
    expect(html).toContain('<span data-type="inline-math" data-latex="a&lt;b"></span>')
    expect(html).toContain('<div data-type="block-math" data-latex="\\sum_i x_i"></div>')
    expect(html).toContain('票价 $5 和 $10')
  })

  it('代码与转义中的 $ 不转换', () => {
    const html = marked.parse('`$x$` 与 \\$y$', { async: false })
    expect(html).not.toContain('data-latex')
  })
})

describe('前台渲染', () => {
  const stored = '<h2>关于 <span data-latex="x^2" data-type="inline-math"></span> 的证明</h2><div data-latex="a&lt;b" data-type="block-math"></div>'

  it('服务端渲染公式节点，目录文字使用 LaTeX 源码', () => {
    const { html, headings } = extractHeadings(stored)
    expect(headings[0].text).toBe('关于 x^2 的证明')
    const rendered = renderMathHtml(html)
    expect(rendered).toContain('class="katex"')
    expect(rendered).toContain('class="katex-display"')
    expect(rendered).toContain('data-latex="x^2"')
  })

  it('没有公式时原样返回', () => {
    const html = '<p>普通段落 $5</p>'
    expect(renderMathHtml(html)).toBe(html)
  })

  it('浏览器中渲染预览里的公式', () => {
    expect(renderMathInHtml(stored)).toContain('class="katex"')
  })
})
