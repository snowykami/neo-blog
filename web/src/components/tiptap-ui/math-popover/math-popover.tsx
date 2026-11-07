'use client'

import type { Editor } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import { ExternalLinkIcon, SigmaIcon, SquareSigmaIcon, Trash2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { formatShortcut } from '@/components/tiptap-editor/editor-commands'
import { BLOCK_MATH_NODE, isMathNode } from '@/components/tiptap-node/math-node/math-extension'
import { EDITOR_FLOATING_ATTR, useSelectionAnchor } from '@/components/tiptap-ui/link-popover/link-popover'
import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { isComposingKey } from '@/lib/ime'
import { renderLatex } from '@/lib/math/latex'

const KATEX_SYNTAX_URL = 'https://katex.org/docs/supported.html'

export interface MathPopoverProps {
  editor: Editor | null
  // 正在编辑的公式节点位置，null 为关闭
  pos: number | null
  onClose: () => void
}

/**
 * 公式编辑弹层：输入 LaTeX，下方实时预览
 * - 行内公式 Enter 应用，公式块 Ctrl/⌘ + Enter 应用（Enter 换行）；点击弹层外也会应用
 * - Esc 放弃修改；内容为空时应用即删除公式（新插入后直接放弃的空公式也会删除）
 */
export function MathPopover({ editor, pos, onClose }: MathPopoverProps) {
  const t = useTranslations('Console.editor')
  const anchor = useSelectionAnchor(editor)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const cancelRef = React.useRef(false)
  const [latex, setLatex] = React.useState('')
  // 已回填内容的公式位置：打开另一个公式时重新回填，编辑过程中不覆盖输入
  const [loadedPos, setLoadedPos] = React.useState<number | null>(null)

  const node = editor && pos != null && !editor.isDestroyed ? editor.state.doc.nodeAt(pos) : null
  const open = isMathNode(node)
  const display = node?.type.name === BLOCK_MATH_NODE
  const original: string = node?.attrs.latex ?? ''

  if (open && loadedPos !== pos) {
    setLoadedPos(pos)
    setLatex(original)
  }
  else if (!open && loadedPos !== null) {
    setLoadedPos(null)
  }

  const preview = React.useMemo(() => (open && latex.trim() ? renderLatex(latex, display) : ''), [open, latex, display])

  if (!editor)
    return null

  /** 写回公式（为空时删除）并把光标放到公式之后 */
  const commit = (value: string) => {
    if (pos == null || !isMathNode(editor.state.doc.nodeAt(pos)))
      return
    const current = editor.state.doc.nodeAt(pos)!
    const next = display ? value.trim() : value.replace(/\s*\n\s*/g, ' ').trim()
    const { tr } = editor.state
    if (next)
      tr.setNodeMarkup(pos, undefined, { ...current.attrs, latex: next })
    else
      tr.delete(pos, pos + current.nodeSize)
    const after = next ? pos + current.nodeSize : pos
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(after, tr.doc.content.size))))
    editor.view.dispatch(tr)
  }

  const apply = () => {
    commit(latex)
    onClose()
  }

  const remove = () => {
    commit('')
    onClose()
  }

  // 关闭：Esc 放弃修改（空公式删除），点击外部应用
  const handleOpenChange = (next: boolean) => {
    if (next)
      return
    const cancelled = cancelRef.current
    cancelRef.current = false
    if (cancelled) {
      if (!original.trim())
        commit('')
    }
    else {
      commit(latex)
    }
    onClose()
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        {...{ [EDITOR_FLOATING_ATTR]: '' }}
        align="start"
        sideOffset={8}
        className="grid w-[420px] max-w-[calc(100vw-1rem)] gap-3 rounded-xl p-3"
        onEscapeKeyDown={() => {
          cancelRef.current = true
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          const el = textareaRef.current
          if (el) {
            el.focus()
            el.setSelectionRange(el.value.length, el.value.length)
          }
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          editor.commands.focus()
        }}
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground/80">
          {display ? <SquareSigmaIcon className="size-4" /> : <SigmaIcon className="size-4" />}
          <span>{t(display ? 'math.block' : 'math.inline')}</span>
          <span className="flex-1" />
          <a
            href={KATEX_SYNTAX_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground hover:text-foreground"
          >
            {t('math.syntax')}
            <ExternalLinkIcon className="size-3" />
          </a>
        </div>
        <Textarea
          ref={textareaRef}
          value={latex}
          rows={display ? 4 : 2}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder={t('math.placeholder')}
          aria-label={t(display ? 'math.block' : 'math.inline')}
          className="font-mono text-sm"
          onChange={e => setLatex(e.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || isComposingKey(event))
              return
            // 行内公式不换行：Enter 即应用；公式块 Ctrl/⌘ + Enter 应用
            if (event.metaKey || event.ctrlKey || (!display && !event.shiftKey)) {
              event.preventDefault()
              apply()
            }
          }}
        />
        <div
          aria-live="polite"
          className="flex min-h-12 items-center justify-center overflow-x-auto rounded-lg border border-dashed bg-muted/30 px-3 py-2"
        >
          {preview
            ? <div className="max-w-full [&_.katex-display]:my-0" dangerouslySetInnerHTML={{ __html: preview }} />
            : <span className="text-xs text-muted-foreground">{t('math.preview_empty')}</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">
            {display ? t('math.hint_block', { shortcut: formatShortcut('mod+enter') }) : t('math.hint_inline')}
          </span>
          <span className="flex-1" />
          {original.trim() && (
            <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={remove}>
              <Trash2Icon />
              {t('math.remove')}
            </Button>
          )}
          <Button type="button" size="sm" disabled={!latex.trim()} onClick={apply}>{t('apply')}</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
