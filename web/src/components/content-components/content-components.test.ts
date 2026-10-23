import type { Schema } from '@tiptap/pm/model'
import type { FieldDescriptor } from './schema-fields'
import { readFileSync } from 'node:fs'
import { DOMSerializer, DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { getSchema } from '@tiptap/react'
import { beforeAll, describe, expect, it } from 'vitest'
import { createContentExtensions } from '@/lib/tiptap-extensions'
import { localesData } from '@/locales'
import { sanitizeContentHtml } from '@/utils/server/sanitize-html'
import { generate, outputFile } from '../../../scripts/gen-content-components.mjs'
import { buildLibraryTree, filterLibraryTree, flattenLibraryTree } from './library-tree'
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
    // 链接只允许 http(s) 与站内路径
    expect(resolveComponent('linkButton', { text: 'x', href: 'javascript:alert(1)' }).ok).toBe(false)
    expect(resolveComponent('linkButton', { text: 'x', href: '//evil.example' }).ok).toBe(false)
    expect(resolveComponent('linkButton', { text: 'x', href: '/p/hello' }).ok).toBe(true)
    expect(resolveComponent('linkCard', { url: '/p/hello' }).ok).toBe(false)
  })

  it('自动生成的注册表是最新的，组件名唯一', () => {
    expect(readFileSync(outputFile, 'utf8')).toBe(generate())
    const names = CONTENT_COMPONENTS.map(def => def.name)
    expect(new Set(names).size).toBe(names.length)
    expect(CONTENT_COMPONENTS.map(def => def.path)).toEqual(expect.arrayContaining(['content-components/callout', 'ui/badge', 'common/link-preview-card']))
  })

  it('每种语言都有完整的组件文案，示例 props 可通过校验', () => {
    // 表单字段（含列表项字段）与枚举选项需要的文案 key
    const fieldKeys = (fields: FieldDescriptor[]): string[] => fields.flatMap(field => [
      `fields.${field.name}`,
      ...(field.kind === 'select' ? field.options.map(option => `options.${field.name}.${option}`) : []),
      ...(field.kind === 'list' ? fieldKeys(field.fields) : []),
    ])
    for (const [locale, { data }] of Object.entries(localesData)) {
      const messages = (data as { ContentComponents: Record<string, unknown> }).ContentComponents
      const get = (path: string) => path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], messages)
      for (const def of CONTENT_COMPONENTS) {
        const keys = ['name', 'description', ...fieldKeys(describeFields(def.schema))]
        const used: string[] = []
        const example = def.example?.((key) => {
          used.push(`example.${key}`)
          return String(get(`${def.name}.example.${key}`) ?? '')
        })
        for (const key of [...keys, ...used])
          expect(typeof get(`${def.name}.${key}`), `${locale}: ContentComponents.${def.name}.${key}`).toBe('string')
        if (example)
          expect(resolveComponent(def.name, example).ok, `${locale}: ${def.name} example`).toBe(true)
      }
    }
  })

  it('组件库按源码目录组织', () => {
    const tree = buildLibraryTree(CONTENT_COMPONENTS)
    expect(tree.map(node => `${node.type}:${node.name}`)).toEqual(expect.arrayContaining(['folder:common', 'folder:content-components', 'folder:ui']))
    expect(flattenLibraryTree(tree)).toHaveLength(CONTENT_COMPONENTS.length)
    const filtered = filterLibraryTree(tree, def => def.name === 'badges')
    expect(filtered).toEqual([expect.objectContaining({ type: 'folder', name: 'ui', children: [expect.objectContaining({ type: 'component', name: 'badge' })] })])
  })

  it('表单字段从 schema 推导', () => {
    expect(describeFields(getContentComponent('callout')!.schema).map(f => f.kind)).toEqual(['select', 'text', 'textarea'])
    const [tabs] = describeFields(getContentComponent('codeTabs')!.schema)
    expect(tabs).toMatchObject({ kind: 'list', min: 1, max: 8, itemDefault: { label: '', language: '', code: '' } })
    expect(describeFields(getContentComponent('neteaseSong')!.schema)[0]).toMatchObject({ kind: 'number', allowZero: false })
    expect(describeFields(getContentComponent('progress')!.schema)[0]).toMatchObject({ kind: 'list', fields: [{ kind: 'text' }, { kind: 'number', allowZero: true, min: 0, max: 100 }] })
    const weatherFields = describeFields(getContentComponent('weatherCard')!.schema)
    expect(weatherFields.find(f => f.name === 'temperature')).toMatchObject({ kind: 'number', allowZero: true, integer: false, min: -90, max: 60 })
    expect(weatherFields.find(f => f.name === 'humidity')).toMatchObject({ kind: 'number', integer: true })
    expect(weatherFields.find(f => f.name === 'recordedAt')).toMatchObject({ kind: 'datetime' })
  })

  it('天气卡：快照与实时模式的校验、字段显隐与降级内容', () => {
    const def = getContentComponent('weatherCard')!
    expect(getDefaultProps(def)).toMatchObject({ mode: 'snapshot', condition: 'clear' })
    expect(resolveComponent('weatherCard', { condition: 'rain', temperature: 21.5, recordedAt: '2026-10-23T14:30' }).ok).toBe(true)
    expect(resolveComponent('weatherCard', { condition: 'tornado' }).ok).toBe(false)
    expect(resolveComponent('weatherCard', { recordedAt: '<script>' }).ok).toBe(false)
    expect(resolveComponent('weatherCard', { humidity: 101 }).ok).toBe(false)
    // 实时模式需要城市与坐标
    expect(resolveComponent('weatherCard', { mode: 'live', city: '上海' }).ok).toBe(false)
    expect(resolveComponent('weatherCard', { mode: 'live', latitude: 31.23, longitude: 121.47 }).ok).toBe(false)
    expect(resolveComponent('weatherCard', { mode: 'live', city: '上海', latitude: 31.23, longitude: 121.47 }).ok).toBe(true)
    expect(resolveComponent('weatherCard', { mode: 'live', city: '上海', latitude: 91, longitude: 0 }).ok).toBe(false)

    const visible = (mode: string) => describeFields(def.schema).map(f => f.name).filter(name => def.editor!.isFieldVisible!(name, { mode }))
    expect(visible('snapshot')).not.toContain('latitude')
    expect(visible('live')).toEqual(['mode', 'city', 'latitude', 'longitude'])

    const html = roundTrip(componentHtml('weatherCard', { city: '上海', condition: 'rain', temperature: 21.5, humidity: 63, wind: 3, recordedAt: '2026-10-23T14:30' }))
    expect(firstComponent(html).textContent).toBe('🌧️ 上海 · 21.5°C · 💧 63% · 🍃 3 Bft · 2026-10-23 14:30')
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
