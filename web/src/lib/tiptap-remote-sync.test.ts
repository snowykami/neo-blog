import type { Node as PMNode } from '@tiptap/pm/model'
import { createDocument, Editor } from '@tiptap/react'
import { afterEach, describe, expect, it } from 'vitest'
import { REMOTE_SYNC_META, remoteChangePluginKey } from '@/components/tiptap-extension/remote-change-extension'
import { createContentExtensions } from './tiptap-extensions'
import { diffBlocks, mergeRemoteContent } from './tiptap-remote-sync'

const editors: Editor[] = []

/** 与编辑页一样载入内容：setContent 且不进入撤销历史（TrailingNode 等插件会在这时补出结构） */
function loadEditor(html: string) {
  const editor = new Editor({
    extensions: createContentExtensions({ upload: async () => '', placeholder: () => '', getSlashItems: () => [] }),
    content: '<p></p>',
  })
  editor.chain().setMeta('addToHistory', false).setContent(html, { emitUpdate: false }).run()
  editors.push(editor)
  return editor
}

afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy())
})

function parse(editor: Editor, html: string): PMNode {
  return createDocument(html, editor.schema)
}

/** 编辑页载入这段 HTML 后的文档 JSON；每个编辑器有自己的 schema，跨编辑器只能比较 JSON */
function loaded(html: string) {
  return loadEditor(html).state.doc.toJSON()
}

/** 各顶层块的文字（去掉末尾补出的空段落） */
function texts(editor: Editor) {
  const all = editor.state.doc.content.content.map(node => node.textContent)
  return all.at(-1) === '' ? all.slice(0, -1) : all
}

function highlighted(editor: Editor) {
  return remoteChangePluginKey.getState(editor.state)!.find().map(d => editor.state.doc.nodeAt(d.from)?.textContent)
}

/** 在第 index 个顶层块的末尾输入文字（本地修改，进入撤销历史） */
function typeAtEndOf(editor: Editor, index: number, text: string) {
  let pos = 0
  for (let i = 0; i <= index; i++)
    pos += editor.state.doc.child(i).nodeSize
  editor.commands.insertContentAt(pos - 1, text)
}

describe('diffBlocks', () => {
  it('只报告变化的块，相同的首尾与中间块不算变化', () => {
    const editor = loadEditor('<p>a</p>')
    const oldDoc = parse(editor, '<h2>t</h2><p>a</p><p>b</p><p>c</p><p>d</p><p>e</p>')
    const newDoc = parse(editor, '<h2>t</h2><p>a2</p><p>b</p><p>c</p><p>new</p><p>d</p>')
    expect(diffBlocks(oldDoc, newDoc)).toEqual([
      { oldFrom: 1, oldTo: 2, newFrom: 1, newTo: 2 }, // a → a2
      { oldFrom: 4, oldTo: 4, newFrom: 4, newTo: 5 }, // 插入 new
      { oldFrom: 5, oldTo: 6, newFrom: 6, newTo: 6 }, // 删除 e
    ])
  })

  it('末尾补出的空段落不算变化', () => {
    const editor = loadEditor('<blockquote><p>q</p></blockquote>')
    expect(editor.state.doc.lastChild?.type.name).toBe('paragraph')
    expect(diffBlocks(editor.state.doc, parse(editor, '<blockquote><p>q</p></blockquote>'))).toEqual([])
  })
})

describe('mergeRemoteContent', () => {
  it('本地没有修改：只替换远端改动的块并高亮，结果与远端一致，不进入撤销历史', () => {
    const editor = loadEditor('<h2>标题</h2><p>第一段</p><p>第二段</p><p>第三段</p>')
    const base = editor.state.doc
    const untouched = editor.view.nodeDOM(base.child(0).nodeSize)
    const metas: unknown[] = []
    editor.on('update', ({ transaction }) => metas.push(transaction.getMeta(REMOTE_SYNC_META)))

    const remote = '<h2>标题</h2><p>第一段</p><p>第二段（AI 改写）</p><p>第三段</p><p>新的一段</p>'
    const result = mergeRemoteContent(editor, base, remote)

    expect(editor.state.doc.toJSON()).toEqual(loaded(remote))
    expect(result).toMatchObject({ conflicts: 0, localChanged: false })
    expect(metas).toEqual([true])
    expect(highlighted(editor)).toEqual(['第二段（AI 改写）', '新的一段'])
    expect(editor.view.nodeDOM(editor.state.doc.child(0).nodeSize)).toBe(untouched)
    expect(editor.can().undo()).toBe(false)
  })

  it('双方改了不同的块：都保留；撤销只撤销本地的修改', () => {
    const editor = loadEditor('<p>A</p><p>B</p><p>C</p>')
    const base = editor.state.doc
    typeAtEndOf(editor, 0, '（我）')

    const result = mergeRemoteContent(editor, base, '<p>A</p><p>B（AI）</p><p>C</p>')
    expect(result).toMatchObject({ conflicts: 0, localChanged: true })
    expect(texts(editor)).toEqual(['A（我）', 'B（AI）', 'C'])
    expect(highlighted(editor)).toEqual(['B（AI）'])

    editor.commands.undo()
    expect(texts(editor)).toEqual(['A', 'B（AI）', 'C'])
  })

  it('双方改了同一块：保留本地版本，记为冲突，其余远端修改照常合并', () => {
    const editor = loadEditor('<p>A</p><p>B</p><p>C</p>')
    const base = editor.state.doc
    typeAtEndOf(editor, 1, '（我）')

    const result = mergeRemoteContent(editor, base, '<p>A</p><p>B（AI）</p><p>C</p><p>D</p>')
    expect(result.conflicts).toBe(1)
    expect(texts(editor)).toEqual(['A', 'B（我）', 'C', 'D'])
    expect(highlighted(editor)).toEqual(['D'])
  })

  it('远端删除了本地正在改的块：保留本地', () => {
    const editor = loadEditor('<p>A</p><p>B</p><p>C</p>')
    const base = editor.state.doc
    typeAtEndOf(editor, 1, '（我）')
    const result = mergeRemoteContent(editor, base, '<p>A</p><p>C</p>')
    expect(result.conflicts).toBe(1)
    expect(texts(editor)).toEqual(['A', 'B（我）', 'C'])
  })

  it('远端在末尾追加、本地正在改最后一段：追加在本地这段之后', () => {
    const editor = loadEditor('<p>A</p><p>B</p>')
    const base = editor.state.doc
    typeAtEndOf(editor, 1, '（我）')
    const result = mergeRemoteContent(editor, base, '<p>A</p><p>B</p><p>AI 追加</p>')
    expect(result.conflicts).toBe(0)
    expect(texts(editor)).toEqual(['A', 'B（我）', 'AI 追加'])
  })

  it('远端正文不变（只改了元信息）：不产生事务', () => {
    const editor = loadEditor('<p>a</p><p>b</p>')
    let updates = 0
    editor.on('update', () => updates++)
    expect(mergeRemoteContent(editor, editor.state.doc, '<p>a</p><p>b</p>')).toMatchObject({ ranges: [], conflicts: 0, localChanged: false })
    expect(updates).toBe(0)
  })

  it('整篇换成完全不同的内容（末尾不是段落时由 TrailingNode 补出空段落，与正常载入一致）', () => {
    const editor = loadEditor('<p>a</p><p>b</p>')
    const remote = '<h1>x</h1><blockquote><p>y</p></blockquote>'
    const { remoteDoc } = mergeRemoteContent(editor, editor.state.doc, remote)
    expect(editor.state.doc.toJSON()).toEqual(loaded(remote))
    // 以远端为新的基线再次合并同样的内容：没有变化
    expect(mergeRemoteContent(editor, remoteDoc, remote).ranges).toEqual([])
  })
})
