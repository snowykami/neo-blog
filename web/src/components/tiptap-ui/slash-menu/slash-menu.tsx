'use client'

import type { SlashCommandItem } from '@/components/tiptap-extension/slash-command-extension'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { cn } from '@/lib/utils'

export interface SlashMenuProps {
  items: SlashCommandItem[]
  query: string
  onSelect: (item: SlashCommandItem) => void
}

export interface SlashMenuHandle {
  onKeyDown: (event: KeyboardEvent) => boolean
}

/**
 * 斜杠命令面板：分组展示，↑↓ 选择、Enter / Tab 确认（Esc 由 suggestion 插件处理）
 */
export function SlashMenu({ items, query, onSelect, ref }: SlashMenuProps & { ref?: React.Ref<SlashMenuHandle> }) {
  const t = useTranslations('Console.editor')
  const [index, setIndex] = React.useState(0)
  const listRef = React.useRef<HTMLDivElement>(null)

  // 输入变化时回到第一项
  const [lastQuery, setLastQuery] = React.useState(query)
  if (lastQuery !== query) {
    setLastQuery(query)
    setIndex(0)
  }
  const safeIndex = Math.min(index, Math.max(0, items.length - 1))

  // 选中项滚动到可见：只滚动面板自己的列表。不用 scrollIntoView：面板由 suggestion 插件先挂到 body 末尾、随后才定位，
  // 这期间 scrollIntoView 会把整个页面滚到底部（输入「/music」等时编辑器跳到文末）
  React.useEffect(() => {
    const list = listRef.current
    const option = list?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!list || !option)
      return
    const top = option.offsetTop
    const bottom = top + option.offsetHeight
    if (top < list.scrollTop)
      list.scrollTop = top
    else if (bottom > list.scrollTop + list.clientHeight)
      list.scrollTop = bottom - list.clientHeight
  }, [safeIndex, items])

  React.useImperativeHandle(ref, () => ({
    onKeyDown: (event) => {
      if (event.isComposing)
        return false
      if (event.key === 'ArrowDown') {
        if (items.length)
          setIndex((safeIndex + 1) % items.length)
        return true
      }
      if (event.key === 'ArrowUp') {
        if (items.length)
          setIndex((safeIndex - 1 + items.length) % items.length)
        return true
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = items[safeIndex]
        if (!item)
          return false
        onSelect(item)
        return true
      }
      return false
    },
  }), [items, safeIndex, onSelect])

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label={t('slash.aria')}
      className="bg-popover text-popover-foreground relative w-72 max-w-[calc(100vw-1rem)] max-h-80 overflow-y-auto overscroll-contain rounded-xl border p-1 shadow-lg"
      // 保持编辑器焦点与选区
      onMouseDown={e => e.preventDefault()}
    >
      {items.length === 0
        ? <div className="px-3 py-4 text-center text-sm text-muted-foreground">{t('slash.empty')}</div>
        : items.map((item, i) => {
            const showGroup = i === 0 || items[i - 1].group !== item.group
            const Icon = item.icon
            const selected = i === safeIndex
            return (
              <React.Fragment key={item.id}>
                {showGroup && <div className="px-2.5 pt-2 pb-1 text-xs font-medium text-muted-foreground first:pt-1">{item.group}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors',
                    selected && 'bg-accent',
                  )}
                  onMouseMove={() => i !== safeIndex && setIndex(i)}
                  onClick={() => onSelect(item)}
                >
                  <span
                    className={cn(
                      'grid size-8 shrink-0 place-items-center rounded-lg border bg-card text-muted-foreground',
                      selected && 'border-primary/40 text-primary',
                    )}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm leading-tight">{item.title}</span>
                    <span className="block truncate text-xs leading-tight text-muted-foreground">{item.hint}</span>
                  </span>
                </button>
              </React.Fragment>
            )
          })}
      <div className="mt-1 flex gap-3 border-t px-2.5 pt-1.5 pb-1 text-[11px] text-muted-foreground/70">
        <span>{t('slash.nav_select')}</span>
        <span>{t('slash.nav_confirm')}</span>
        <span>{t('slash.nav_close')}</span>
      </div>
    </div>
  )
}
