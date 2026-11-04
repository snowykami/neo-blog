import type { Editor } from '@tiptap/react'
import { Editor as EditorClass } from '@tiptap/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createContentExtensions } from '@/lib/tiptap-extensions'

let editor: Editor | null = null
const onEditMath = vi.fn()

function createEditor(content: string) {
  editor = new EditorClass({
    extensions: createContentExtensions({ upload: async () => '', placeholder: () => '', getSlashItems: () => [], onEditMath }),
    content,
  })
  return editor
}

/** 模拟在光标处逐字输入（触发输入规则） */
function type(target: Editor, text: string) {
  for (const char of text) {
    const { from, to } = target.state.selection
    const handled = target.view.someProp('handleTextInput', f => f(target.view, from, to, char, () => target.state.tr.insertText(char, from, to)))
    if (!handled)
      target.view.dispatch(target.state.tr.insertText(char, from, to))
  }
}

function pressEnter(target: Editor) {
  const event = new KeyboardEvent('keydown', { key: 'Enter' })
  return target.view.someProp('handleKeyDown', f => f(target.view, event))
}

afterEach(() => {
  editor?.destroy()
  editor = null
  onEditMath.mockReset()
})

describe('公式的输入', () => {
  it('输入 $…$ 转为行内公式', () => {
    const target = createEditor('<p></p>')
    type(target, '质能方程 $E=mc^2$ 成立')
    expect(target.getHTML()).toBe('<p>质能方程 <span data-latex="E=mc^2" data-type="inline-math"></span> 成立</p>')
  })

  it('输入公式时不做排版替换，公式之外照常替换', () => {
    const target = createEditor('<p></p>')
    type(target, '$a->b^2$ 与 -> ')
    expect(target.getHTML()).toBe('<p><span data-latex="a->b^2" data-type="inline-math"></span> 与 → </p>')
  })

  it('金额不会被转为公式', () => {
    const target = createEditor('<p></p>')
    type(target, '票价 $5 和 $10')
    expect(target.getHTML()).toBe('<p>票价 $5 和 $10</p>')
  })

  it('整段输入 $$…$$ 转为公式块，段落中间的为行内公式', () => {
    const target = createEditor('<p></p>')
    type(target, '$$x^2$$')
    expect(target.getHTML()).toContain('<div data-latex="x^2" data-type="block-math"></div>')

    const inline = createEditor('<p>前文</p>')
    inline.commands.setTextSelection(inline.state.doc.content.size - 1)
    type(inline, ' $$y$$')
    expect(inline.getHTML()).toBe('<p>前文 <span data-latex="y" data-type="inline-math"></span></p>')
  })

  it('段落中只有 $$ 时按 Enter 转为空公式块并打开编辑', async () => {
    const target = createEditor('<p>$$</p>')
    target.commands.setTextSelection(3)
    expect(pressEnter(target)).toBe(true)
    expect(target.getHTML()).toContain('<div data-latex="" data-type="block-math"></div>')
    await new Promise(resolve => window.requestAnimationFrame(resolve))
    expect(onEditMath).toHaveBeenCalledWith(0)
  })

  it('行内公式以选中的文字为内容', () => {
    const target = createEditor('<p>令 a^2 为平方</p>')
    target.commands.setTextSelection({ from: 3, to: 6 })
    target.commands.insertMath({ display: false })
    expect(target.getHTML()).toBe('<p>令 <span data-latex="a^2" data-type="inline-math"></span> 为平方</p>')
  })

  it('空段落插入公式块时直接替换该段落', () => {
    const target = createEditor('<p>前文</p><p></p>')
    target.commands.setTextSelection(5)
    target.commands.insertMath({ display: true })
    expect(target.getHTML()).toBe('<p>前文</p><div data-latex="" data-type="block-math"></div><p></p>')
  })
})

describe('公式的粘贴', () => {
  it('纯文本中的 $…$ 与 $$ 包起来的多行转为公式', () => {
    const target = createEditor('<p></p>')
    target.view.pasteText('勾股定理 $a^2+b^2=c^2$，票价 $5\n\n$$\n\\sum_i x_i\n= 1\n$$\n\n`$x$` 不变')
    const html = target.getHTML()
    expect(html).toContain('<span data-latex="a^2+b^2=c^2" data-type="inline-math"></span>，票价 $5')
    expect(html).toContain('<div data-latex="\\sum_i x_i\n= 1" data-type="block-math"></div>')
  })

  it('复制自 KaTeX 页面的公式还原为 LaTeX', () => {
    const target = createEditor('<p></p>')
    target.view.pasteHTML(
      '<p>能量 <span class="katex"><span class="katex-mathml"><math><semantics><mi>E</mi><annotation encoding="application/x-tex">E=mc^2</annotation></semantics></math></span><span class="katex-html">E=mc2</span></span></p>'
      + '<p><span class="katex-display"><span class="katex"><span class="katex-mathml"><math display="block"><semantics><mi>x</mi><annotation encoding="application/x-tex">\\int_0^1 x</annotation></semantics></math></span></span></span></p>',
    )
    const html = target.getHTML()
    expect(html).toContain('<span data-latex="E=mc^2" data-type="inline-math"></span>')
    expect(html).toContain('<div data-latex="\\int_0^1 x" data-type="block-math"></div>')
  })

  it('读入已保存的公式节点', () => {
    const stored = '<p>行内 <span data-latex="x" data-type="inline-math"></span></p><div data-latex="y" data-type="block-math"></div>'
    expect(createEditor(stored).getHTML()).toBe(stored)
  })
})
