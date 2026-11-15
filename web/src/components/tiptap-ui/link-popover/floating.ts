'use client'

import type { Editor } from '@tiptap/react'
import { posToDOMRect } from '@tiptap/react'
import * as React from 'react'

// 浮层标记：焦点位于带此属性的元素内时，气泡菜单不会因编辑器失焦而隐藏
export const EDITOR_FLOATING_ATTR = 'data-editor-floating'

/** 当前选区的虚拟锚点，供弹层定位到选中文字下方 */
export function useSelectionAnchor(editor: Editor | null) {
  return React.useMemo(() => ({
    current: {
      getBoundingClientRect: () => {
        if (!editor || editor.isDestroyed)
          return new DOMRect()
        const { from, to } = editor.state.selection
        return posToDOMRect(editor.view, from, to)
      },
    },
  }), [editor])
}
