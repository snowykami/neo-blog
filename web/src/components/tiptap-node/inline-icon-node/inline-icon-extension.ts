import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state'
import { mergeAttributes, Node } from '@tiptap/react'
import { INLINE_ICON_ATTR, INLINE_ICON_SELECTOR, isIconName, loadIconSvg } from '@/lib/inline-icon/icon'
import './inline-icon.scss'

export const INLINE_ICON_NODE = 'inlineIcon'

// 未知图标名（如旧版 lucide 中被移除的图标）在编辑器里显示的占位图标
const UNKNOWN_ICON = 'circle-question-mark'

declare module '@tiptap/react' {
  interface Commands<ReturnType> {
    inlineIcon: {
      // 在光标处插入图标（有选区时替换选中内容），图标继承光标处的文字格式
      insertInlineIcon: (name: string) => ReturnType
      // 更换 pos 处图标
      setInlineIcon: (pos: number, name: string) => ReturnType
    }
  }
}

export function isInlineIconNode(node: PMNode | null | undefined): node is PMNode {
  return node?.type.name === INLINE_ICON_NODE
}

export interface InlineIconOptions {
  // 打开图标选择器更换图标（点击图标、选中图标后按 Enter）；pos 为图标节点的位置
  onEdit?: (pos: number) => void
}

/**
 * 行内图标：只保存图标名，存储格式与渲染见 lib/inline-icon/icon.ts
 * 行内原子节点，可与文字一起加粗、上色、高亮、加链接；复制粘贴前台渲染后的图标（里面是 SVG）也能还原
 */
export const InlineIcon = Node.create<InlineIconOptions>({
  name: INLINE_ICON_NODE,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { onEdit: undefined }
  },

  addAttributes() {
    return {
      name: {
        default: '',
        parseHTML: element => element.getAttribute(INLINE_ICON_ATTR) ?? '',
        renderHTML: attributes => ({ [INLINE_ICON_ATTR]: attributes.name }),
      },
    }
  },

  parseHTML() {
    return [{
      tag: INLINE_ICON_SELECTOR,
      // 先于文字颜色等 span 规则匹配
      priority: 100,
      // 只认图标标记本身（空的，或前台渲染后只有 SVG）；带文字的同名属性来自其他网页，按普通文字处理
      getAttrs: (node) => {
        const element = node as HTMLElement
        return isIconName(element.getAttribute(INLINE_ICON_ATTR)) && !element.textContent?.trim() ? null : false
      },
    }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes)]
  },

  // 纯文本（复制为纯文本、字数统计）中图标不占字
  renderText: () => '',

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span')
      dom.contentEditable = 'false'
      let current = ''
      const render = (name: string) => {
        if (name === current)
          return
        current = name
        dom.setAttribute(INLINE_ICON_ATTR, name)
        dom.title = name
        void loadIconSvg(name).then(async (svg) => {
          if (current !== name)
            return
          dom.classList.toggle('is-unknown', !svg)
          dom.innerHTML = svg ?? (await loadIconSvg(UNKNOWN_ICON)) ?? ''
        })
      }
      render(node.attrs.name)
      return {
        dom,
        update: (updated) => {
          if (updated.type !== node.type)
            return false
          render(updated.attrs.name)
          return true
        },
        // 内容由节点视图自己管理（异步填入 SVG），不需要 ProseMirror 重新解析
        ignoreMutation: () => true,
      }
    }
  },

  addCommands() {
    return {
      insertInlineIcon: name => ({ state, tr, dispatch }) => {
        const { $from } = state.selection
        if (!isIconName(name) || !$from.parent.inlineContent || $from.parent.type.spec.code)
          return false
        if (dispatch)
          tr.replaceSelectionWith(this.type.create({ name }), true).scrollIntoView()
        return true
      },
      setInlineIcon: (pos, name) => ({ state, tr, dispatch }) => {
        const node = state.doc.nodeAt(pos)
        if (!isIconName(name) || !isInlineIconNode(node))
          return false
        if (dispatch)
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, name })
        return true
      },
    }
  },

  addKeyboardShortcuts() {
    return {
      // 选中图标时按 Enter 更换
      Enter: ({ editor }) => {
        const { selection } = editor.state
        if (!(selection instanceof NodeSelection) || !isInlineIconNode(selection.node) || !editor.isEditable || !this.options.onEdit)
          return false
        this.options.onEdit(selection.from)
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('inlineIconClick'),
        props: {
          // 点击图标：选中并打开选择器
          handleClickOn: (view, _pos, node, nodePos, _event, direct) => {
            if (!direct || !isInlineIconNode(node) || !view.editable || !this.options.onEdit)
              return false
            view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, nodePos)))
            this.options.onEdit(nodePos)
            return true
          },
        },
      }),
    ]
  },
})
