import type { Schema } from '@tiptap/pm/model'
import { getSchema } from '@tiptap/react'
import { beforeAll, describe, expect, it } from 'vitest'
import { markdownToSlice } from '@/components/tiptap-editor/ai-write-utils'
import { createContentExtensions } from '@/lib/tiptap-extensions'
import { buildAIComponentGuide, convertAIComponentBlocks, getAIComponents } from './ai-components'
import { parsePropsAttr } from './props'
import { CONTENT_COMPONENTS } from './registry'

let schema: Schema

beforeAll(() => {
  schema = getSchema(createContentExtensions({ upload: async () => '', placeholder: () => '', getSlashItems: () => [] }))
})

/** 按 AI 帮写的流程把 Markdown 解析为编辑器内容，返回各块的类型与属性 */
function parseAIMarkdown(markdown: string) {
  const slice = markdownToSlice(schema, markdown, 'block', convertAIComponentBlocks)
  const blocks: { type: string, text: string, name?: string, props?: unknown }[] = []
  slice.content.forEach((node) => {
    blocks.push({
      type: node.type.name,
      text: node.textContent,
      ...(node.type.name === 'componentBlock' && { name: node.attrs.name, props: node.attrs.props }),
    })
  })
  return blocks
}

const fence = (name: string, props: unknown) => `\`\`\`component:${name}\n${typeof props === 'string' ? props : JSON.stringify(props)}\n\`\`\``

describe('ai component whitelist', () => {
  it('only offers components without external ids', () => {
    const names = getAIComponents().map(def => def.name).sort()
    expect(names).toEqual(['callout', 'codeTabs', 'collapsible', 'textTabs'])
    // 依赖外部 ID 的组件不能开放给 AI，否则模型会编造歌曲或仓库
    for (const name of ['neteaseSong', 'githubRepo', 'weatherCard'])
      expect(CONTENT_COMPONENTS.find(def => def.name === name)?.ai).toBeUndefined()
  })

  it('builds a guide with usage and input json schema', () => {
    const guide = buildAIComponentGuide()
    const calloutLine = guide.split('\n').find(line => line.startsWith('  props：') && line.includes('"warning"'))
    expect(guide).toContain('- callout：')
    expect(calloutLine).toBeDefined()
    const jsonSchema = JSON.parse(calloutLine!.replace('  props：', ''))
    expect(jsonSchema.$schema).toBeUndefined()
    expect(jsonSchema.properties.content.widget).toBeUndefined()
    expect(jsonSchema.properties.type.enum).toEqual(['info', 'warning', 'tip'])
  })
})

describe('convertAIComponentBlocks', () => {
  it('turns valid component fences into component blocks with validated props', () => {
    const blocks = parseAIMarkdown(`前言\n\n${fence('callout', { type: 'warning', title: ' 注意 ', content: '先备份' })}\n\n结尾`)
    expect(blocks.map(block => block.type)).toEqual(['paragraph', 'componentBlock', 'paragraph'])
    expect(blocks[1].name).toBe('callout')
    // 写入的是校验后的值（trim 等转换已生效）
    expect(blocks[1].props).toEqual({ type: 'warning', title: '注意', content: '先备份' })
  })

  it('keeps multi-line strings in code tabs', () => {
    const tabs = [{ label: 'pnpm', language: 'bash', code: 'pnpm add zod\npnpm build' }, { label: 'npm', language: 'bash', code: 'npm i zod' }]
    const [block] = parseAIMarkdown(fence('codeTabs', { tabs }))
    expect(block.type).toBe('componentBlock')
    expect(block.props).toEqual({ tabs })
  })

  it('falls back to paragraphs when props are invalid', () => {
    // content 为必填
    const blocks = parseAIMarkdown(fence('callout', { type: 'tip', title: '标题', content: '' }))
    expect(blocks).toEqual([{ type: 'paragraph', text: '标题' }])
    // 缺少必填字段时默认值会跳过校验，同样应降级，而不是插入一个渲染时才报错的组件
    expect(parseAIMarkdown(fence('callout', { type: 'tip', title: '缺少正文' }))).toEqual([{ type: 'paragraph', text: '缺少正文' }])
  })

  it('falls back to paragraphs for components not offered to ai', () => {
    const blocks = parseAIMarkdown(fence('neteaseSong', { id: 123 }))
    expect(blocks).toEqual([])
    const unknown = parseAIMarkdown(fence('mystery', { title: '神秘组件', body: '第一段\n\n第二段' }))
    expect(unknown.map(block => block.text)).toEqual(['神秘组件', '第一段', '第二段'])
  })

  it('keeps incomplete json as a plain code block', () => {
    // 流式生成中 JSON 还不完整
    const [block] = parseAIMarkdown('```component:callout\n{"type":"tip","con')
    expect(block.type).toBe('codeBlock')
    expect(block.text).toContain('"type":"tip"')
  })

  it('escapes props written into the placeholder', () => {
    const body = new window.DOMParser().parseFromString('<pre><code class="language-component:callout">{"content":"&lt;/div&gt;&lt;script&gt;"}</code></pre>', 'text/html').body
    convertAIComponentBlocks(body)
    const block = body.querySelector('div[data-component]')
    expect(block?.getAttribute('data-props')).not.toContain('<')
    expect(parsePropsAttr(block?.getAttribute('data-props'))).toEqual({ type: 'info', title: '', content: '</div><script>' })
  })
})
