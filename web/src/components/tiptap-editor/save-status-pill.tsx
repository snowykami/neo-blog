'use client'

import type { SaveState } from '@/hooks/use-content-editor'
import { CircleAlertIcon, CloudCheckIcon, LoaderCircleIcon, LockIcon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import * as React from 'react'
import { cn } from '@/lib/utils'
import { EditorTooltip } from './editor-toolbar-button'

const MINUTE = 60
const HOUR = 60 * MINUTE

/** “已保存 · N 秒前”：1 分钟内按秒、1 小时内按分钟，更久显示具体时间；每秒刷新 */
function useSavedText(time: Date | null) {
  const t = useTranslations('Console.editor')
  const format = useFormatter()
  const [now, setNow] = React.useState(() => Date.now())

  React.useEffect(() => {
    if (!time)
      return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [time])

  if (!time)
    return t('save_saved')
  const seconds = Math.max(0, Math.floor((now - time.getTime()) / 1000))
  if (seconds < 5)
    return t('save_saved_just_now')
  if (seconds < MINUTE)
    return t('save_saved_seconds_ago', { count: seconds })
  if (seconds < HOUR)
    return t('save_saved_minutes_ago', { count: Math.floor(seconds / MINUTE) })
  const isToday = new Date(now).toDateString() === time.toDateString()
  return t('save_saved_at', { time: format.dateTime(time, isToday ? { timeStyle: 'short' } : { dateStyle: 'medium', timeStyle: 'short' }) })
}

/**
 * 保存状态胶囊：未保存 / 保存中… / 已保存 · N 秒前 / 保存失败 / 只读；点击立即保存
 */
export function SaveStatusPill({
  state,
  lastSavedAt,
  error,
  readOnly,
  onSave,
}: {
  state: SaveState
  lastSavedAt: Date | null
  error: string | null
  readOnly: boolean
  onSave: () => void
}) {
  const t = useTranslations('Console.editor')
  const savedText = useSavedText(lastSavedAt)

  let icon: React.ReactNode
  let text: string
  if (readOnly) {
    icon = <LockIcon className="size-3.5" />
    text = t('save_readonly')
  }
  else if (state === 'saving') {
    icon = <LoaderCircleIcon className="size-3.5 animate-spin" />
    text = t('save_saving')
  }
  else if (state === 'error') {
    icon = <CircleAlertIcon className="size-3.5 text-destructive" />
    text = t('save_error')
  }
  else if (state === 'dirty') {
    icon = <span className="size-[7px] rounded-full bg-amber-500" />
    text = t('save_dirty')
  }
  else {
    icon = <CloudCheckIcon className="size-[15px] text-emerald-600 dark:text-emerald-400" />
    text = state === 'saved' ? savedText : t('save_saved')
  }

  return (
    <EditorTooltip label={error && state === 'error' ? error : t('save_now')} shortcut={readOnly ? undefined : 'mod+s'}>
      <button
        type="button"
        aria-live="polite"
        aria-label={text}
        disabled={readOnly}
        onClick={onSave}
        data-state={state}
        className={cn(
          'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] whitespace-nowrap text-muted-foreground tabular-nums transition-colors',
          'hover:bg-accent hover:text-foreground/80 disabled:pointer-events-none',
          state === 'error' && 'text-destructive',
        )}
      >
        <span className="grid size-4 place-items-center">{icon}</span>
        <span className="hidden sm:inline">{text}</span>
      </button>
    </EditorTooltip>
  )
}
