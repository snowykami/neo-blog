import type { Node as PMNode, ResolvedPos, Schema } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { AIWriteMode, AIWriteScope } from '@/models/ai-write'
import { Fragment, DOMParser as PMDOMParser, Slice } from '@tiptap/pm/model'
import { NodeSelection } from '@tiptap/pm/state'
import { Transform } from '@tiptap/pm/transform'
import { getHTMLFromFragment } from '@tiptap/react'
import { Marked } from 'marked'

/**
 * AI 写作的文档操作：
 * - 计算生成内容的目标位置（插入点 / 选区）
 * - 生成带位置标记的正文 HTML，作为模型的上下文
 * - 把模型输出的 Markdown 转为编辑器内容，按“粘贴”的语义写入目标位置
 * - 用最小差异把编辑器文档同步为预览文档
 */

// 与后端 ai_write_prompt.go 中的标记一致
export const AI_INSERT_MARKER = '[[INSERT_HERE]]'
export const AI_SELECTION_START = '[[SELECTION_START]]'
export const AI_SELECTION_END = '[[SELECTION_END]]'

export interface AITarget {
  mode: AIWriteMode
  scope: AIWriteScope
  // 在生成前文档中的范围：帮写时 from === to
  from: number
  to: number
}

const LIST_ITEMS = ['listItem', 'taskItem']

/** 段落开头 / 结尾的块边界；列表项中的段落取整个列表项的边界，生成的列表项与原列表并列 */
function blockBoundary($pos: ResolvedPos, side: 'before' | 'after') {
  let depth = $pos.depth
  if (depth > 1 && LIST_ITEMS.includes($pos.node(depth - 1).type.name) && $pos.node(depth - 1).firstChild === $pos.parent)
    depth -= 1
  return side === 'before' ? $pos.before(depth) : $pos.after(depth)
}

/**
 * 计算生成内容的目标位置
 * - 润色：需要非空的文字选区；同一段落内的部分文字为 inline，代码块内为 code，其余为 block
 * - 帮写：插入到光标处（有选区或选中节点时插到其后）；非空段落的开头 / 结尾作为独立的块插入，段落中间为 inline
 */
export function resolveAITarget(state: EditorState, mode: AIWriteMode): AITarget | null {
  const { selection, doc } = state
  if (mode === 'rewrite') {
    if (selection.empty || selection instanceof NodeSelection)
      return null
    const { from, to, $from, $to } = selection
    if (!doc.textBetween(from, to, '\n', ' ').trim())
      return null
    let scope: AIWriteScope = 'block'
    if ($from.sameParent($to) && $from.parent.isTextblock) {
      if ($from.parent.type.spec.code)
        scope = 'code'
      else if ($from.parentOffset > 0 || $to.parentOffset < $to.parent.content.size)
        scope = 'inline'
    }
    return { mode, scope, from, to }
  }

  const pos = selection.to
  const $pos = doc.resolve(pos)
  const parent = $pos.parent
  if (!parent.inlineContent || parent.content.size === 0)
    return { mode, scope: 'block', from: pos, to: pos }
  if (parent.type.spec.code)
    return { mode, scope: 'code', from: pos, to: pos }
  if ($pos.parentOffset === parent.content.size) {
    const after = blockBoundary($pos, 'after')
    return { mode, scope: 'block', from: after, to: after }
  }
  if ($pos.parentOffset === 0) {
    const before = blockBoundary($pos, 'before')
    return { mode, scope: 'block', from: before, to: before }
  }
  return { mode, scope: 'inline', from: pos, to: pos }
}

/** 在位置处插入标记文本；位置不在文字中（块与块之间）时包成单独的段落 */
function insertMarker(tr: Transform, schema: Schema, pos: number, marker: string) {
  if (tr.doc.resolve(pos).parent.inlineContent)
    tr.insert(pos, schema.text(marker))
  else
    tr.insert(pos, schema.nodes.paragraph.create(null, schema.text(marker)))
}

/** 生成带插入点 / 选区标记的正文 HTML（不修改编辑器文档） */
export function buildMarkedDocument(doc: PMNode, schema: Schema, target: AITarget): string {
  const tr = new Transform(doc)
  if (target.mode === 'rewrite') {
    // 先插入结尾标记，开头位置不受影响
    insertMarker(tr, schema, target.to, AI_SELECTION_END)
    insertMarker(tr, schema, target.from, AI_SELECTION_START)
  }
  else {
    insertMarker(tr, schema, target.from, AI_INSERT_MARKER)
  }
  return getHTMLFromFragment(tr.doc.content, schema)
}

const marked = new Marked({ gfm: true, breaks: false })

/** 代码块内的输出去掉模型可能加上的 ``` 包裹（包括生成中尚未闭合的情况） */
function stripCodeFence(text: string) {
  if (/^\s*`[^\n]*$/.test(text))
    return ''
  const match = /^\s*```[^\n]*\n([\s\S]*?)(?:\n```\s*)?$/.exec(text)
  return match ? match[1] : text.replace(/^\n+/, '')
}

/** marked 输出的任务列表（li > input[type=checkbox]）转为编辑器任务列表的结构 */
function normalizeTaskLists(root: HTMLElement) {
  root.querySelectorAll('ul').forEach((list) => {
    const items = [...list.children].filter(el => el.tagName === 'LI')
    const checkbox = (li: Element) => li.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]') as HTMLInputElement | null
    if (!items.length || !items.every(checkbox))
      return
    list.setAttribute('data-type', 'taskList')
    items.forEach((li) => {
      const input = checkbox(li)!
      li.setAttribute('data-type', 'taskItem')
      li.setAttribute('data-checked', String(input.checked))
      input.remove()
    })
  })
}

/** 把模型输出的 Markdown 转为可写入编辑器的内容片段（与粘贴时的解析方式相同）；transformBody 可在解析前调整 HTML */
export function markdownToSlice(schema: Schema, markdown: string, scope: AIWriteScope, transformBody?: (body: HTMLElement) => void): Slice {
  if (scope === 'code') {
    const code = stripCodeFence(markdown)
    return code ? new Slice(Fragment.from(schema.text(code)), 0, 0) : Slice.empty
  }
  // 段落中间只插入一句话，换行合并为空格，避免拆开段落
  const source = scope === 'inline' ? markdown.replace(/\s*\n\s*/g, ' ') : markdown
  if (!source.trim())
    return Slice.empty
  const html = marked.parse(source, { async: false })
  // DOMParser 解析出的文档是惰性的，不会执行脚本或加载资源；最终只保留编辑器 schema 认识的节点与属性
  const body = new window.DOMParser().parseFromString(html, 'text/html').body
  normalizeTaskLists(body)
  // 润色时把编号标签换回原始格式等
  transformBody?.(body)
  return PMDOMParser.fromSchema(schema).parseSlice(body)
}

export interface AIPreview {
  doc: PMNode
  // 生成内容在预览文档中的范围
  from: number
  to: number
}

/** 在生成前的文档上写入内容，得到预览文档；与粘贴相同，由 replaceRange 处理标题、列表等块的拼接 */
export function buildPreview(baseDoc: PMNode, target: AITarget, slice: Slice): AIPreview {
  const tr = new Transform(baseDoc)
  try {
    if (target.scope === 'code')
      tr.replace(target.from, target.to, slice)
    else
      tr.replaceRange(target.from, target.to, slice)
  }
  catch {
    // 极少数结构无法拼接时退回普通替换
    tr.replace(target.from, target.to, slice)
  }
  return { doc: tr.doc, from: tr.mapping.map(target.from, -1), to: tr.mapping.map(target.to, 1) }
}

/** 构建把编辑器文档同步为目标文档的事务：只替换首尾之间不同的部分，选区与装饰随之映射 */
export function syncDocTransaction(state: EditorState, target: PMNode): Transaction {
  const { doc } = state
  const tr = state.tr
  const start = doc.content.findDiffStart(target.content)
  if (start == null)
    return tr
  let { a: endA, b: endB } = doc.content.findDiffEnd(target.content)!
  // 相同的首尾部分可能重叠（如插入重复的文字），向后修正
  const overlap = start - Math.min(endA, endB)
  if (overlap > 0) {
    endA += overlap
    endB += overlap
  }
  tr.replace(start, endA, target.slice(start, endB))
  if (!tr.doc.eq(target)) {
    // 兜底：整体替换，保证与目标文档一致
    return state.tr.replaceWith(0, doc.content.size, target.content)
  }
  return tr
}
