import type { ReactNode } from 'react'

/*
 * 极简、安全的行内 Markdown 解析：仅支持 **粗体**、*斜体*、`行内代码`、[链接](url) 与换行
 * 其余内容一律按纯文本输出（由 React 负责转义），不支持原始 HTML，也不使用 dangerouslySetInnerHTML
 * 解析结果为纯数据结构，可序列化后传给客户端组件，并支持按字符数截断渲染（用于打字机效果）
 */

export type InlineNode
  = | { type: 'text', value: string }
    | { type: 'code', value: string }
    | { type: 'br' }
    | { type: 'strong', children: InlineNode[] }
    | { type: 'em', children: InlineNode[] }
    | { type: 'link', href: string, children: InlineNode[] }

// 链接只允许 http / https，避免 javascript: 等协议
const SAFE_URL = /^https?:\/\/[^\s<>"']+$/i
const ESCAPABLE = '\\`*_[]()#+-.!'

function isSpace(ch: string | undefined) {
  return ch === undefined || /\s/.test(ch)
}

interface ParseResult {
  nodes: InlineNode[]
  end: number // 停止位置（闭合标记处或字符串末尾）
  closed: boolean
}

// closer 为当前期望的闭合标记：'**'、'*'、']'，顶层为空
function parse(src: string, start: number, closer: string): ParseResult {
  const nodes: InlineNode[] = []
  let text = ''
  const flush = () => {
    if (text) {
      nodes.push({ type: 'text', value: text })
      text = ''
    }
  }
  let i = start
  while (i < src.length) {
    const ch = src[i]
    // 闭合标记：强调类要求前一个字符不是空白
    if (closer && src.startsWith(closer, i)) {
      const isEmphasis = closer !== ']'
      // 单星号闭合时，若紧跟着另一个星号视为粗体开始而非闭合
      const isDoubleInSingle = closer === '*' && src[i + 1] === '*'
      if (!isDoubleInSingle && (!isEmphasis || !isSpace(src[i - 1]))) {
        flush()
        return { nodes, end: i, closed: true }
      }
    }
    if (ch === '\\' && i + 1 < src.length && ESCAPABLE.includes(src[i + 1])) {
      text += src[i + 1]
      i += 2
      continue
    }
    if (ch === '\r') {
      i++
      continue
    }
    if (ch === '\n') {
      flush()
      nodes.push({ type: 'br' })
      i++
      continue
    }
    if (ch === '`') {
      const close = src.indexOf('`', i + 1)
      if (close > i + 1) {
        flush()
        nodes.push({ type: 'code', value: src.slice(i + 1, close) })
        i = close + 1
        continue
      }
    }
    if (ch === '*') {
      const marker = src[i + 1] === '*' ? '**' : '*'
      // 开始标记后必须紧跟非空白字符，避免把 “2 * 3” 识别为斜体
      if (!isSpace(src[i + marker.length])) {
        const inner = parse(src, i + marker.length, marker)
        if (inner.closed && inner.nodes.length > 0) {
          flush()
          nodes.push(marker === '**' ? { type: 'strong', children: inner.nodes } : { type: 'em', children: inner.nodes })
          i = inner.end + marker.length
          continue
        }
      }
      text += marker
      i += marker.length
      continue
    }
    if (ch === '[' && closer !== ']') {
      const inner = parse(src, i + 1, ']')
      const after = inner.end + 1
      if (inner.closed && src[after] === '(') {
        const close = src.indexOf(')', after + 1)
        if (close > after) {
          const href = src.slice(after + 1, close).trim()
          flush()
          if (SAFE_URL.test(href))
            nodes.push({ type: 'link', href, children: inner.nodes.length > 0 ? inner.nodes : [{ type: 'text', value: href }] })
          else
            nodes.push(...inner.nodes) // 不安全的链接只保留文字
          i = close + 1
          continue
        }
      }
    }
    text += ch
    i++
  }
  flush()
  return { nodes, end: i, closed: false }
}

export function parseInlineMarkdown(src: string): InlineNode[] {
  return parse(src ?? '', 0, '').nodes
}

// 可见字符数（换行计 1），用于打字机进度
export function inlineTextLength(nodes: InlineNode[]): number {
  let count = 0
  for (const node of nodes) {
    if (node.type === 'text' || node.type === 'code')
      count += Array.from(node.value).length
    else if (node.type === 'br')
      count += 1
    else
      count += inlineTextLength(node.children)
  }
  return count
}

// 纯文本形式（如用于 aria-label、meta 描述）
export function inlineToPlainText(nodes: InlineNode[]): string {
  return nodes.map((node) => {
    if (node.type === 'text' || node.type === 'code')
      return node.value
    if (node.type === 'br')
      return '\n'
    return inlineToPlainText(node.children)
  }).join('')
}

/**
 * 渲染为 React 节点；limit 为最多显示的字符数（不传则完整渲染）
 * 按 Unicode 码点截断，避免把 emoji 等代理对切成乱码
 */
export function renderInlineMarkdown(nodes: InlineNode[], limit = Number.POSITIVE_INFINITY): ReactNode[] {
  let remaining = limit
  const walk = (list: InlineNode[], keyPrefix: string): ReactNode[] => {
    const out: ReactNode[] = []
    for (let index = 0; index < list.length && remaining > 0; index++) {
      const node = list[index]
      const key = `${keyPrefix}${index}`
      if (node.type === 'text' || node.type === 'code') {
        const chars = Array.from(node.value)
        const visible = chars.length <= remaining ? node.value : chars.slice(0, remaining).join('')
        remaining -= Math.min(chars.length, remaining)
        out.push(node.type === 'code'
          ? <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{visible}</code>
          : visible)
      }
      else if (node.type === 'br') {
        remaining -= 1
        out.push(<br key={key} />)
      }
      else if (node.type === 'strong') {
        out.push(<strong key={key} className="font-semibold">{walk(node.children, `${key}-`)}</strong>)
      }
      else if (node.type === 'em') {
        out.push(<em key={key}>{walk(node.children, `${key}-`)}</em>)
      }
      else {
        out.push(
          <a key={key} href={node.href} target="_blank" rel="noopener noreferrer nofollow" className="text-primary underline underline-offset-2">
            {walk(node.children, `${key}-`)}
          </a>,
        )
      }
    }
    return out
  }
  return walk(nodes, '')
}

// 去掉行内 Markdown 标记，得到纯文本（用于列表摘要、meta 描述等不渲染格式的场景）
export function stripInlineMarkdown(src: string): string {
  return inlineToPlainText(parseInlineMarkdown(src))
}
