'use client'

import type { EditSession } from '@/models/edit-session'
import { LockIcon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

/**
 * 编辑会话被其他设备/窗口接管时的提示条，编辑器此时为只读
 */
export function EditSessionBanner({ holder, onTakeOver }: { holder: EditSession | null, onTakeOver: () => Promise<void> }) {
  const t = useTranslations('Console.post_edit')
  const format = useFormatter()
  const [taking, setTaking] = useState(false)

  const device = [holder?.browser, holder?.os].filter(Boolean).join(' · ') || t('edit_session_unknown_device')
  const description = holder
    ? t('edit_session_taken_over_by', {
        name: holder.user?.nickname || holder.user?.username || '-',
        device,
        time: format.dateTime(new Date(holder.startedAt), { dateStyle: 'short', timeStyle: 'short' }),
      })
    : t('edit_session_taken_over')

  return (
    <div role="alert" className="mt-3 flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 md:flex-row md:items-center md:justify-between dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
      <div className="flex items-start gap-3">
        <LockIcon className="mt-0.5 size-4 shrink-0" />
        <div className="grid gap-1">
          <span>{description}</span>
          <span className="text-xs opacity-80">{t('edit_session_take_over_hint')}</span>
        </div>
      </div>
      <Button
        size="sm"
        disabled={taking}
        onClick={() => {
          setTaking(true)
          onTakeOver().finally(() => setTaking(false))
        }}
      >
        {t('edit_session_take_over')}
      </Button>
    </div>
  )
}
