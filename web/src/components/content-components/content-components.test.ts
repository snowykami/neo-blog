import type { Schema } from '@tiptap/pm/model'
import { DOMSerializer, DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { getSchema } from '@tiptap/react'
import { beforeAll, describe, expect, it } from 'vitest'
import { createContentExtensions } from '@/lib/tiptap-extensions'
import { sanitizeContentHtml } from '@/utils/server/sanitize-html'
import { getDefaultProps, parsePropsAttr, resolveComponent, resolveComponentElement, serializePropsAttr } from './props'
import { CONTENT_COMPONENTS, getContentComponent } from './registry'
import { describeFields } from './schema-fields'

let schema: Schema

beforeAll(() => {
  schema = getSchema(createContentExtensions({ upload: async () => '', placeholder: () => '', getSlashItems: () => [] }))
})

/** 编辑器读入 HTML 后再序列化（与保存时的 getHTML 一致） */
function roundTrip(html: string): string {
  const body = new window.DOMParser().parseFromString(html, 'text/html').body
  const doc = PMDOMParser.fromSchema(schema).parse(body)
  const container = document.createElement('div')
  container.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(doc.content))
  return container.innerHTML
}

function componentHtml(name: string, props: unknown, fallback = '') {
  return `<div data-component="${name}" data-props="${serializePropsAttr(props).replace(/"/g, '&quot;')}" data-version="1">${fallback}</div>`
}

function firstComponent(html: string): Element {
  const el = new window.DOMParser().parseFromString(html, 'text/html').body.querySelector('[data-component]')
  expect(el).not.toBeNull()
  return el!
}

describe('注册表', () => {
  it('每个组件都有可用的默认 props 与表单字段', () => {
    for (const def of CONTENT_COMPONENTS) {
      expect(getContentComponent(def.name)).toBe(def)
      expect(() => getDefaultProps(def)).not.toThrow()
      expect(describeFields(def.schema).length).toBeGreaterThan(0)
    }
  })

  it('未知组件、版本过高与无效 props 不渲染', () => {
    expect(resolveComponent('nope', {}).ok).toBe(false)
    expect(resolveComponent('callout', { content: 'x' }, 99)).toMatchObject({ ok: false, reason: 'unknown' })
    expect(resolveComponent('callout', { type: 'danger', content: 'x' })).toMatchObject({ ok: false, reason: 'invalid' })
    expect(resolveComponent('githubRepo', { repo: '../../admin' })).toMatchObject({ ok: false, reason: 'invalid' })
    expect(resolveComponent('neteaseSong', { id: '1 or 1=1' })).toMatchObject({ ok: false, reason: 'invalid' })
    expect(resolveComponent('callout', { content: 'hi' })).toMatchObject({ ok: true, props: { type: 'info', title: '', content: 'hi' } })
  })

  it('表单字段从 schema 推导', () => {
    expect(describeFields(getContentComponent('callout')!.schema).map(f => f.kind)).toEqual(['select', 'text', 'textarea'])
    const [tabs] = describeFields(getContentComponent('codeTabs')!.schema)
    expect(tabs).toMatchObject({ kind: 'list', min: 1, max: 8, itemDefault: { label: '', language: '', code: '' } })
    expect(describeFields(getContentComponent('neteaseSong')!.schema)[0].kind).toBe('number')
  })
})

describe('data-props 序列化', () => {
  it('转义尖括号，可还原', () => {
    const props = { code: '<!-- x --> </style> a & b' }
    const raw = serializePropsAttr(props)
    expect(raw).not.toMatch(/[<>&]/)
    expect(parsePropsAttr(raw)).toEqual(props)
    expect(parsePropsAttr('{bad')).toBeNull()
  })

  it('净化后保留组件占位，移除危险内容', () => {
    const props = { tabs: [{ label: 'HTML', language: 'xml', code: '<script>alert(1)</script><!-- c -->' }] }
    const dirty = `${componentHtml('codeTabs', props, '<p onclick="alert(1)">x</p><script>alert(2)</script><img src=x onerror="alert(3)">')}`
    const clean = sanitizeContentHtml(dirty)
    expect(clean).not.toMatch(/<script|onclick|onerror/)
    const resolved = resolveComponentElement(firstComponent(clean))
    expect(resolved).toMatchObject({ ok: true, props })
  })
})

describe('编辑器节点', () => {
  it('序列化为占位 + 降级内容，往返后 props 不变', () => {
    const props = { tabs: [{ label: 'Go', language: 'go', code: 'fmt.Println("<hi>")' }] }
    const html = roundTrip(componentHtml('codeTabs', props, '<p>旧的降级内容</p>'))
    const el = firstComponent(html)
    expect(el.getAttribute('data-version')).toBe('1')
    expect(resolveComponentElement(el)).toMatchObject({ ok: true, props })
    // 降级内容按组件重新生成
    expect(el.querySelector('pre code.language-go')?.textContent).toBe('fmt.Println("<hi>")')
    expect(el.textContent).not.toContain('旧的降级内容')
    expect(roundTrip(html)).toBe(html)
  })

  it('未知组件保留原降级内容（净化后）', () => {
    const html = roundTrip(componentHtml('futureWidget', { a: 1 }, '<p>保留我</p><img src="x" onerror="alert(1)">'))
    const el = firstComponent(html)
    expect(el.getAttribute('data-component')).toBe('futureWidget')
    expect(parsePropsAttr(el.getAttribute('data-props'))).toEqual({ a: 1 })
    expect(el.innerHTML).toContain('<p>保留我</p>')
    expect(el.innerHTML).not.toContain('onerror')
  })
})
