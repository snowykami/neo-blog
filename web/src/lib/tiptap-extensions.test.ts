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
