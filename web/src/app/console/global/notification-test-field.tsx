'use client'

import { BellRing } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'
import { sendTestNotification } from '@/api/admin'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useErrorMessageT } from '@/hooks/use-translations'

/**
 * 给自己发一条测试通知：管理员不能读别人的通知，确认通知链路可用只需要在自己的通知列表里看到一条。
 * 测试通知只走站内，不发邮件、不受上面配置影响
 */
export function NotificationTestField() {
  const t = useTranslations('Console.global')
  const errorMessageT = useErrorMessageT()
  const [sending, setSending] = useState(false)

  const send = async () => {
    setSending(true)
    try {
      await sendTestNotification()
      toast.success(t('notification_test_success'))
    }
    catch (error) {
      toast.error(`${t('notification_test_failed')}: ${errorMessageT(error)}`)
    }
    finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-3">
      <div className="grid gap-1">
        <span className="text-sm font-medium">{t('notification_test')}</span>
        <span className="text-muted-foreground text-xs text-balance">{t('notification_test_desc')}</span>
      </div>
      <Button type="button" variant="outline" disabled={sending} onClick={() => void send()}>
        {sending ? <Spinner /> : <BellRing />}
        {t('notification_test_send')}
      </Button>
    </div>
  )
}
