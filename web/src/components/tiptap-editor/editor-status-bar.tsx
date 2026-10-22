'use client'

import type { Editor } from '@tiptap/react'
import type { EditSessionStatus } from '@/hooks/use-edit-session'
import { useFormatter, useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { useEditorStats } from './use-editor-stats'
import { useEditorToolbarState } from './use-editor-toolbar-state'

const SESSION_DOT: Record<EditSessionStatus, string> = {
  acquiring: 'bg-muted-foreground/50 animate-pulse',
  active: 'bg-emerald-500 shadow-[0_0_0_3px] shadow-emerald-500/20',
  taken_over: 'bg-amber-500 shadow-[0_0_0_3px] shadow-amber-500/20',
  error: 'bg-muted-foreground/50',
}

/**
 * 底部状态栏：字数 / 预计阅读 / 当前块类型 / 编辑会话状态
 */
export function EditorStatusBar({ editor, sessionStatus, className }: { editor: Editor, sessionStatus: EditSessionStatus, className?: string }) {
  const t = useTranslations('Console.editor')
  const format = useFormatter()
  const { words, readingMinutes } = useEditorStats(editor)
  const state = useEditorToolbarState(editor)

  let blockLabel: string
  if (state.selectedNode)
    blockLabel = t.has(`node.${state.selectedNode}`) ? t(`node.${state.selectedNode}`) : t('node.block')
  else if (state.inCodeBlock)
    blockLabel = t('status_code_block', { language: state.codeLanguage || 'plaintext' })
  else
    blockLabel = t(`block.${state.blockType}`)

  return (
    <footer
      className={cn(
        'sticky bottom-0 z-20 flex h-8 shrink-0 items-center gap-3.5 border-t bg-background/85 px-4 text-xs whitespace-nowrap text-muted-foreground tabular-nums backdrop-blur-md md:gap-4',
        className,
      )}
    >
      <span>{t('status_words', { count: format.number(words) })}</span>
      <span>{t('status_reading', { count: readingMinutes })}</span>
      <span className="hidden md:inline">{t('status_block', { type: blockLabel })}</span>
      <span className="flex-1" />
      <span className="inline-flex items-center gap-2" aria-live="polite">
        <span aria-hidden="true" className={cn('size-[7px] rounded-full', SESSION_DOT[sessionStatus])} />
        <span className="hidden sm:inline">{t(`session_${sessionStatus}`)}</span>
      </span>
    </footer>
  )
}
