import { Editor } from '@tiptap/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createContentExtensions } from '@/lib/tiptap-extensions'

const editors: Editor[] = []

function load(html: string) {
  const editor = new Editor({
    extensions: createContentExtensions({ upload: async () => '', placeholder: () => '', getSlashItems: () => [] }),
    content: html,
  })
  editors.push(editor)
  return editor
}

afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy())
})

describe('hdr-text-extension', () => {
  it('旧内容的 data-hdr="" 载入后为默认档位，已有档位原样保留', () => {
    expect(load('<p><span data-hdr="">a</span></p>').getHTML()).toBe('<p><span data-hdr="2">a</span></p>')
    expect(load('<p><span data-hdr="5">a</span></p>').getHTML()).toBe('<p><span data-hdr="5">a</span></p>')
  })

  it('切换档位替换原有档位，0 档移除标记', () => {
    const editor = load('<p><span data-hdr="2">abc</span></p>')
    editor.chain().setTextSelection({ from: 1, to: 4 }).setMark('hdr', { level: 4 }).run()
    expect(editor.getHTML()).toBe('<p><span data-hdr="4">abc</span></p>')
    expect(editor.getAttributes('hdr').level).toBe(4)
    editor.chain().unsetMark('hdr').run()
    expect(editor.getHTML()).toBe('<p>abc</p>')
  })

  it('可与文字颜色叠加', () => {
    const editor = load('<p>abc</p>')
    editor.chain().setTextSelection({ from: 1, to: 4 }).setColor('red').setMark('hdr', { level: 3 }).run()
    const html = editor.getHTML()
    expect(html).toContain('data-hdr="3"')
    expect(html).toContain('color: red')
  })
})
