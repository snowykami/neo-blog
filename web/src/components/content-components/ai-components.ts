import type { RegisteredContentComponent } from './types'
import { z } from 'zod'
import { serializePropsAttr } from './props'
import { CONTENT_COMPONENTS, getContentComponent } from './registry'

/**
 * AI 帮写中的组件：只开放定义了 ai 的组件（不依赖外部 ID）。
 * 模型以代码块输出组件：```component:名称 + 一行 props JSON；生成后转换为组件块，名称未开放或 props 校验失败时降级为普通段落
 */

export const AI_COMPONENT_LANGUAGE_PREFIX = 'component:'

export function getAIComponents(): RegisteredContentComponent[] {
  return CONTENT_COMPONENTS.filter(def => def.ai)
}

// JSON Schema 中只与编辑器有关的字段，不写入提示词
const EDITOR_ONLY_KEYS = new Set(['$schema', 'widget'])

function stripEditorKeys(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(stripEditorKeys)
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).filter(([key]) => !EDITOR_ONLY_KEYS.has(key)).map(([key, item]) => [key, stripEditorKeys(item)]))
  return value
}

/** props 的 JSON Schema（输入形态，去掉只与编辑器有关的字段） */
function getPropsJSONSchema(def: RegisteredContentComponent): unknown {
  return stripEditorKeys(z.toJSONSchema(def.schema, { io: 'input' }))
}

/** 可用组件说明：每个组件一行用途与一行 props 的 JSON Schema，由后端放入帮写提示词 */
export function buildAIComponentGuide(): string {
  return getAIComponents()
    .map(def => `- ${def.name}：${def.ai!.usage}\n  props：${JSON.stringify(getPropsJSONSchema(def))}`)
    .join('\n')
}

// 取值为选项或标识而非正文的字段，降级时不当作文字
const NON_TEXT_KEYS = new Set(['type', 'variant', 'language', 'mode', 'align', 'width', 'icon', 'id', 'url', 'href', 'src'])

/**
 * 后端 MCP 使用的组件清单（与帮写开放的组件一致）：由 ai-components.test.ts 写入 internal/mcpserver/ai-components.json，
 * 组件有变化时运行 pnpm test -u 更新；后端据此生成写作指南，并校验、转换外部 AI 写入的组件代码块
 */
export function buildAIComponentManifest() {
  return {
    components: getAIComponents().map(def => ({
      name: def.name,
      version: def.version,
      usage: def.ai!.usage,
      ...(def.defaultWidth && def.defaultWidth !== 100 && { default_width: def.defaultWidth }),
      props_schema: getPropsJSONSchema(def),
    })),
    fallback_skip_keys: [...NON_TEXT_KEYS],
  }
}

/** 收集 props 中的正文文字，组件不可用时作为普通段落保留内容 */
function collectText(value: unknown, out: string[]) {
  if (typeof value === 'string') {
    if (value.trim())
      out.push(value.trim())
  }
  else if (Array.isArray(value)) {
    value.forEach(item => collectText(item, out))
  }
  else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => {
      if (!NON_TEXT_KEYS.has(key))
        collectText(item, out)
    })
  }
}

function textParagraphs(doc: Document, texts: string[]): HTMLElement[] {
  return texts
    .flatMap(text => text.split(/\n\s*\n/))
    .map(text => text.trim())
    .filter(Boolean)
    .map((text) => {
      const p = doc.createElement('p')
      p.textContent = text
      return p
    })
}

/**
 * 把 Markdown 解析出的组件代码块（<pre><code class="language-component:名称">）转换为组件块占位元素：
 * - 组件已开放且 props 通过 schema 校验：转为 <div data-component> 由编辑器解析为组件块（props 写入校验后的值）
 * - 组件未开放或 props 不合法：按其中的文字降级为普通段落
 * - JSON 不完整（流式生成中）或无法解析：保留为普通代码块
 */
export function convertAIComponentBlocks(body: HTMLElement) {
  const doc = body.ownerDocument
  body.querySelectorAll('pre > code').forEach((code) => {
    const language = Array.from(code.classList).find(name => name.startsWith(`language-${AI_COMPONENT_LANGUAGE_PREFIX}`))
    const pre = code.parentElement
    if (!language || !pre)
      return
    const name = language.slice(`language-${AI_COMPONENT_LANGUAGE_PREFIX}`.length)
    let props: unknown
    try {
      props = JSON.parse(code.textContent ?? '')
    }
    catch {
      code.classList.remove(language)
      return
    }
    const def = getContentComponent(name)
    const result = def?.ai ? def.schema.safeParse(props) : null
    // 缺少的字段会直接取默认值而不经过校验（如必填正文默认为空字符串），渲染时会再校验写入的值；
    // 这里对校验后的值再校验一次，与渲染时保持一致，避免插入一个「属性无效」的组件
    if (def && result?.success && def.schema.safeParse(result.data).success) {
      const block = doc.createElement('div')
      block.setAttribute('data-component', def.name)
      block.setAttribute('data-props', serializePropsAttr(result.data))
      block.setAttribute('data-version', String(def.version))
      if (def.defaultWidth && def.defaultWidth !== 100)
        block.setAttribute('data-width', String(def.defaultWidth))
      pre.replaceWith(block)
      return
    }
    const texts: string[] = []
    collectText(props, texts)
    pre.replaceWith(...textParagraphs(doc, texts))
  })
}
