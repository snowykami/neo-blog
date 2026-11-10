'use client'

import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect } from 'react'
import { notifyOidcPopupDone } from '@/components/auth/oidc-popup'
import { Spinner } from '@/components/ui/spinner'
import { readRedirectBack } from '@/hooks/use-route'
import { useRouter } from '@/i18n/navigation'

/**
 * 第三方登录小窗的落点（见 components/auth/oidc-popup.ts）：Cookie 已经由后端写好，
 * 这里通知打开它的页面、然后关窗；不是小窗打开时（直接访问）回到首页。
 */
export default function Page() {
  // 读查询参数（redirect_back），包进 Suspense 页面才能预渲染；等待时显示同样的「登录中」
  return (
    <Suspense fallback={<Logging />}>
      <OidcCallback />
    </Suspense>
  )
}

function OidcCallback() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectBack = readRedirectBack(searchParams)

  useEffect(() => {
    if (notifyOidcPopupDone()) {
      window.close()
      return
    }
    router.replace(redirectBack)
  }, [router, redirectBack])

  return <Logging />
}

function Logging() {
  const t = useTranslations('Login')
  return (
    <div className="text-muted-foreground flex items-center justify-center gap-2 text-sm">
      <Spinner />
      {t('logging')}
    </div>
  )
}
