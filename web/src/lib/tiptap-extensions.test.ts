import type { Editor } from '@tiptap/react'
import { Editor as EditorClass } from '@tiptap/react'
import { describe, expect, it } from 'vitest'
import { createContentExtensions } from './tiptap-extensions'

function createEditor() {
  const editor = new EditorClass({
    extensions: createContentExtensions({
      upload: async () => '',
      placeholder: () => '',
      getSlashItems: () => [],
    }),
    content: '<p>hello world</p>',
  })
  editor.commands.setTextSelection({ from: 1, to: 6 })
  return editor
}

/** 文档里出现的标记名（按字母排序，便于断言） */
function marksInDoc(editor: Editor) {
  const marks = new Set<string>()
  editor.state.doc.nodesBetween(0, editor.state.doc.content.size, (node) => {
    node.marks.forEach(mark => marks.add(mark.type.name))
  })
  return [...marks].sort()
}

describe('行内代码与其他标记的互斥关系', () => {
  it('行内代码上可以叠加链接', () => {
    const editor = createEditor()
    editor.commands.setCode()
    expect(editor.can().setMark('link')).toBe(true)
    editor.commands.setMark('link', { href: 'https://example.com' })
    expect(marksInDoc(editor)).toEqual(['code', 'link'])
    editor.destroy()
  })

  it('行内代码上可以叠加注释', () => {
    const editor = createEditor()
    editor.commands.setCode()
    expect(editor.can().setMark('annotation')).toBe(true)
    editor.commands.setMark('annotation', { note: '说明' })
    expect(editor.getHTML()).toContain('data-annotation="说明"')
    expect(marksInDoc(editor)).toEqual(['annotation', 'code'])
    editor.destroy()
  })

  it('给带链接的词语加行内代码时不会清掉链接', () => {
    const editor = createEditor()
    editor.commands.setMark('link', { href: 'https://example.com' })
    editor.commands.setCode()
    expect(marksInDoc(editor)).toEqual(['code', 'link'])
    editor.destroy()
  })

  it('加粗等标记仍与行内代码互斥', () => {
    const editor = createEditor()
    editor.commands.setCode()
    expect(editor.can().toggleMark('bold')).toBe(false)
    expect(editor.can().setMark('highlight')).toBe(false)
    editor.destroy()
  })
})

describe('局部字体', () => {
  function editorWith(content: string) {
    return new EditorClass({
      extensions: createContentExtensions({ upload: async () => '', placeholder: () => '', getSlashItems: () => [] }),
      content,
    })
  }

  it('按字体键保存为 data-font，可以设置与清除', () => {
    const editor = createEditor()
    editor.commands.setContentFont('kai')
    expect(editor.getHTML()).toBe('<p><span data-font="kai">hello</span> world</p>')
    editor.commands.unsetContentFont()
    expect(editor.getHTML()).toBe('<p>hello world</p>')
    editor.destroy()
  })

  it('只认识注册表里的字体键，粘贴来的任意 font-family 不写入正文', () => {
    const editor = editorWith('<p><span data-font="xingkai">行</span><span data-font="comic">x</span><span style="font-family: Comic Sans MS">y</span></p>')
    const html = editor.getHTML()
    expect(html).toContain('<span data-font="xingkai">行</span>x')
    expect(html).not.toContain('comic')
    expect(html).not.toContain('font-family')
    editor.destroy()
  })
})
