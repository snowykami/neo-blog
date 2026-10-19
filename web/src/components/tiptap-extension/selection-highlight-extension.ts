import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Extension, isNodeSelection } from '@tiptap/react'

/**
 * 失焦时保留选区高亮：点击工具栏打开注释、链接等弹窗时焦点会移出编辑器，
 * 浏览器原生选区高亮随之消失，这里在失焦期间给选区加上 .selection 装饰（样式见 paragraph-node.scss）
 * 与 @tiptap/extensions 的 Selection 扩展逻辑一致，避免为此单独引入依赖
 */
export const SelectionHighlight = Extension.create({
  name: 'selectionHighlight',

  addProseMirrorPlugins() {
    const { editor } = this
    return [
      new Plugin({
        key: new PluginKey('selectionHighlight'),
        props: {
          decorations(state) {
            // 聚焦时由浏览器原生选区负责显示；空选区、图片等节点选区、拖拽中不处理
            if (state.selection.empty || editor.isFocused || !editor.isEditable || isNodeSelection(state.selection) || editor.view.dragging)
              return null
            return DecorationSet.create(state.doc, [
              Decoration.inline(state.selection.from, state.selection.to, { class: 'selection' }),
            ])
          },
        },
      }),
    ]
  },
})
