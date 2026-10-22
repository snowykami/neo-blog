import { Plugin, PluginKey, Selection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Extension } from '@tiptap/react'

/**
 * AI 写作的高亮：
 * - target：等待输入要求时标出选区或插入点
 * - generating：生成中的内容，末尾显示闪烁光标
 * - generated：生成完成、等待接受的内容
 */
export type AIHighlightKind = 'target' | 'generating' | 'generated'

export interface AIHighlight {
  from: number
  to: number
  kind: AIHighlightKind
}

export const aiWritePluginKey = new PluginKey<AIHighlight | null>('aiWriteHighlight')

// 预览事务的标记：写入生成中的内容时带上，编辑器不把它当作用户修改（不触发自动保存）
export const AI_PREVIEW_META = 'aiWritePreview'

function createCaret() {
  const el = document.createElement('span')
  el.className = 'neo-ai-caret'
  el.setAttribute('aria-hidden', 'true')
  return el
}

export const AIWriteHighlight = Extension.create({
  name: 'aiWriteHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<AIHighlight | null>({
        key: aiWritePluginKey,
        state: {
          init: () => null,
          apply(tr, value) {
            const meta = tr.getMeta(aiWritePluginKey) as AIHighlight | null | undefined
            if (meta !== undefined)
              return meta
            if (!value || !tr.docChanged)
              return value
            return { ...value, from: tr.mapping.map(value.from, -1), to: tr.mapping.map(value.to, 1) }
          },
        },
        props: {
          decorations(state) {
            const value = aiWritePluginKey.getState(state)
            if (!value)
              return null
            const { from, to, kind } = value
            const decorations: Decoration[] = []
            if (to > from) {
              const className = kind === 'target' ? 'neo-ai-target' : 'neo-ai-generated'
              decorations.push(Decoration.inline(from, to, { class: className }))
              // 图片、分割线等原子块不受 inline 装饰影响，单独加节点装饰
              state.doc.nodesBetween(from, to, (node, pos) => {
                if (node.isAtom && node.isBlock && pos >= from && pos + node.nodeSize <= to)
                  decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: `${className}-node` }))
              })
            }
            if (kind === 'generating' || (kind === 'target' && from === to)) {
              // 光标放在最后一段文字的末尾，而不是块与块之间
              const caret = from === to ? from : Selection.near(state.doc.resolve(to), -1).to
              decorations.push(Decoration.widget(caret, createCaret, { side: 1, key: `ai-caret-${kind}` }))
            }
            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})
