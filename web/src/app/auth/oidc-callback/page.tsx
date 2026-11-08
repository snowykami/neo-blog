'use client'

import { useTranslations } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import { notifyOidcPopupDone } from '@/components/auth/oidc-popup'
import { Spinner } from '@/components/ui/spinner'

/**
 * 第三方登录小窗的落点（见 components/auth/oidc-popup.ts）：Cookie 已经由后端写好，
 * 这里通知打开它的页面、然后关窗；不是小窗打开时（直接访问）回到首页。
 */
export default function Page() {
  const t = useTranslations('Login')
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectBack = searchParams.get('redirect_back') || '/'

  useEffect(() => {
    if (notifyOidcPopupDone()) {
      window.close()
      return
    }
    router.replace(redirectBack)
  }, [router, redirectBack])

  return (
    <div className="text-muted-foreground flex items-center justify-center gap-2 text-sm">
      <Spinner />
      {t('logging')}
    </div>
  )
}
