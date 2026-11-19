'use client'

import type { Editor } from '@tiptap/react'
import type { EditSessionStatus } from '@/hooks/use-edit-session'
import { useFormatter, useTranslations } from 'next-intl'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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
 * 隔离字数/阅读时长统计叶子组件，避免打字防抖更新触发状态栏外层重渲染
 */
function EditorStatusStats({ editor }: { editor: Editor }) {
  const t = useTranslations('Console.editor')
  const format = useFormatter()
  const { words, readingMinutes } = useEditorStats(editor)

  return (
    <>
      <span>{t('status_words', { count: format.number(words) })}</span>
      <span>{t('status_reading', { count: readingMinutes })}</span>
    </>
  )
}

/**
 * 底部状态栏：字数 / 预计阅读 / 当前块类型 / 编辑会话状态
 */
export function EditorStatusBar({ editor, sessionStatus, className }: { editor: Editor, sessionStatus: EditSessionStatus, className?: string }) {
  const t = useTranslations('Console.editor')
  const state = useEditorToolbarState(editor)

  let blockLabel: string
  if (state.selectedNode)
    blockLabel = t.has(`node.${state.selectedNode}`) ? t(`node.${state.selectedNode}`) : t('node.block')
  else if (state.inCodeBlock)
    blockLabel = t('status_code_block', { language: state.codeLanguage || 'plaintext' })
  else
    blockLabel = t(`block.${state.blockType}`)

  const sessionLabel = t(`session_${sessionStatus}`)

  return (
    <footer
      className={cn(
        'sticky bottom-0 z-20 flex h-8 shrink-0 items-center gap-3.5 border-t bg-background/85 px-4 text-xs whitespace-nowrap text-muted-foreground tabular-nums backdrop-blur-md md:gap-4',
        className,
      )}
    >
      <EditorStatusStats editor={editor} />
      <span className="hidden md:inline">{t('status_block', { type: blockLabel })}</span>
      <span className="flex-1" />
      <div className="inline-flex items-center" aria-live="polite">
        {/* 移动端点击状态点可弹出完整说明，并附带可访问 aria-label 与原生 title */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={sessionLabel}
              title={sessionLabel}
              className="inline-flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:hidden"
            >
              <span aria-hidden="true" className={cn('size-[7px] rounded-full', SESSION_DOT[sessionStatus])} />
              <span className="sr-only">{sessionLabel}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" sideOffset={6} className="w-auto rounded-lg px-2.5 py-1.5 text-xs">
            {sessionLabel}
          </PopoverContent>
        </Popover>
        <span className="hidden items-center gap-2 sm:inline-flex">
          <span aria-hidden="true" className={cn('size-[7px] rounded-full', SESSION_DOT[sessionStatus])} />
          <span>{sessionLabel}</span>
        </span>
      </div>
    </footer>
  )
}
