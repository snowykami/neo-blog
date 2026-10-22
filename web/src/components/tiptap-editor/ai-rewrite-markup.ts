import type { Fragment as PMFragment, Node as PMNode, Schema } from '@tiptap/pm/model'
import { DOMSerializer, Fragment, Slice } from '@tiptap/pm/model'

/**
 * AI 润色的选区表示：让模型看到并保留原有格式
 * - 块结构（段落、标题、列表、任务列表、引用、分隔线）用 Markdown 表示，模型最熟悉
 * - 行内格式全部用编辑器自身 toDOM 生成的 HTML 标签表示（<strong>、<a>、<u>、<mark>、<span style> 等）：
 *   能覆盖 Markdown 无法表达的格式，且避免 ** 在中文标点旁无法解析的问题；输出按粘贴的方式解析，格式原样还原
 * - 有对齐方式等属性的段落 / 标题整块输出为 HTML
 * - 图片、代码块、表格等不应被改写的节点替换为 [[KEEP_n]] 占位符，生成后还原为原节点
 * - 带属性的行内格式（注释、链接、颜色、高亮等）替换为 <m1>…</m1> 这类编号标签：
 *   模型润色时会把属性值的英文引号改成中文引号、甚至改写注释内容，属性一坏格式就丢；生成后再按编号换回原标签
 */

export const AI_KEEP_PATTERN = /\[\[KEEP_(\d+)\]\]/g

const keepToken = (index: number) => `[[KEEP_${index}]]`

// 序列化过程中先用私用区字符包裹占位符，避免被 Markdown 转义，最后替换为可读的占位符
const SENTINEL_OPEN = '\uE000'
const SENTINEL_CLOSE = '\uE001'
const SENTINEL_PATTERN = /\uE000(\d+)\uE001/g

// 用 Markdown 列表表示的块
const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList'])
const LIST_ITEM_TYPES = new Set(['listItem', 'taskItem'])

export interface RewriteSelection {
  markup: string
  keeps: PMNode[]
  // 编号标签对应的原始开始标签（不含内容），下标 n - 1 对应 <mn>
  marks: string[]
}

const MARK_TOKEN_TAG = /^M(\d+)$/

/** 行内文字中的 Markdown 特殊字符加反斜杠转义（< 与 & 已由 HTML 序列化转为实体） */
function escapeMarkdownText(text: string) {
  return text.replace(/[\\`*_[\]~|]/g, '\\$&')
}

/** 行首可能被识别为块语法的字符（标题、引用、列表、分隔线）需要转义 */
function escapeLineStart(line: string) {
  return line
    .replace(/^(\s*)([#>+=-])/, '$1\\$2')
    .replace(/^(\s*\d+)([.)])/, '$1\\$2')
}

class RewriteSerializer {
  keeps: PMNode[] = []
  marks: string[] = []
  private dom: DOMSerializer

  constructor(private schema: Schema) {
    this.dom = DOMSerializer.fromSchema(schema)
  }

  private keep(node: PMNode) {
    this.keeps.push(node)
    return `${SENTINEL_OPEN}${this.keeps.length}${SENTINEL_CLOSE}`
  }

  /** 带属性的元素换成编号标签 <mn>，相同的标签与属性复用同一编号 */
  private tokenizeAttributes(elements: Iterable<Element>) {
    for (const el of elements) {
      if (el.attributes.length === 0 || el.tagName === 'BR')
        continue
      const shell = (el.cloneNode(false) as Element).outerHTML
      let index = this.marks.indexOf(shell)
      if (index < 0)
        index = this.marks.push(shell) - 1
      const token = document.createElement(`m${index + 1}`)
      token.append(...el.childNodes)
      el.replaceWith(token)
    }
  }

  /** 行内内容转为 HTML；markdown 为 true 时文字中的 Markdown 特殊字符会被转义 */
  inline(content: PMFragment, markdown: boolean) {
    const nodes: PMNode[] = []
    content.forEach((child) => {
      // 文字与换行以外的行内节点（如行内图片）用占位符代替，保留原有格式标记
      if (child.isText || child.type.name === 'hardBreak')
        nodes.push(child)
      else
        nodes.push(this.schema.text(this.keep(child), child.marks))
    })
    const container = document.createElement('div')
    container.appendChild(this.dom.serializeFragment(Fragment.fromArray(nodes), { document }))
    this.tokenizeAttributes([...container.querySelectorAll('*')])
    if (markdown) {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
      for (let text = walker.nextNode(); text; text = walker.nextNode())
        text.nodeValue = escapeMarkdownText(text.nodeValue ?? '')
    }
    // 换行统一为 <br>，避免与 Markdown 的段落换行混淆
    return container.innerHTML.replace(/\n/g, '<br>')
  }

  /** 有非默认属性（如对齐方式）的文本块整块输出为 HTML，保证属性原样还原 */
  private hasBlockAttrs(node: PMNode) {
    const align = node.attrs.textAlign
    return align != null && align !== '' && align !== 'left'
  }

  private htmlBlock(node: PMNode) {
    const container = document.createElement('div')
    container.appendChild(this.dom.serializeNode(node, { document }))
    // 块本身的属性（对齐方式）保留在标签上，内部带属性的行内格式换成编号标签
    this.tokenizeAttributes([...(container.firstElementChild?.querySelectorAll('*') ?? [])])
    return container.innerHTML.replace(/\n/g, '<br>')
  }

  /** 一个块转为若干行 Markdown */
  block(node: PMNode): string {
    const name = node.type.name
    if (name === 'paragraph') {
      if (node.content.size === 0 || this.hasBlockAttrs(node))
        return this.htmlBlock(node)
      return escapeLineStart(this.inline(node.content, true))
    }
    if (name === 'heading') {
      if (this.hasBlockAttrs(node))
        return this.htmlBlock(node)
      return `${'#'.repeat(node.attrs.level ?? 2)} ${this.inline(node.content, true)}`
    }
    if (name === 'blockquote')
      return this.blocks(node.content).split('\n').map(line => (line ? `> ${line}` : '>')).join('\n')
    if (name === 'horizontalRule')
      return '---'
    if (LIST_TYPES.has(name))
      return this.list(node)
    // 代码块、表格、图片等：不改写，原样保留
    return this.keep(node)
  }

  private list(node: PMNode) {
    const lines: string[] = []
    let index = node.type.name === 'orderedList' ? Number(node.attrs.start ?? 1) : 0
    node.forEach((item) => {
      let marker = '- '
      if (node.type.name === 'orderedList')
        marker = `${index++}. `
      else if (node.type.name === 'taskList')
        marker = `- [${item.attrs.checked ? 'x' : ' '}] `
      if (!LIST_ITEM_TYPES.has(item.type.name)) {
        lines.push(marker + this.block(item))
        return
      }
      const indent = ' '.repeat(marker.length)
      // 列表项内的多个块以空行分隔，避免后一个块被 Markdown 的懒惰续行并入前一段（编辑器不区分紧凑 / 松散列表）
      const body = this.blocks(item.content).split('\n')
      lines.push(marker + (body[0] ?? ''))
      for (const line of body.slice(1))
        lines.push(line ? indent + line : '')
    })
    return lines.join('\n')
  }

  /** 多个块以空行分隔 */
  blocks(content: PMFragment) {
    const parts: string[] = []
    content.forEach(child => parts.push(this.block(child)))
    return parts.join('\n\n')
  }

  finish(text: string) {
    return text.replace(SENTINEL_PATTERN, (_, n) => keepToken(Number(n)))
  }
}

/**
 * 把润色选区序列化为模型可读、可原样还原的标记文本
 * doc.slice 以选区两端的最深公共父节点为根：选中整段时内容是该段的行内节点，跨多个列表项时内容是列表项，
 * 因此按切片内容的实际类型序列化，而不是只看 scope
 */
export function serializeRewriteSelection(doc: PMNode, schema: Schema, from: number, to: number): RewriteSelection {
  const serializer = new RewriteSerializer(schema)
  const slice = doc.slice(from, to)
  const content = slice.content
  const first = content.firstChild
  let markup: string
  if (!first) {
    markup = ''
  }
  else if (first.isInline) {
    // 同一文本块内的选区（部分或整段）：只输出行内内容
    markup = serializer.inline(content, true)
  }
  else if (LIST_ITEM_TYPES.has(first.type.name)) {
    // 跨多个列表项：按所在列表的类型包回列表，序号从选区第一项开始
    const $from = doc.resolve(from)
    const depth = $from.sharedDepth(to)
    const list = $from.node(depth)
    const attrs = list.type.name === 'orderedList'
      ? { ...list.attrs, start: Number(list.attrs.start ?? 1) + $from.index(depth) }
      : list.attrs
    markup = serializer.block(list.type.create(attrs, content))
  }
  else {
    markup = serializer.blocks(content)
  }
  return { markup: serializer.finish(markup), keeps: serializer.keeps, marks: serializer.marks }
}

/** 把模型输出里的编号标签 <mn> 换回原始标签（带原属性）；未知编号只保留内容 */
export function restoreMarkTokens(body: HTMLElement, marks: string[]) {
  for (const el of [...body.querySelectorAll('*')]) {
    const match = MARK_TOKEN_TAG.exec(el.tagName)
    if (!match)
      continue
    const shell = marks[Number(match[1]) - 1]
    const template = document.createElement('template')
    template.innerHTML = shell ?? ''
    const original = template.content.firstElementChild
    if (original) {
      original.append(...el.childNodes)
      el.replaceWith(original)
    }
    else {
      el.replaceWith(...el.childNodes)
    }
  }
}

/** 模型偶尔把 HTML 标签里的英文引号改成中文 / 全角引号，解析前在标签内部改回，避免属性被截断 */
export function repairTagQuotes(markup: string) {
  return markup.replace(/<\/?[A-Z][^<>]*>/gi, tag => tag.replace(/[“”„＂]/g, '"').replace(/[‘’]/g, '\''))
}

interface RestoreState {
  keeps: PMNode[]
  used: Set<number>
}

/** 文本中的占位符：行内节点就地还原；块节点从文本中移除，交给外层放到所在块之后 */
function restoreText(node: PMNode, schema: Schema, state: RestoreState, trailing: PMNode[]): PMNode[] {
  const text = node.text ?? ''
  const result: PMNode[] = []
  let last = 0
  for (const match of text.matchAll(AI_KEEP_PATTERN)) {
    const index = Number(match[1]) - 1
    const keep = state.keeps[index]
    if (match.index > last)
      result.push(schema.text(text.slice(last, match.index), node.marks))
    last = match.index + match[0].length
    if (!keep || state.used.has(index))
      continue
    state.used.add(index)
    if (keep.isInline)
      result.push(keep)
    else
      trailing.push(keep)
  }
  if (last === 0)
    return [node]
  if (last < text.length)
    result.push(schema.text(text.slice(last), node.marks))
  return result
}

/** 只含一个占位符的段落：返回对应的块节点 */
function standaloneKeep(node: PMNode, state: RestoreState) {
  if (!node.isTextblock)
    return null
  const match = /^\s*\[\[KEEP_(\d+)\]\]\s*$/.exec(node.textContent)
  if (!match)
    return null
  const index = Number(match[1]) - 1
  const keep = state.keeps[index]
  if (!keep || keep.isInline || state.used.has(index))
    return null
  state.used.add(index)
  return keep
}

function restoreFragment(fragment: PMFragment, schema: Schema, state: RestoreState): PMNode[] {
  const result: PMNode[] = []
  fragment.forEach((node) => {
    const keep = standaloneKeep(node, state)
    if (keep) {
      result.push(keep)
      return
    }
    if (node.isText) {
      // 文本节点中的块占位符交给所在的文本块处理
      result.push(...restoreText(node, schema, state, []))
      return
    }
    const trailing: PMNode[] = []
    let children: PMNode[] = []
    if (node.isTextblock) {
      node.content.forEach((child) => {
        children.push(...(child.isText ? restoreText(child, schema, state, trailing) : [child]))
      })
    }
    else {
      children = restoreFragment(node.content, schema, state)
    }
    const content = Fragment.fromArray(children)
    // 只含无效 / 重复占位符的段落，去掉占位符后为空，整段丢弃
    if (node.isTextblock && content.size === 0 && node.content.size > 0) {
      result.push(...trailing)
      return
    }
    result.push(node.type.validContent(content) ? node.copy(content) : node)
    result.push(...trailing)
  })
  return result
}

/**
 * 把模型输出中的占位符还原为原节点
 * final 为 true（生成结束）时，模型遗漏的占位符对应的节点追加到末尾，保证图片等内容不会丢失
 */
export function restoreRewriteKeeps(slice: Slice, keeps: PMNode[], schema: Schema, final: boolean): Slice {
  if (!keeps.length)
    return slice
  const state: RestoreState = { keeps, used: new Set() }
  const nodes = restoreFragment(slice.content, schema, state)
  let openEnd = slice.openEnd
  if (final) {
    keeps.forEach((keep, index) => {
      if (state.used.has(index))
        return
      const last = nodes.at(-1)
      if (keep.isInline && last?.isTextblock) {
        nodes[nodes.length - 1] = last.copy(last.content.append(Fragment.from(keep)))
      }
      else if (!keep.isInline) {
        nodes.push(keep)
        openEnd = 0
      }
    })
  }
  return new Slice(Fragment.fromArray(nodes), slice.openStart, Math.min(openEnd, slice.openEnd))
}
