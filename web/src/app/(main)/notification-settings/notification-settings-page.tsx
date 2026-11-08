'use client'

import type { NotificationPreferences } from '@/models/notification'
import { BellRing } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { getNotificationPreferences } from '@/api/notification'
import { useLoginDialog } from '@/components/auth/login-dialog'
import { NotificationPreferencesForm } from '@/components/notification/notification-preferences-form'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/contexts/auth-context'

/**
 * 通知设置页：站内与邮件通知的开关统一在这里管理（/console/user-preference 只放引导）。
 * 未登录时只显示提示与登录按钮，不渲染表单——避免出现点不动的开关
 */
export function NotificationSettingsPage() {
  const t = useTranslations('NotificationSettings')
  const { user } = useAuth()
  const openLogin = useLoginDialog()
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!user) {
      setPreferences(null)
      return
    }
    setLoading(true)
    getNotificationPreferences().then((res) => {
      setPreferences(res.data)
    }).catch(() => {
      toast.error(t('load_failed'))
    }).finally(() => {
      setLoading(false)
    })
  }, [user, t])

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <div className="mb-5 grid gap-1">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground text-sm text-balance">{t('description')}</p>
      </div>

      {!user
        ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BellRing />
                </EmptyMedia>
                <EmptyTitle>{t('title')}</EmptyTitle>
                <EmptyDescription>{t('login_required')}</EmptyDescription>
              </EmptyHeader>
              <Button type="button" onClick={() => openLogin({})}>
                {t('login')}
              </Button>
            </Empty>
          )
        : loading || !preferences
          ? (
              <div className="grid gap-4">
                <Skeleton className="h-40 w-full rounded-xl" />
                <Skeleton className="h-32 w-full rounded-xl" />
              </div>
            )
          : <NotificationPreferencesForm initial={preferences} />}
    </div>
  )
}
