import type { DOMOutputSpec } from '@tiptap/pm/model'
import { z } from 'zod'
import { stripInlineMarkdown } from '@/utils/common/inline-markdown'
import { isSafeHref } from './safe-url'

const FORMATTING_TAGS = new Set([
  'a',
  'b',
  'blockquote',
  'br',
  'code',
  'del',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'input',
  'kbd',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  's',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
])

const STRIKETHROUGH_RE = /~~([^~\n]+)~~/g

function isAsciiAlphaNum(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

/**
 * 线性扫描剥离已知 HTML 排版标签（支持引号属性内含 `>` 的情况，如 `data-annotation="a > b"`），
 * 同时保留普通比较表达式（如 `a < b`）。
 */
function stripFormattingHtmlTags(input: string): string {
  let out = ''
  let i = 0
  while (i < input.length) {
    if (input[i] !== '<') {
      out += input[i]
      i++
      continue
    }

    let cursor = i + 1
    let isClosing = false
    if (input[cursor] === '/') {
      isClosing = true
      cursor++
    }

    const nameStart = cursor
    while (cursor < input.length && isAsciiAlphaNum(input.charCodeAt(cursor)))
      cursor++

    const tagName = input.slice(nameStart, cursor).toLowerCase()
    const boundary = input[cursor]
    const validBoundary = boundary === '>' || boundary === '/' || boundary === ' ' || boundary === '\t' || boundary === '\n' || boundary === '\r'
    if (!tagName || !FORMATTING_TAGS.has(tagName) || !validBoundary) {
      out += input[i]
      i++
      continue
    }

    let quote = ''
    let end = -1
    for (let j = cursor; j < input.length; j++) {
      const ch = input[j]!
      if (quote) {
        if (ch === quote)
          quote = ''
      }
      else if (ch === '"' || ch === '\'') {
        quote = ch
      }
      else if (ch === '>') {
        end = j
        break
      }
    }

    if (end === -1) {
      out += input[i]
      i++
      continue
    }

    if (tagName === 'br' && !isClosing)
      out += '\n'
    i = end + 1
  }
  return out
}

// 剥离行首 Markdown 块级前缀（引用 `>`、标题 `#`、无序/有序/任务列表），零正则回溯
function stripBlockPrefix(rawLine: string): string {
  let line = rawLine.trimStart()
  while (line.startsWith('>')) {
    line = line.slice(1).trimStart()
  }

  let hashes = 0
  while (hashes < 6 && line[hashes] === '#')
    hashes++
  if (hashes > 0 && (line[hashes] === ' ' || line[hashes] === '\t'))
    return line.slice(hashes + 1).trimStart()

  if ((line[0] === '-' || line[0] === '*' || line[0] === '+') && (line[1] === ' ' || line[1] === '\t')) {
    let rest = line.slice(2).trimStart()
    if (rest[0] === '[' && (rest[1] === ' ' || rest[1] === 'x' || rest[1] === 'X') && rest[2] === ']' && (rest[3] === ' ' || rest[3] === '\t'))
      rest = rest.slice(4).trimStart()
    return rest
  }

  let digits = 0
  while (digits < line.length && line.charCodeAt(digits) >= 48 && line.charCodeAt(digits) <= 57)
    digits++
  if (digits > 0 && line[digits] === '.' && (line[digits + 1] === ' ' || line[digits + 1] === '\t'))
    return line.slice(digits + 2).trimStart()

  return line
}

function stripProseChunkToParagraphs(chunk: string): DOMOutputSpec[] {
  const codeSlots: string[] = []
  let masked = ''
  let i = 0
  while (i < chunk.length) {
    if (chunk[i] === '`') {
      const close = chunk.indexOf('`', i + 1)
      if (close > i + 1 && !chunk.slice(i + 1, close).includes('\n')) {
        const idx = codeSlots.length
        codeSlots.push(chunk.slice(i + 1, close))
        masked += `\uE000${idx}\uE001`
        i = close + 1
        continue
      }
    }
    masked += chunk[i]
    i++
  }

  const withoutTags = stripFormattingHtmlTags(masked)
  return withoutTags
    .split(/\n+/)
    .map((rawLine) => {
      const cleaned = stripInlineMarkdown(stripBlockPrefix(rawLine).replace(STRIKETHROUGH_RE, '$1'))
      return cleaned.replace(/\uE000(\d+)\uE001/g, (_, idx) => codeSlots[Number(idx)] ?? '').trim()
    })
    .filter(Boolean)
    .map(line => ['p', {}, line] as DOMOutputSpec)
}

/**
 * 多行文本的静态 / RSS 降级内容：
 * - 围栏代码块保留为 `<pre><code>` 原始代码，避免误删代码内的标签或 `#` 注释
 * - 普通段落保护行内反引号代码后剥离常见 Markdown 标记与平台行内 HTML 标签噪音
 */
export function textParagraphs(text: string): DOMOutputSpec[] {
  if (!text)
    return []

  const specs: DOMOutputSpec[] = []
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let proseBuf: string[] = []
  let codeBuf: string[] = []
  let inFence = false

  const flushProse = () => {
    if (proseBuf.length === 0)
      return
    specs.push(...stripProseChunkToParagraphs(proseBuf.join('\n')))
    proseBuf = []
  }

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      if (!inFence) {
        flushProse()
        inFence = true
        codeBuf = []
      }
      else {
        const code = codeBuf.join('\n').trim()
        if (code)
          specs.push(['pre', {}, ['code', {}, code]])
        inFence = false
        codeBuf = []
      }
      continue
    }
    if (inFence)
      codeBuf.push(line)
    else
      proseBuf.push(line)
  }

  if (inFence && codeBuf.length > 0) {
    const code = codeBuf.join('\n').trim()
    if (code)
      specs.push(['pre', {}, ['code', {}, code]])
  }
  flushProse()

  return specs
}

/** 外链降级内容的属性：新窗口打开时补全 rel */
export function linkAttrs(href: string, newTab = true): Record<string, string> {
  return newTab ? { href, target: '_blank', rel: 'noopener noreferrer' } : { href }
}

/** 链接地址：只允许 http(s) 绝对地址（allowRelative 时还允许站内路径），避免 javascript: 等协议 */
export function hrefSchema({ allowRelative = false } = {}) {
  return z.string().trim().max(2000).refine(value => isSafeHref(value, allowRelative))
}
