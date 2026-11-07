import type { Node as PMNode } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/react'
import { NodeSelection } from '@tiptap/pm/state'
import { Editor as EditorClass } from '@tiptap/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { serializeRewriteSelection } from '@/components/tiptap-editor/ai-rewrite-markup'
import { markdownToSlice } from '@/components/tiptap-editor/ai-write-utils'
import { createContentExtensions } from '@/lib/tiptap-extensions'
import { INLINE_ICON_NODE } from './inline-icon-extension'

let editor: Editor | null = null
const onEditIcon = vi.fn()

function createEditor(content: string) {
  editor = new EditorClass({
    extensions: createContentExtensions({ upload: async () => '', placeholder: () => '', getSlashItems: () => [], onEditIcon }),
    content,
  })
  return editor
}

function icons(doc: PMNode) {
  const found: { name: string, marks: string[], pos: number }[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === INLINE_ICON_NODE)
      found.push({ name: node.attrs.name, marks: node.marks.map(mark => mark.type.name), pos })
  })
  return found
}

afterEach(() => {
  editor?.destroy()
  editor = null
  onEditIcon.mockReset()
})

describe('行内图标的存储格式', () => {
  it('只保存图标名，往返不变', () => {
    const html = '<p>前<span data-icon="star"></span>后</p>'
    const e = createEditor(html)
    expect(icons(e.state.doc)).toEqual([{ name: 'star', marks: [], pos: 2 }])
    expect(e.getHTML()).toBe(html)
  })

  it('文字颜色、加粗、高亮、链接包在图标外层', () => {
    const html = '<h2><span style="color: var(--color-green-500);"><span data-icon="leaf"></span> 绿色</span></h2>'
      + '<p><strong><span data-icon="star"></span></strong><mark data-color="var(--color-yellow-200)" style="background-color: var(--color-yellow-200); color: inherit;"><span data-icon="sun"></span></mark>'
      + '<a target="_blank" rel="noopener noreferrer nofollow" href="https://example.com"><span data-icon="link"></span></a></p>'
    const e = createEditor(html)
    expect(icons(e.state.doc).map(icon => [icon.name, icon.marks])).toEqual([['leaf', ['textStyle']], ['star', ['bold']], ['sun', ['highlight']], ['link', ['link']]])
    expect(e.getHTML()).toBe(html)
  })

  it('粘贴前台渲染后的图标（里面是 SVG）只保留图标名', () => {
    const e = createEditor('<p>x<span data-icon="star"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0"></path></svg></span>y</p>')
    expect(e.getHTML()).toBe('<p>x<span data-icon="star"></span>y</p>')
  })

  it('带文字或名字不合法的同名属性按普通文字处理', () => {
    const e = createEditor('<p><span data-icon="star">⭐</span><span data-icon="&#xe600;">字</span></p>')
    expect(icons(e.state.doc)).toEqual([])
    expect(e.state.doc.textContent).toBe('⭐字')
  })

  it('纯文本中图标不占字', () => {
    const e = createEditor('<p>a<span data-icon="star"></span>b</p>')
    expect(e.getText()).toBe('ab')
  })
})

describe('插入与更换', () => {
  it('插入的图标继承光标处的文字格式', () => {
    const e = createEditor('<p><strong>ab</strong></p>')
    e.commands.setTextSelection(2)
    expect(e.commands.insertInlineIcon('star')).toBe(true)
    expect(icons(e.state.doc)).toEqual([{ name: 'star', marks: ['bold'], pos: 2 }])
    expect(e.getHTML()).toBe('<p><strong>a<span data-icon="star"></span>b</strong></p>')
  })

  it('代码块中不能插入，图标名不合法时不插入', () => {
    const e = createEditor('<pre><code>code</code></pre><p>text</p>')
    e.commands.setTextSelection(2)
    expect(e.can().insertInlineIcon('star')).toBe(false)
    e.commands.setTextSelection(8)
    expect(e.can().insertInlineIcon('star')).toBe(true)
    expect(e.can().insertInlineIcon('Not Valid')).toBe(false)
  })

  it('更换图标名，保留外层格式', () => {
    const e = createEditor('<p><strong><span data-icon="star"></span></strong></p>')
    expect(e.commands.setInlineIcon(1, 'heart')).toBe(true)
    expect(e.getHTML()).toBe('<p><strong><span data-icon="heart"></span></strong></p>')
    expect(e.commands.setInlineIcon(0, 'heart')).toBe(false)
  })

  it('选中图标后按 Enter 打开选择器', () => {
    const e = createEditor('<p>a<span data-icon="star"></span>b</p>')
    e.view.dispatch(e.state.tr.setSelection(NodeSelection.create(e.state.doc, 2)))
    const handled = e.view.someProp('handleKeyDown', f => f(e.view, new KeyboardEvent('keydown', { key: 'Enter' })))
    expect(handled).toBe(true)
    expect(onEditIcon).toHaveBeenCalledWith(2)
  })
})

describe('aI 写作', () => {
  it('生成内容中的图标标签解析为图标', () => {
    const e = createEditor('<p></p>')
    const slice = markdownToSlice(e.schema, '完成 <span data-icon="circle-check"></span> 啦', 'block')
    expect(icons(slice.content.child(0)).map(icon => icon.name)).toEqual(['circle-check'])
  })

  it('润色时图标作为占位符原样保留', () => {
    const e = createEditor('<p>a<span data-icon="star"></span>b</p>')
    const { markup, keeps } = serializeRewriteSelection(e.state.doc, e.schema, 1, 4)
    expect(markup).toBe('a[[KEEP_1]]b')
    expect(keeps.map(node => node.attrs.name)).toEqual(['star'])
  })
})
