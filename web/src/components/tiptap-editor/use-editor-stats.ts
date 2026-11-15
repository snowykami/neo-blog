'use client'

import type { Node as PMNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'
import { useMemo, useSyncExternalStore } from 'react'
import { AI_PREVIEW_META } from '@/components/tiptap-extension/ai-write-extension'
import { readingTimeFromWords } from '@/utils/common/post'

const STATS_DEBOUNCE_MS = 120
const WHITESPACE_RUN_RE = /\s+/g

// ProseMirror 文档节点不可变，按 doc 引用缓存可让状态栏与顶栏共享一次遍历结果
const docWordCountCache = new WeakMap<PMNode, number>()

function countNonWhitespace(text: string): number {
  if (!text)
    return 0
  let whitespace = 0
  WHITESPACE_RUN_RE.lastIndex = 0
  let match: RegExpExecArray | null = WHITESPACE_RUN_RE.exec(text)
  while (match !== null) {
    whitespace += match[0].length
    match = WHITESPACE_RUN_RE.exec(text)
  }
  return text.length - whitespace
}

/**
 * 单次遍历 doc.descendants 计算非空白字符数，与 `doc.textContent.replace(/\s/g, '').length` 口径完全一致
 */
export function countDocWords(doc: PMNode): number {
  const cached = docWordCountCache.get(doc)
  if (cached !== undefined)
    return cached

  let words = 0
  doc.descendants((node) => {
    if (node.isText) {
      if (node.text)
        words += countNonWhitespace(node.text)
      return false
    }
    if (node.isLeaf) {
      const leafText = node.type.spec.leafText?.(node)
      if (leafText)
        words += countNonWhitespace(leafText)
      return false
    }
    return true
  })

  docWordCountCache.set(doc, words)
  return words
}

function isDocResetTransaction(transaction: Pick<Transaction, 'getMeta'>): boolean {
  return transaction.getMeta('addToHistory') === false && !transaction.getMeta(AI_PREVIEW_META)
}

const SERVER_SNAPSHOT = () => 0

function createEditorStatsStore(editor: Editor | null, debounceMs: number) {
  let words = editor ? countDocWords(editor.state.doc) : 0
  return {
    getSnapshot: () => words,
    subscribe: (onStoreChange: () => void) => {
      if (!editor)
        return () => {}

      let timer: ReturnType<typeof setTimeout> | null = null
      const recompute = () => {
        const next = countDocWords(editor.state.doc)
        if (next !== words) {
          words = next
          onStoreChange()
        }
      }

      // 挂载或绑定新编辑器实例时立即同步，防止 render 到 commit 之间文档已变化
      recompute()

      const handleTransaction = ({ transaction }: { transaction: Transaction }) => {
        if (!transaction.docChanged)
          return

        if (timer !== null) {
          clearTimeout(timer)
          timer = null
        }

        if (isDocResetTransaction(transaction)) {
          recompute()
          return
        }

        timer = setTimeout(() => {
          timer = null
          recompute()
        }, debounceMs)
      }

      editor.on('transaction', handleTransaction)
      return () => {
        if (timer !== null) {
          clearTimeout(timer)
          timer = null
        }
        editor.off('transaction', handleTransaction)
      }
    },
  }
}

/**
 * 正文字数与预计阅读时间，统计口径与前台文章页一致（去掉空白后的字符数，中文按字计）
 */
export function useEditorStats(editor: Editor | null, debounceMs = STATS_DEBOUNCE_MS) {
  const store = useMemo(() => createEditorStatsStore(editor, debounceMs), [editor, debounceMs])
  const words = useSyncExternalStore(store.subscribe, store.getSnapshot, SERVER_SNAPSHOT)
  return { words, readingMinutes: readingTimeFromWords(words) }
}
