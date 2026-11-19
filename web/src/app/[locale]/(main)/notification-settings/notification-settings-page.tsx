'use client'

import type { NotificationPreferences } from '@/models/notification'
import { ArrowLeft, BellRing } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { getNotificationPreferences } from '@/api/notification'
import { useLoginDialog } from '@/components/auth/login-dialog'
import { SectionTitle } from '@/components/layout/site-shell'
import { NotificationPreferencesForm } from '@/components/notification/notification-preferences-form'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/contexts/auth-context'
import { useErrorMessageT } from '@/hooks/use-translations'
import { Link } from '@/i18n/navigation'
import { mainPath } from '@/utils/common/route'

// 邮件里的免登录凭据：只从地址栏读一次，不写进任何全局状态
function readTokenFromUrl(): string {
  if (typeof window === 'undefined')
    return ''
  return new URLSearchParams(window.location.search).get('token')?.trim() ?? ''
}

/**
 * 通知设置页：站内与邮件通知的开关统一在这里管理（/console/user-preference 只放引导）。
 * 三种访问态：已登录（cookie）、邮件里的 token（受限身份）、未登录且无 token（只显示提示与登录按钮）
 */
export function NotificationSettingsPage() {
  const t = useTranslations('NotificationSettings')
  const notificationsT = useTranslations('Notifications')
  const errorMessageT = useErrorMessageT()
  const { user, loading: authLoading } = useAuth()
  const openLogin = useLoginDialog()
  const [token, setToken] = useState('')
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'expired' | 'anonymous'>('loading')

  useEffect(() => {
    setToken(readTokenFromUrl())
  }, [])

  useEffect(() => {
    // 登录状态在浏览器里确认，确认前保持加载状态
    if (authLoading)
      return
    let cancelled = false
    // 已登录时以登录身份为准；没有登录时用一次性凭据
    const useToken = user ? '' : token
    if (!user && !useToken) {
      setPreferences(null)
      setStatus('anonymous')
      return
    }
    setStatus('loading')
    getNotificationPreferences({ token: useToken }).then((res) => {
      if (cancelled)
        return
      setPreferences(res.data)
      setStatus('ready')
    }).catch((error) => {
      if (cancelled)
        return
      // 凭据过期或被改坏：提示登录后继续，不把页面顶到登录页
      setStatus(user ? 'anonymous' : 'expired')
      toast.error(`${t('load_failed')}: ${errorMessageT(error)}`)
    })
    return () => {
      cancelled = true
    }
  }, [authLoading, errorMessageT, user, token, t])

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <div className="mb-5 grid gap-2">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground hover:text-foreground">
            <Link href={mainPath.notifications}>
              <ArrowLeft className="size-4" aria-hidden />
              {notificationsT('title')}
            </Link>
          </Button>
        </div>
        <SectionTitle as="h1" className="text-xl md:text-2xl">{t('title')}</SectionTitle>
        <p className="pl-4 text-sm text-balance text-muted-foreground">{t('description')}</p>
      </div>

      {status === 'loading'
        ? (
            <div className="grid gap-4">
              <Skeleton className="h-40 w-full rounded-2xl" />
              <Skeleton className="h-32 w-full rounded-2xl" />
            </div>
          )
        : status === 'ready' && preferences
          ? <NotificationPreferencesForm initial={preferences} token={user ? undefined : token} />
          : (
              <Empty className="surface-card rounded-2xl bg-card">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <BellRing />
                  </EmptyMedia>
                  <EmptyTitle>{t('title')}</EmptyTitle>
                  <EmptyDescription>
                    {status === 'expired' ? t('token_expired') : t('login_required')}
                  </EmptyDescription>
                </EmptyHeader>
                <Button type="button" onClick={() => openLogin({})}>
                  {t('login')}
                </Button>
              </Empty>
            )}
    </div>
  )
}
