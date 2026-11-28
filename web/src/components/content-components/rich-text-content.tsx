'use client'

import DOMPurify from 'isomorphic-dompurify'
import { Marked } from 'marked'
import { useEffect, useMemo, useRef } from 'react'
import { cn } from '@/lib/utils'
import { RICH_TEXT_CONTENT_ATTR } from './constants'
import './rich-text-content.css'

const richMarked = new Marked({
  gfm: true,
  breaks: true,
})

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'del',
  's',
  'u',
  'sup',
  'sub',
  'mark',
  'code',
  'pre',
  'a',
  'ul',
  'ol',
  'li',
  'blockquote',
  'hr',
  'span',
  'kbd',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'input',
]

const ALLOWED_ATTR = [
  'href',
  'target',
  'rel',
  'class',
  'style',
  'data-annotation',
  'data-icon',
  'data-color',
  'type',
  'checked',
  'disabled',
  'start',
]

// 仅允许安全颜色变量（如 var(--color-red-500)、var(--color-yellow-200)）或标准十六进制颜色值，阻断 url() / 任意属性注入
const SAFE_COLOR_VALUE_RE = /^(?:var\(--color-[a-z]+-(?:50|100|200|300|400|500|600|700|800|900|950)\)|var\(--(?:primary|foreground|muted-foreground|destructive)\)|#[0-9a-f]{3,8})$/i
const SAFE_CODE_LANG_CLASS_RE = /^language-[\w-]+$/
const SAFE_ICON_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const EXTERNAL_HTTP_RE = /^https?:\/\//i
const MAILTO_RE = /^mailto:[^\s<>"']+$/i

let richHookInstalled = false
let sanitizingRichText = false

function isInternalRelativeHref(href: string): boolean {
  if (href.startsWith('#'))
    return href.length > 1
  return href.startsWith('/') && !href.startsWith('//') && !href.startsWith('/\\')
}

function hasUnsafeHrefChar(href: string): boolean {
  for (let i = 0; i < href.length; i++) {
    const code = href.charCodeAt(i)
    if (code <= 0x20 || code === 0x7F || (code >= 0x80 && /\s/.test(href[i]!)))
      return true
  }
  return false
}

// 线性解析单条 color 样式声明，避免多项式正则回溯并拒绝多属性注入
function extractSafeTextColor(rawStyle: string): string | null {
  let trimmed = rawStyle.trim()
  if (!trimmed)
    return null
  if (trimmed.endsWith(';'))
    trimmed = trimmed.slice(0, -1).trim()
  if (trimmed.includes(';'))
    return null
  const colonIdx = trimmed.indexOf(':')
  if (colonIdx <= 0)
    return null
  if (trimmed.slice(0, colonIdx).trim().toLowerCase() !== 'color')
    return null
  const value = trimmed.slice(colonIdx + 1).trim()
  return SAFE_COLOR_VALUE_RE.test(value) ? value : null
}

function sanitizeClassList(node: Element) {
  const rawClass = node.getAttribute('class')
  if (!rawClass)
    return
  const tag = node.tagName.toUpperCase()
  const kept = rawClass.split(/\s+/).filter((cls) => {
    if (tag === 'CODE' && SAFE_CODE_LANG_CLASS_RE.test(cls))
      return true
    if (tag === 'UL' && cls === 'contains-task-list')
      return true
    if (tag === 'LI' && cls === 'task-list-item')
      return true
    return false
  })
  if (kept.length > 0)
    node.setAttribute('class', kept.join(' '))
  else
    node.removeAttribute('class')
}

function ensureRichTextHook() {
  if (richHookInstalled)
    return
  richHookInstalled = true

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    // 禁止使用 instanceof Element：isomorphic-dompurify 在 SSR / 测试中创建独立 JSDOM Realm
    if (!sanitizingRichText || !node || node.nodeType !== 1)
      return

    const el = node as Element
    const tag = el.tagName.toUpperCase()

    // 任务列表仅保留禁用的复选框，移除其余任何类型的 input
    if (tag === 'INPUT') {
      if (el.getAttribute('type')?.toLowerCase() !== 'checkbox') {
        el.remove()
        return
      }
      el.setAttribute('type', 'checkbox')
      el.setAttribute('disabled', '')
      for (const attr of Array.from(el.attributes)) {
        if (attr.name !== 'type' && attr.name !== 'checked' && attr.name !== 'disabled')
          el.removeAttribute(attr.name)
      }
      return
    }

    sanitizeClassList(el)

    // 链接协议白名单与外链属性补全
    if (tag === 'A') {
      const href = (el.getAttribute('href') ?? '').trim()
      if (!href || hasUnsafeHrefChar(href)) {
        el.removeAttribute('href')
        el.removeAttribute('target')
        el.removeAttribute('rel')
      }
      else if (isInternalRelativeHref(href)) {
        el.setAttribute('href', href)
        el.removeAttribute('target')
        el.removeAttribute('rel')
      }
      else if (EXTERNAL_HTTP_RE.test(href)) {
        el.setAttribute('href', href)
        el.setAttribute('target', '_blank')
        el.setAttribute('rel', 'noopener noreferrer')
      }
      else if (MAILTO_RE.test(href)) {
        el.setAttribute('href', href)
        el.removeAttribute('target')
        el.removeAttribute('rel')
      }
      else {
        el.removeAttribute('href')
        el.removeAttribute('target')
        el.removeAttribute('rel')
      }
    }
    else {
      el.removeAttribute('href')
      el.removeAttribute('target')
      el.removeAttribute('rel')
    }

    // 注释与行内图标属性仅允许出现在 <span> 上（键盘可聚焦属性按容器上下文在客户端挂载时注入，避免抢夺编辑器焦点）
    if (tag === 'SPAN') {
      const note = el.getAttribute('data-annotation')?.trim()
      if (note && note.length <= 500)
        el.setAttribute('data-annotation', note)
      else
        el.removeAttribute('data-annotation')

      const icon = el.getAttribute('data-icon')?.trim() ?? ''
      if (icon && SAFE_ICON_NAME_RE.test(icon) && !el.textContent)
        el.setAttribute('data-icon', icon)
      else
        el.removeAttribute('data-icon')
    }
    else {
      el.removeAttribute('data-annotation')
      el.removeAttribute('data-icon')
    }

    // 高亮颜色与行内文字颜色严格白名单过滤
    if (tag === 'MARK') {
      const dataColor = el.getAttribute('data-color')?.trim() ?? ''
      if (dataColor && SAFE_COLOR_VALUE_RE.test(dataColor)) {
        el.setAttribute('data-color', dataColor)
        el.setAttribute('style', `background-color: ${dataColor}`)
      }
      else {
        el.removeAttribute('data-color')
        el.removeAttribute('style')
      }
    }
    else if (tag === 'SPAN') {
      el.removeAttribute('data-color')
      const colorValue = extractSafeTextColor(el.getAttribute('style') ?? '')
      if (colorValue)
        el.setAttribute('style', `color: ${colorValue}`)
      else
        el.removeAttribute('style')
    }
    else {
      el.removeAttribute('data-color')
      el.removeAttribute('style')
    }
  })
}

/**
 * 将自定义组件内的 Markdown + 平台行内格式文本解析并严格净化为安全 HTML。
 * 导出纯函数便于单测直接验证解析与 XSS 防护。
 */
export function renderRichTextHtml(content: string): string {
  const trimmed = content?.trim() ?? ''
  if (!trimmed)
    return ''

  // GFM 任务列表（含紧凑与空行松散列表）由 marked 输出时给 ul/li 补上稳定类名以便无序列表去圆点对齐
  const rawHtml = richMarked.parse(trimmed, { async: false }) as string
  const markedTasks = rawHtml
    .replace(/<li>(\s*(?:<p>\s*)?<input\s[^>]*type="checkbox")/gi, '<li class="task-list-item">$1')
    .replace(/<ul>(\s*<li class="task-list-item">)/gi, '<ul class="contains-task-list">$1')

  ensureRichTextHook()
  sanitizingRichText = true
  try {
    return DOMPurify.sanitize(markedTasks, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
    })
  }
  finally {
    sanitizingRichText = false
  }
}

export interface RichTextContentProps {
  content: string
  className?: string
}

/**
 * 自定义组件共享轻量富文本渲染器：
 * - 支持常见 Markdown（链接、粗体/斜体/删除线、行内代码与代码块、列表、引用、`breaks: true` 换行）
 * - 支持博客平台行内格式（`<span data-annotation>`、`<span data-icon>`、`<mark data-color>`、`<u>`、`<sup>`、`<sub>`、安全色板 `<span style="color: ...">`）
 * - 仅由 `dynamic(() => import(...))` 拆包的自定义组件视图按需引入，不影响首页首屏体积
 */
export function RichTextContent({ content, className }: RichTextContentProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const html = useMemo(() => renderRichTextHtml(content), [content])

  useEffect(() => {
    const root = rootRef.current
    if (!root || !html)
      return

    // 按挂载容器区分注释交互语义：
    // - 正文阅读容器（已挂载 ContentHoverCard）：补齐键盘可聚焦与 ARIA 展开态（覆盖懒加载、折叠块展开与标签页切换时机）
    // - 编辑器节点预览、属性弹窗或侧边栏：仅补充原生 title 悬停提示，不加 tabindex/role 避免抢夺编辑器光标焦点或空转按钮
    const inInteractiveContent = Boolean(root.closest('#blog-content, #page-content'))
    root.querySelectorAll<HTMLElement>('[data-annotation]').forEach((el) => {
      const note = el.getAttribute('data-annotation')?.trim()
      if (!note)
        return
      if (inInteractiveContent) {
        el.tabIndex = 0
        el.setAttribute('role', 'button')
        if (!el.hasAttribute('aria-expanded'))
          el.setAttribute('aria-expanded', 'false')
        el.removeAttribute('title')
      }
      else {
        el.removeAttribute('tabindex')
        el.removeAttribute('role')
        el.removeAttribute('aria-expanded')
        if (!el.hasAttribute('title'))
          el.setAttribute('title', note)
      }
    })

    // 若包含 <span data-icon="..."></span>，按需懒加载对应 Lucide SVG 填入
    if (!html.includes('data-icon='))
      return

    let cancelled = false
    const iconNodes = Array.from(root.querySelectorAll<HTMLElement>('span[data-icon]:empty'))
    if (iconNodes.length === 0)
      return

    void import('@/lib/inline-icon/icon').then(({ loadIconSvg }) => {
      if (cancelled)
        return
      for (const el of iconNodes) {
        const name = el.getAttribute('data-icon') ?? ''
        void loadIconSvg(name).then((svg) => {
          if (!cancelled && svg && !el.firstChild)
            el.innerHTML = svg
        })
      }
    })

    return () => {
      cancelled = true
    }
  }, [html])

  if (!html)
    return null

  return (
    <div
      ref={rootRef}
      {...{ [RICH_TEXT_CONTENT_ATTR]: '' }}
      className={cn('neo-rich-text', className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
