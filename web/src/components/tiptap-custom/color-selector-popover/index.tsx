'use client'

import type { Editor } from '@tiptap/react'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { EDITOR_FLOATING_ATTR } from '@/components/tiptap-ui/link-popover/link-popover'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useStoredState } from '@/hooks/use-storage-state'
import { cn } from '@/lib/utils'

const HISTORY_LIMIT = 8

// 颜色以 Tailwind 色板变量存储（前台同样可用），与旧版保持一致以兼容已有内容
function labelToTextColor(color: string): string {
  return `var(--color-${color}-500)`
}

function labelToHighlightColor(color: string): string {
  return `var(--color-${color}-200)`
}

interface ColorOption {
  label: string
  type: 'text' | 'background'
  color: string | null
}

const COLOR_NAMES = [
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
] as const

function toOption(name: string | null, type: ColorOption['type']): ColorOption {
  if (!name)
    return { label: 'default', type, color: null }
  return { label: name, type, color: type === 'text' ? labelToTextColor(name) : labelToHighlightColor(name) }
}

const TEXT_OPTIONS = [null, ...COLOR_NAMES].map(name => toOption(name, 'text'))
const HIGHLIGHT_OPTIONS = [null, ...COLOR_NAMES].map(name => toOption(name, 'background'))

export interface ColorPopoverProps {
  editor: Editor | null
  // 当前文字颜色 / 高亮颜色，用于标记选中项
  textColor: string | null
  highlightColor: string | null
  // 触发按钮（asChild）；不传时需提供 anchorRef，由外部控制打开
  children?: React.ReactElement
  anchorRef?: React.RefObject<HTMLElement | null>
  defaultOpen?: boolean
  onClosed?: () => void
  align?: 'start' | 'center' | 'end'
}

/**
 * 文字颜色与背景高亮面板：最近使用、可选“保持打开”以连续调整
 */
export function ColorPopover({ editor, textColor, highlightColor, children, anchorRef, defaultOpen = false, onClosed, align = 'start' }: ColorPopoverProps) {
  const t = useTranslations('Console.editor')
  const [open, setOpenState] = React.useState(defaultOpen)
  const setOpen = (next: boolean) => {
    setOpenState(next)
    if (!next)
      onClosed?.()
  }
  const [keepOpen, setKeepOpen] = useStoredState('editor-color-keep-open', false)
  const [history, setHistory] = useStoredState<ColorOption[]>('editor-color-selector-history', [])

  if (!editor)
    return children ?? null

  const colorName = (option: ColorOption) => option.color ? t(`colors.${option.label}`) : t('color_default')

  const apply = (option: ColorOption) => {
    // 记录历史：去重并提到最前
    if (option.color !== null) {
      const next = [option, ...history.filter(c => c.label !== option.label || c.type !== option.type)].slice(0, HISTORY_LIMIT)
      setHistory(next)
    }
    // 保持打开时不聚焦编辑器，避免弹层因失焦关闭
    const chain = keepOpen ? editor.chain() : editor.chain().focus()
    if (option.type === 'text') {
      if (option.color)
        chain.setColor(option.color).run()
      else
        chain.unsetColor().run()
    }
    else {
      if (option.color)
        chain.setHighlight({ color: option.color }).run()
      else
        chain.unsetHighlight().run()
    }
    if (!keepOpen)
      setOpen(false)
  }

  const isActive = (option: ColorOption) => option.type === 'text'
    ? (option.color ?? null) === (textColor ?? null)
    : (option.color ?? null) === (highlightColor ?? null)

  const renderSwatch = (option: ColorOption, key: string) => {
    const name = colorName(option)
    const label = option.type === 'text' ? t('text_color_named', { name }) : t('highlight_color_named', { name })
    return (
      <button
        key={key}
        type="button"
        title={name}
        aria-label={label}
        aria-pressed={isActive(option)}
        onClick={() => apply(option)}
        className={cn(
          'relative grid size-6 place-items-center rounded-md border text-[13px] font-semibold transition-shadow',
          'hover:ring-2 hover:ring-primary/30 aria-pressed:ring-2 aria-pressed:ring-primary',
          !option.color && 'text-muted-foreground bg-[repeating-linear-gradient(-45deg,transparent_0_4px,var(--border)_4px_5px)]',
        )}
        style={option.color ? (option.type === 'text' ? { color: option.color } : { backgroundColor: option.color }) : undefined}
      >
        {option.type === 'text' && 'A'}
      </button>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {children ? <PopoverTrigger asChild>{children}</PopoverTrigger> : anchorRef && <PopoverAnchor virtualRef={anchorRef as React.RefObject<HTMLElement>} />}
      <PopoverContent
        {...{ [EDITOR_FLOATING_ATTR]: '' }}
        align={align}
        sideOffset={6}
        className="grid w-auto max-w-[calc(100vw-1rem)] gap-3 rounded-xl p-3"
        onOpenAutoFocus={event => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          editor.commands.focus()
        }}
      >
        {history.length > 0 && (
          <section className="grid gap-2">
            <h4 className="text-xs font-medium text-muted-foreground">{t('color_history')}</h4>
            <div className="grid grid-cols-9 gap-1.5">
              {history.map((option, index) => renderSwatch(option, `history-${option.type}-${option.label}-${index}`))}
            </div>
          </section>
        )}
        <section className="grid gap-2">
          <h4 className="text-xs font-medium text-muted-foreground">{t('text_color')}</h4>
          <div className="grid grid-cols-9 gap-1.5">
            {TEXT_OPTIONS.map(option => renderSwatch(option, `text-${option.label}`))}
          </div>
        </section>
        <section className="grid gap-2">
          <h4 className="text-xs font-medium text-muted-foreground">{t('highlight_color')}</h4>
          <div className="grid grid-cols-9 gap-1.5">
            {HIGHLIGHT_OPTIONS.map(option => renderSwatch(option, `bg-${option.label}`))}
          </div>
        </section>
        <div className="flex items-center gap-2 border-t pt-2.5">
          <Checkbox id="editor-color-keep-open" checked={keepOpen} onCheckedChange={checked => setKeepOpen(checked === true)} />
          <Label htmlFor="editor-color-keep-open" className="text-xs font-normal text-muted-foreground">{t('color_keep_open')}</Label>
        </div>
      </PopoverContent>
    </Popover>
  )
}
