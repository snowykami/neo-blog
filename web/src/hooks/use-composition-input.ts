'use client'

import type * as React from 'react'
import { useState } from 'react'

type TextControl = HTMLInputElement | HTMLTextAreaElement

/**
 * 输入法友好的输入框绑定：值要经过异步链路写回时使用，例如 Tiptap 节点属性（NodeView 在微任务里才重新渲染）
 *
 * 直接 `value={外部值} onChange={写回}` 时，React 会在每次组字输入后先把输入框改回旧值、随后又改成新值，
 * 输入法的组字被打断，拼音中间态被当成文字提交（如「HHDHDR…tu'pian」）。这里：
 * - 输入框显示本地草稿，输入时同步更新，React 不会在组字中途改写输入框
 * - 组字期间只更新草稿，组字结束或普通输入时才调用 onCommit
 * - 外部值变化（撤销重做、协作同步）时同步到草稿；组字期间不覆盖，组字结束后以输入框内容为准
 *
 * 用法：`<input {...useCompositionInput(value, onCommit)} />`
 */
export function useCompositionInput<T extends TextControl = HTMLInputElement>(
  value: string,
  onCommit: (value: string) => void,
) {
  const [draft, setDraft] = useState(value)
  const [syncedValue, setSyncedValue] = useState(value)
  const [composing, setComposing] = useState(false)

  if (value !== syncedValue) {
    setSyncedValue(value)
    if (!composing)
      setDraft(value)
  }

  const commit = (next: string) => {
    if (next !== value)
      onCommit(next)
  }

  return {
    value: draft,
    onChange: (event: React.ChangeEvent<T>) => {
      const next = event.currentTarget.value
      setDraft(next)
      // 组字中的 input 事件 isComposing 为 true；Safari 在 compositionend 之后还会派发一次 isComposing 为 false 的 input
      if (!composing && !(event.nativeEvent as InputEvent).isComposing)
        commit(next)
    },
    onCompositionStart: () => setComposing(true),
    onCompositionEnd: (event: React.CompositionEvent<T>) => {
      setComposing(false)
      setDraft(event.currentTarget.value)
      commit(event.currentTarget.value)
    },
  }
}
