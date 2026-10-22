'use client'

import type { EditSession } from '@/models/edit-session'
import { LockIcon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * 编辑会话被其他设备/窗口接管时的提示条，编辑器此时为只读
 */
export function EditSessionBanner({ holder, onTakeOver, className }: { holder: EditSession | null, onTakeOver: () => Promise<void>, className?: string }) {
  const t = useTranslations('Console.post_edit')
  const editorT = useTranslations('Console.editor')
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
    <Alert className={cn('rounded-xl border-amber-500/30 bg-amber-500/8 text-amber-900 dark:text-amber-100', className)}>
      <LockIcon />
      <AlertTitle className="line-clamp-none">{editorT('session_taken_over_title')}</AlertTitle>
      <AlertDescription className="text-amber-900/80 dark:text-amber-100/80">
        <p>{description}</p>
        <p className="text-xs opacity-80">{t('edit_session_take_over_hint')}</p>
        <Button
          size="sm"
          className="mt-1.5"
          disabled={taking}
          onClick={() => {
            setTaking(true)
            onTakeOver().finally(() => setTaking(false))
          }}
        >
          {t('edit_session_take_over')}
        </Button>
      </AlertDescription>
    </Alert>
  )
}
