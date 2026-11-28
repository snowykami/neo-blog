import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { NextIntlClientProvider } from 'next-intl'
import * as React from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import AlertContent from '@/components/ui/alert.content-view'
import { createGraph, relativePath, SRC_ROOT } from '../../../scripts/i18n-graph.mjs'
import Callout from './callout/callout'
import { renderRichTextHtml, RichTextContent } from './rich-text-content'

const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']

function parseHtml(html: string): HTMLElement {
  return new window.DOMParser().parseFromString(html, 'text/html').body
}

function resolveLocalModule(fromFile: string, specifier: string): string | null {
  const base = specifier.startsWith('@/')
    ? join(SRC_ROOT, specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(dirname(fromFile), specifier)
      : null
  if (!base)
    return null
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = base + suffix
    if (existsSync(candidate) && statSync(candidate).isFile())
      return candidate
  }
  return null
}

/**
 * 仅沿着非 type-only 的静态 import / export 语句求闭包（排除 `import()` 动态拆包边界），
 * 用于证明首屏入口未把富文本解析器打进同步主包。
 */
function staticRuntimeClosure(entries: string[]) {
  const graph = createGraph()
  const visited = new Set<string>()
  const externalImports = new Set<string>()
  const queue = [...entries]

  while (queue.length > 0) {
    const file = queue.pop()!
    if (visited.has(file))
      continue
    visited.add(file)

    const sf = graph.parsed(file)
    for (const stmt of sf.statements) {
      if (ts.isImportDeclaration(stmt) && !stmt.importClause?.isTypeOnly && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const spec = stmt.moduleSpecifier.text
        const local = resolveLocalModule(file, spec)
        if (local) {
          if (!visited.has(local))
            queue.push(local)
        }
        else {
          externalImports.add(spec)
        }
      }
      else if (ts.isExportDeclaration(stmt) && !stmt.isTypeOnly && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const spec = stmt.moduleSpecifier.text
        const local = resolveLocalModule(file, spec)
        if (local) {
          if (!visited.has(local))
            queue.push(local)
        }
        else {
          externalImports.add(spec)
        }
      }
    }
  }

  return { visited, externalImports }
}

describe('rich-text-content', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('正确渲染常见 Markdown（站内/外部链接、粗斜体、删除线、行内代码、代码块、紧凑与松散任务列表、引用与单换行）', () => {
    const md = [
      '访问 [音乐页](/music) 或 [GitHub](https://github.com/snowykami/neo-blog)，支持 **粗体**、*斜体*、~~删除线~~ 与 `pnpm build`。',
      '紧跟下一行（breaks: true）',
      '',
      '- [x] 已完成任务',
      '',
      '- [ ] 松散待办任务',
      '',
      '> 引用段落',
      '',
      '```ts',
      'const answer: number = 42',
      '```',
    ].join('\n')

    const body = parseHtml(renderRichTextHtml(md))
    const links = body.querySelectorAll('a')
    expect(links).toHaveLength(2)

    // 站内相对链接保持同页跳转，不加 target="_blank"
    expect(links[0]?.getAttribute('href')).toBe('/music')
    expect(links[0]?.getAttribute('target')).toBeNull()
    expect(links[0]?.getAttribute('rel')).toBeNull()

    // 外部链接自动补齐 target="_blank" 与 rel="noopener noreferrer"
    expect(links[1]?.getAttribute('href')).toBe('https://github.com/snowykami/neo-blog')
    expect(links[1]?.getAttribute('target')).toBe('_blank')
    expect(links[1]?.getAttribute('rel')).toBe('noopener noreferrer')

    expect(body.querySelector('strong')?.textContent).toBe('粗体')
    expect(body.querySelector('em')?.textContent).toBe('斜体')
    expect(body.querySelector('del')?.textContent).toBe('删除线')
    expect(body.querySelector('p code')?.textContent).toBe('pnpm build')
    expect(body.querySelector('p br')).not.toBeNull()
    expect(body.querySelectorAll('li.task-list-item input[type="checkbox"][disabled]')).toHaveLength(2)
    expect(body.querySelector('blockquote')?.textContent).toContain('引用段落')
    expect(body.querySelector('pre > code.language-ts')?.textContent).toContain('const answer: number = 42')
  })

  it('保留博客平台行内格式（data-annotation、data-icon、mark/data-color、u/sup/sub 与安全文字颜色）', () => {
    const input = [
      '术语 <span data-annotation="Write-Ahead Logging 预写式日志">WAL</span>',
      '高亮 <mark>默认</mark> 与 <mark data-color="var(--color-yellow-200)">浅黄</mark>',
      '颜色 <span style="color: var(--color-red-500)">红字</span>',
      '格式 <u>下划线</u>、H<sub>2</sub>O、x<sup>2</sup>、图标 <span data-icon="rocket"></span>',
    ].join('，')

    const body = parseHtml(renderRichTextHtml(input))
    const annotation = body.querySelector('span[data-annotation]')
    expect(annotation?.getAttribute('data-annotation')).toBe('Write-Ahead Logging 预写式日志')
    // 纯 HTML 层不硬编码 tabindex/role，避免抢夺编辑器光标焦点
    expect(annotation?.getAttribute('tabindex')).toBeNull()
    expect(annotation?.getAttribute('role')).toBeNull()

    const marks = body.querySelectorAll('mark')
    expect(marks).toHaveLength(2)
    expect(marks[0]?.getAttribute('data-color')).toBeNull()
    expect(marks[1]?.getAttribute('data-color')).toBe('var(--color-yellow-200)')
    expect(marks[1]?.getAttribute('style')).toBe('background-color: var(--color-yellow-200)')

    const colored = body.querySelector('span[style]')
    expect(colored?.getAttribute('style')).toBe('color: var(--color-red-500)')

    expect(body.querySelector('u')?.textContent).toBe('下划线')
    expect(body.querySelector('sub')?.textContent).toBe('2')
    expect(body.querySelector('sup')?.textContent).toBe('2')
    expect(body.querySelector('span[data-icon="rocket"]')).not.toBeNull()
  })

  it('严格拦截 XSS 与样式覆盖攻击（script、iframe、on*、javascript:/data: 协议、危险 style 与伪造 class）', () => {
    const malicious = [
      '<script>window.__pwned = true</script>',
      '<iframe src="https://evil.example"></iframe>',
      '<img src="x" onerror="alert(1)">',
      '[伪造脚本链接](javascript:alert(1))',
      '[伪造数据链接](data:text/html,<script>alert(2)</script>)',
      '<a href="//evil.example/phish" onclick="alert(3)">协议相对外链</a>',
      '<span class="fixed inset-0 z-50 bg-black" style="color: red; position: fixed; background-image: url(javascript:alert(4))">伪装层</span>',
      '<mark data-color="red; background: url(https://evil.example/t)">脏高亮</mark>',
      '<input type="text" value="spoof">',
    ].join('\n\n')

    const clean = renderRichTextHtml(malicious)
    expect(clean).not.toMatch(/<script|<iframe|<img|onerror|onclick|javascript:|data:text\/html/i)

    const body = parseHtml(clean)
    const anchors = body.querySelectorAll('a')
    expect(anchors.length).toBeGreaterThanOrEqual(2)
    for (const a of anchors) {
      expect(a.getAttribute('href')).toBeNull()
      expect(a.getAttribute('target')).toBeNull()
      expect(a.getAttribute('rel')).toBeNull()
    }

    const span = body.querySelector('span')
    expect(span?.getAttribute('class')).toBeNull()
    expect(span?.getAttribute('style')).toBeNull()

    const mark = body.querySelector('mark')
    expect(mark?.getAttribute('data-color')).toBeNull()
    expect(mark?.getAttribute('style')).toBeNull()

    expect(body.querySelector('input[type="text"]')).toBeNull()
  })

  it('按挂载上下文区分注释交互属性：正文容器启用键盘 ARIA 角色，编辑器与侧边栏仅设 title 不抢焦点', () => {
    const blogContainer = document.createElement('div')
    blogContainer.id = 'blog-content'
    const editorContainer = document.createElement('div')
    editorContainer.className = 'neo-component-block'
    document.body.append(blogContainer, editorContainer)

    const blogRoot = createRoot(blogContainer)
    const editorRoot = createRoot(editorContainer)
    try {
      flushSync(() => {
        blogRoot.render(React.createElement(RichTextContent, {
          content: '包含 **粗体** 与 <span data-annotation="术语解释">PKCE</span>',
        }))
        editorRoot.render(React.createElement(RichTextContent, {
          content: '预览 <span data-annotation="术语解释">PKCE</span>',
        }))
      })

      const blogAnnotation = blogContainer.querySelector('[data-rich-text-content] [data-annotation]')
      expect(blogAnnotation?.getAttribute('tabindex')).toBe('0')
      expect(blogAnnotation?.getAttribute('role')).toBe('button')
      expect(blogAnnotation?.getAttribute('aria-expanded')).toBe('false')
      expect(blogAnnotation?.getAttribute('title')).toBeNull()

      const editorAnnotation = editorContainer.querySelector('[data-rich-text-content] [data-annotation]')
      expect(editorAnnotation?.getAttribute('title')).toBe('术语解释')
      expect(editorAnnotation?.getAttribute('tabindex')).toBeNull()
      expect(editorAnnotation?.getAttribute('role')).toBeNull()
    }
    finally {
      flushSync(() => {
        blogRoot.unmount()
        editorRoot.unmount()
      })
      blogContainer.remove()
      editorContainer.remove()
    }
  })

  it('包体隔离：RichTextContent、marked 与 isomorphic-dompurify 不进入根布局、首页列表与侧边栏主入口的静态闭包', () => {
    const entries = [
      join(SRC_ROOT, 'app/[locale]/layout.tsx'),
      join(SRC_ROOT, 'app/[locale]/(main)/layout.tsx'),
      join(SRC_ROOT, 'app/[locale]/(main)/page.tsx'),
      join(SRC_ROOT, 'components/blog-sidebar/index.tsx'),
      join(SRC_ROOT, 'components/content-components/component-islands.tsx'),
    ]
    const { visited, externalImports } = staticRuntimeClosure(entries)
    const files = [...visited].map(relativePath)
    expect(files).not.toContain('src/components/content-components/rich-text-content.tsx')
    expect([...externalImports]).not.toContain('marked')
    expect([...externalImports]).not.toContain('isomorphic-dompurify')
  })

  it('callout 与 alert 正文描述区跨全列通栏对齐（移除默认 col-start-2）', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      flushSync(() => {
        root.render(
          React.createElement(NextIntlClientProvider, {
            locale: 'zh-CN',
            messages: { ContentComponents: { callout: { options: { type: { info: '信息' } } } } },
            children: React.createElement(
              React.Fragment,
              null,
              React.createElement(Callout, { type: 'info', title: '标题', content: '通栏正文' }),
              React.createElement(AlertContent, { variant: 'default', title: '提醒', description: '通栏提醒正文' }),
            ),
          }),
        )
      })
      const descriptions = container.querySelectorAll('[data-slot="alert-description"]')
      expect(descriptions).toHaveLength(2)
      for (const desc of descriptions) {
        expect(desc.classList.contains('col-span-full')).toBe(true)
        expect(desc.classList.contains('col-start-1')).toBe(true)
        expect(desc.classList.contains('col-start-2')).toBe(false)
        expect(desc.classList.contains('mt-1.5')).toBe(true)
      }
    }
    finally {
      flushSync(() => root.unmount())
      container.remove()
    }
  })
})
