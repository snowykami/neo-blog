import type { DOMOutputSpec } from '@tiptap/pm/model'
import { NodeSelection } from '@tiptap/pm/state'
import { Node, ReactNodeViewRenderer } from '@tiptap/react'
import DOMPurify from 'isomorphic-dompurify'
import { componentLayoutAttrs, parseComponentAlign, parseComponentWidth } from '@/components/content-components/layout'
import { getDefaultProps, parsePropsAttr, resolveComponent, serializePropsAttr } from '@/components/content-components/props'
import { getContentComponent } from '@/components/content-components/registry'
import { COMPONENT_BLOCK_TOOLBAR_ATTR } from './component-block-constants'
import { ComponentBlockView } from './component-block-view'
import { consumePendingComponentEdit, markPendingComponentEdit } from './pending-edit'

declare module '@tiptap/react' {
  interface Commands<ReturnType> {
    componentBlock: {
      // 在光标处插入注册表中的组件（props 为默认值），插入后自动打开属性编辑
      insertComponentBlock: (name: string) => ReturnType
    }
  }
}

/**
 * 组件块：<div data-component="name" data-props='{...}' data-version="1">降级内容</div>
 * - 原子节点，内容只有组件名与 JSON props；降级内容按组件的 fallback 重新生成
 * - 未知组件或 props 无效时原样保留读入时的降级内容，避免保存后丢失
 * - 布局（宽度预设 / 对齐）与组件 props 无关，存为 data-width / data-align，满宽时不输出
 */
export const ComponentBlock = Node.create({
  name: 'componentBlock',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      name: {
        default: null,
        parseHTML: element => element.getAttribute('data-component'),
        renderHTML: () => ({}),
      },
      props: {
        default: {},
        parseHTML: element => parsePropsAttr(element.getAttribute('data-props')) ?? {},
        renderHTML: () => ({}),
      },
      version: {
        default: null,
        parseHTML: (element) => {
          const version = Number.parseInt(element.getAttribute('data-version') ?? '', 10)
          return Number.isNaN(version) ? null : version
        },
        renderHTML: () => ({}),
      },
      width: {
        default: null,
        parseHTML: element => parseComponentWidth(element.getAttribute('data-width')),
        renderHTML: () => ({}),
      },
      align: {
        default: null,
        parseHTML: element => parseComponentAlign(element.getAttribute('data-align')),
        renderHTML: () => ({}),
      },
      fallback: {
        default: '',
        parseHTML: element => element.innerHTML,
        renderHTML: () => ({}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-component]' }]
  },

  renderHTML({ node }) {
    const { name, props, version, width, align, fallback } = node.attrs
    const resolved = resolveComponent(name, props, version)
    const attrs: Record<string, string> = {
      'data-component': name ?? '',
      'data-props': serializePropsAttr(props),
      ...componentLayoutAttrs(width, align),
    }
    if (version != null)
      attrs['data-version'] = String(version)
    if (resolved.ok)
      return ['div', attrs, ...resolved.def.fallback(resolved.props)] as DOMOutputSpec
    if (!fallback || typeof document === 'undefined')
      return ['div', attrs]
    // 保留读入时的降级内容：正文不可信，先净化（移除脚本、事件处理器等）再转为 DOM
    const dom = document.createElement('div')
    for (const [key, value] of Object.entries(attrs))
      dom.setAttribute(key, value)
    const template = document.createElement('template')
    template.innerHTML = DOMPurify.sanitize(fallback)
    dom.append(template.content)
    return { dom }
  },

  addCommands() {
    return {
      insertComponentBlock: name => ({ commands, editor, state, dispatch }) => {
        const def = getContentComponent(name)
        if (!def)
          return false
        // editor.can() 检查时不实际插入，不标记自动编辑
        if (dispatch)
          markPendingComponentEdit(editor)
        const content = { type: this.name, attrs: { name, props: getDefaultProps(def), version: def.version, width: def.defaultWidth ?? null } }
        // 选中整个节点（如另一个组件块、图片）时插入到其后，不替换选中的节点
        const { selection } = state
        const inserted = selection instanceof NodeSelection
          ? commands.insertContentAt(selection.to, content)
          : commands.insertContent(content)
        if (dispatch && !inserted)
          consumePendingComponentEdit(editor)
        return inserted
      },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(ComponentBlockView, {
      stopEvent: ({ event }) => {
        const target = event.target as Element | null
        // 浮动工具栏中的点击交给按钮处理
        if (target?.closest?.(`[${COMPONENT_BLOCK_TOOLBAR_ATTR}]`))
          return true
        if (/dragstart|dragover|dragend|drop/.test(event.type))
          return false
        // 预览中的交互元素（标签页、播放按钮等）交给组件自己处理，其余位置（含链接）用于选中节点
        return !!target?.closest?.('button, input, textarea, select, [role="tab"]')
      },
    })
  },
})

export default ComponentBlock
