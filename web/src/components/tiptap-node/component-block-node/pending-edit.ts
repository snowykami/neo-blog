import type { Editor } from '@tiptap/react'

// 刚插入组件的编辑器：新节点视图挂载时消费，自动打开属性编辑弹窗
const pendingEdit = new WeakSet<Editor>()

export function markPendingComponentEdit(editor: Editor) {
  pendingEdit.add(editor)
}

export function consumePendingComponentEdit(editor: Editor): boolean {
  const pending = pendingEdit.has(editor)
  pendingEdit.delete(editor)
  return pending
}
