'use client'

import type { Editor } from '@tiptap/react'
import type { AIWriterController } from './use-ai-writer'
import type { AIPreset } from '@/models/ai-write'
import { posToDOMRect } from '@tiptap/react'
import { CheckIcon, PencilLineIcon, RotateCcwIcon, SparklesIcon, SquareIcon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { InfoTooltip } from '@/components/common/info-tooltip'
import { EDITOR_FLOATING_ATTR } from '@/components/tiptap-ui/link-popover/link-popover'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Label } from '@/components/ui/label'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { AI_REWRITE_PRESETS, AI_WRITE_PRESETS } from '@/models/ai-write'
import { formatShortcut } from './editor-commands'
import { AI_WRITER_BUSY_STATUSES } from './use-ai-writer'

const isComposing = (event: React.KeyboardEvent) => event.nativeEvent.isComposing || event.keyCode === 229

/**
 * AI 写作面板：贴在生成位置下方，宽度与正文列一致
 * 输入要求 → 生成中（可停止）→ 接受 / 重新生成 / 修改要求 / 放弃；出错时可重试
 * 生成中与等待确认时点击外部不会关闭，Esc 依次为：取消输入 / 停止生成 / 放弃结果
 */
export function EditorAIPanel({ editor, writer }: { editor: Editor, writer: AIWriterController }) {
  const t = useTranslations('Console.editor.ai')
  const { state } = writer
  const open = state.status !== 'idle'
  const busy = AI_WRITER_BUSY_STATUSES.includes(state.status)
  const [draft, setDraft] = React.useState('')
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const contextSwitchId = React.useId()
  const acceptRef = React.useRef<HTMLButtonElement>(null)
  const stopRef = React.useRef<HTMLButtonElement>(null)

  // 定位到生成范围，横向与正文列对齐
  const getRangeRef = React.useRef(writer.getRange)
  getRangeRef.current = writer.getRange
  const anchor = React.useMemo(() => ({
    current: {
      getBoundingClientRect: () => {
        const range = getRangeRef.current()
        if (!range || editor.isDestroyed)
          return new DOMRect()
        const column = editor.view.dom.getBoundingClientRect()
        const rect = posToDOMRect(editor.view, range.from, range.to)
        return new DOMRect(column.left, rect.top, column.width, rect.height)
      },
    },
  }), [editor])

  // 进入输入状态时回填要求并聚焦输入框；生成中聚焦“停止”，完成后聚焦“接受”
  const { status, instruction } = state
  React.useEffect(() => {
    if (status === 'prompting') {
      setDraft(instruction)
      // 从下拉菜单 / 右键菜单打开时，菜单关闭会再移动一次焦点：先聚焦一次，菜单关闭后再补一次
      const focusInput = () => {
        const el = textareaRef.current
        if (!el || document.activeElement === el)
          return
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      }
      const timers = [0, 120].map(delay => window.setTimeout(focusInput, delay))
      return () => timers.forEach(timer => window.clearTimeout(timer))
    }
    else if (status === 'done') {
      acceptRef.current?.focus()
    }
    else if (status === 'connecting') {
      stopRef.current?.focus()
    }
  }, [status, instruction])

  const submit = (preset?: AIPreset) => {
    void writer.run({ preset, instruction: preset ? '' : draft.trim() })
  }

  const handleEscape = () => {
    if (busy)
      writer.stop()
    else
      writer.discard()
  }

  const isRewrite = state.mode === 'rewrite'
  const presets: readonly AIPreset[] = isRewrite ? AI_REWRITE_PRESETS : AI_WRITE_PRESETS
  const requestLabel = state.instruction.trim()
    || (state.preset ? t(`preset.${state.preset}`) : t(isRewrite ? 'default_rewrite' : 'default_write'))
  const statusText = state.status === 'done'
    ? (state.stopped ? t('status_stopped') : t('status_done'))
    : busy ? t(`status_${state.status}`) : null

  return (
    <Popover open={open}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        {...{ [EDITOR_FLOATING_ATTR]: '' }}
        role="dialog"
        aria-label={t(isRewrite ? 'rewrite' : 'write')}
        side="bottom"
        align="start"
        sideOffset={10}
        collisionPadding={8}
        sticky="always"
        hideWhenDetached={false}
        // 生成中内容不断变化，持续更新位置
        updatePositionStrategy="always"
        style={{ width: 'min(var(--radix-popper-anchor-width), 42rem)' }}
        className="grid max-w-[calc(100vw-1rem)] gap-2.5 rounded-xl p-3 shadow-lg"
        onOpenAutoFocus={event => event.preventDefault()}
        onCloseAutoFocus={event => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          event.preventDefault()
          handleEscape()
        }}
        // 焦点移出（如菜单关闭后焦点回到编辑器）不关闭面板，否则从菜单打开时会一闪而过
        onFocusOutside={event => event.preventDefault()}
        onInteractOutside={event => event.preventDefault()}
        onPointerDownOutside={() => {
          // 只有输入要求时点击外部视为取消，生成中与等待确认时保留面板，避免误操作丢失结果
          if (state.status === 'prompting' && !writer.hasPreview())
            writer.discard()
        }}
        onKeyDown={(event) => {
          if (state.status === 'done' && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            writer.accept()
          }
        }}
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground/80">
          <SparklesIcon className="size-4 text-primary" />
          <span>{t(isRewrite ? 'rewrite' : 'write')}</span>
          {statusText && (
            <span className="ml-auto flex min-w-0 items-center gap-1.5 text-xs font-normal text-muted-foreground" aria-live="polite">
              {busy && <Spinner className="size-3.5" />}
              <span className="truncate">{statusText}</span>
            </span>
          )}
        </div>

        {state.status === 'prompting' && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {presets.map(preset => (
                <Button key={preset} type="button" size="sm" variant="outline" className="h-7 rounded-full px-2.5 text-xs" onClick={() => submit(preset)}>
                  {t(`preset.${preset}`)}
                </Button>
              ))}
            </div>
            <Textarea
              ref={textareaRef}
              rows={2}
              value={draft}
              aria-label={t('instruction')}
              placeholder={t(isRewrite ? 'rewrite_placeholder' : 'write_placeholder')}
              className="max-h-40 min-h-16 resize-none text-sm"
              onChange={e => setDraft(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !isComposing(event)) {
                  event.preventDefault()
                  submit()
                }
              }}
            />
            <p className="-mt-1 hidden text-xs text-muted-foreground sm:block">{t('hint_prompt')}</p>
            <div className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <Switch id={contextSwitchId} checked={writer.includeContext} onCheckedChange={writer.setIncludeContext} />
                <Label htmlFor={contextSwitchId} className="truncate text-xs font-normal text-muted-foreground">{t('include_context')}</Label>
                <InfoTooltip content={t(isRewrite ? 'include_context_hint_rewrite' : 'include_context_hint_write')} />
              </div>
              <Button type="button" size="sm" variant="outline" onClick={writer.discard}>{t('cancel')}</Button>
              <Button type="button" size="sm" onClick={() => submit()}>
                <SparklesIcon />
                {t('generate')}
              </Button>
            </div>
          </>
        )}

        {state.status !== 'prompting' && (
          <p className="line-clamp-2 text-sm text-muted-foreground">{requestLabel}</p>
        )}

        {state.status === 'error' && (
          <p role="alert" className="text-sm text-destructive">{`${t('failed')}: ${state.error}`}</p>
        )}

        {busy && (
          <div className="flex items-center justify-end gap-2">
            <Button ref={stopRef} type="button" size="sm" variant="outline" onClick={writer.stop}>
              <SquareIcon className="fill-current" />
              {t('stop')}
              <Kbd>Esc</Kbd>
            </Button>
          </div>
        )}

        {(state.status === 'done' || state.status === 'error') && (
          <div className="flex flex-wrap items-center gap-2">
            {state.status === 'done' && (
              <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground sm:block">
                {t('hint_done', { shortcut: formatShortcut('mod+z') })}
              </span>
            )}
            <span className={cn('flex-1', state.status === 'done' && 'sm:hidden')} />
            <Button type="button" size="sm" variant="ghost" onClick={writer.discard}>
              <XIcon />
              {state.status === 'done' ? t('discard') : t('close')}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={writer.edit}>
              <PencilLineIcon />
              {t('edit')}
            </Button>
            <Button type="button" size="sm" variant={state.status === 'done' ? 'outline' : 'default'} onClick={writer.retry}>
              <RotateCcwIcon />
              {state.status === 'done' ? t('retry') : t('retry_error')}
            </Button>
            {state.status === 'done' && (
              <Button ref={acceptRef} type="button" size="sm" onClick={writer.accept}>
                <CheckIcon />
                {t('accept')}
              </Button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
