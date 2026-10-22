'use client'

import type { Editor } from '@tiptap/react'
import { useEditorState } from '@tiptap/react'
import { readingTimeFromWords } from '@/utils/common/post'

/**
 * 正文字数与预计阅读时间，统计口径与前台文章页一致（去掉空白后的字符数，中文按字计）
 */
export function useEditorStats(editor: Editor | null) {
  const words = useEditorState({
    editor,
    selector: ({ editor: ed }) => (ed ? ed.state.doc.textContent.replace(/\s/g, '').length : 0),
  }) ?? 0
  return { words, readingMinutes: readingTimeFromWords(words) }
}
