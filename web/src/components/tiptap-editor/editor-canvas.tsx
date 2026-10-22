'use client'

import type { Editor } from '@tiptap/react'
import { EditorContent } from '@tiptap/react'
import * as React from 'react'
import { cn } from '@/lib/utils'
import { EditorBlockHandle } from './editor-block-handle'

/** 文本框自动增高 */
function useAutoGrow(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el)
      return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [ref, value])
}

const isComposing = (event: React.KeyboardEvent) => event.nativeEvent.isComposing || event.keyCode === 229

function focusEnd(el: HTMLTextAreaElement | null) {
  if (!el)
    return
  el.focus()
  el.setSelectionRange(el.value.length, el.value.length)
}

export interface EditorCanvasProps {
  editor: Editor
  title: string
  description: string
  onTitleChange: (title: string) => void
  onDescriptionChange: (description: string) => void
  titlePlaceholder: string
  descriptionPlaceholder: string
  titleLabel: string
  descriptionLabel: string
  readOnly: boolean
  // 标题下方的元信息行（分类 · 日期等）
  metaLine?: React.ReactNode
  className?: string
}

/**
 * 写作画布：标题（自动增高）、一句话摘要与正文，居中约 720px 的内容列
 * 标题回车 / ↓ 进入摘要，摘要回车 / ↓ 进入正文，正文开头按 ↑ 回到摘要
 */
export function EditorCanvas({
  editor,
  title,
  description,
  onTitleChange,
  onDescriptionChange,
  titlePlaceholder,
  descriptionPlaceholder,
  titleLabel,
  descriptionLabel,
  readOnly,
  metaLine,
  className,
}: EditorCanvasProps) {
  const titleRef = React.useRef<HTMLTextAreaElement>(null)
  const descRef = React.useRef<HTMLTextAreaElement>(null)
  useAutoGrow(titleRef, title)
  useAutoGrow(descRef, description)

  // 窗口宽度变化时重新计算高度
  React.useEffect(() => {
    const onResize = () => {
      for (const el of [titleRef.current, descRef.current]) {
        if (!el)
          continue
        el.style.height = 'auto'
        el.style.height = `${el.scrollHeight}px`
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 正文开头按 ↑ 回到摘要输入框
  React.useEffect(() => {
    const dom = editor.view.dom
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowUp' || event.shiftKey || event.isComposing)
        return
      const { selection } = editor.state
      if (selection.empty && selection.from <= 1) {
        event.preventDefault()
        focusEnd(descRef.current)
      }
    }
    dom.addEventListener('keydown', onKeyDown)
    return () => dom.removeEventListener('keydown', onKeyDown)
  }, [editor])

  return (
    // 使用 div 而非 article：前台文章样式中有针对 article 的全局规则（透明背景等）
    <div
      className={cn(
        'relative mx-auto w-full max-w-[54rem] rounded-xl bg-card px-5 pt-8 pb-18 transition-colors md:rounded-2xl md:px-[72px] md:pt-14 md:pb-24',
        className,
      )}
    >
      <textarea
        ref={titleRef}
        rows={1}
        value={title}
        readOnly={readOnly}
        aria-label={titleLabel}
        placeholder={titlePlaceholder}
        onChange={e => onTitleChange(e.target.value.replace(/\n/g, ' '))}
        onKeyDown={(event) => {
          const el = event.currentTarget
          if ((event.key === 'Enter' && !isComposing(event)) || (event.key === 'ArrowDown' && el.selectionStart === el.value.length)) {
            event.preventDefault()
            descRef.current?.focus()
          }
        }}
        className="block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-[1.75rem] leading-[1.3] font-bold tracking-tight text-foreground/90 outline-none placeholder:text-foreground/30 md:text-[2.25rem]"
      />
      <textarea
        ref={descRef}
        rows={1}
        value={description}
        readOnly={readOnly}
        aria-label={descriptionLabel}
        placeholder={descriptionPlaceholder}
        onChange={e => onDescriptionChange(e.target.value.replace(/\n/g, ' '))}
        onKeyDown={(event) => {
          const el = event.currentTarget
          if ((event.key === 'Enter' && !isComposing(event)) || (event.key === 'ArrowDown' && el.selectionStart === el.value.length)) {
            event.preventDefault()
            editor.commands.focus('start')
          }
          else if (event.key === 'ArrowUp' && el.selectionStart === 0) {
            event.preventDefault()
            focusEnd(titleRef.current)
          }
        }}
        className="mt-3 block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-[1.05rem] leading-relaxed text-foreground/55 outline-none placeholder:text-foreground/30"
      />
      {metaLine && (
        <div className="mt-[18px] flex items-center gap-2.5 text-[13px] text-muted-foreground">
          <span aria-hidden="true" className="h-3.5 w-1 rounded-full bg-primary" />
          {metaLine}
        </div>
      )}
      <div className="relative mt-7">
        <EditorContent editor={editor} role="presentation" className="neo-editor-root relative" />
        <EditorBlockHandle editor={editor} readOnly={readOnly} />
      </div>
    </div>
  )
}
