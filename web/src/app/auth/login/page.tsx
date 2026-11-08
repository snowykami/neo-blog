'use client'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { AuthHeader } from '@/components/auth/common/auth-header'
import { CurrentLogged } from '@/components/auth/common/current-logged'
import { LocalLoginForm } from '@/components/auth/local-login-form'
import { OidcProviderButtons, useOidcProviders } from '@/components/auth/oidc-providers'
import { SectionDivider } from '@/components/common/section-divider'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/contexts/auth-context'
import { registerPath } from '@/hooks/use-route'
import { useErrorMessageT } from '@/hooks/use-translations'
import { cn } from '@/lib/utils'
import { mainPath } from '@/utils/common/route'

export default function LoginPage() {
  return (
    <>
      <AuthHeader />
      <LoginForm />
    </>
  )
}

export function LoginForm({ className, ...props }: React.ComponentProps<'div'>) {
  const t = useTranslations('Login')
  const errorMessageT = useErrorMessageT()
  const { user, refresh } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const redirectBack = searchParams.get('redirect_back') || '/'
  // 第三方登录失败时后端带着错误码回到登录页
  const oidcLoginError = searchParams.get('oidc_error')
  const { providers, error: oidcError } = useOidcProviders()

  useEffect(() => {
    if (!oidcError)
      return
    // 使用本地化的后端错误文案，不直接展示 axios 原始错误信息
    const message = errorMessageT(oidcError)
    toast.error(t('fetch_oidc_configs_failed') + (message ? `: ${message}` : ''))
  }, [oidcError, t, errorMessageT])

  useEffect(() => {
    if (!oidcLoginError)
      return
    // 固定 id 避免重复提示；提示后从地址里去掉错误码，刷新页面不再提示
    toast.error(`${t('oidc_login_failed')}: ${errorMessageT(oidcLoginError)}`, { id: 'oidc-login-error' })
    const params = new URLSearchParams(searchParams)
    params.delete('oidc_error')
    router.replace(params.size ? `${pathname}?${params}` : pathname)
  }, [oidcLoginError, searchParams, pathname, router, t, errorMessageT])

  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">{t('welcome')}</CardTitle>
        </CardHeader>
        <CardContent>
          {user && <CurrentLogged />}
          {providers.length > 0 && (
            <SectionDivider className="mb-6">
              {user ? t('continue_bind_oidc') : t('with_oidc')}
            </SectionDivider>
          )}
          <div className="grid gap-4">
            {/* 第三方登录在小窗里完成（见 components/auth/oidc-popup.ts）；已登录时为绑定第三方账号 */}
            <OidcProviderButtons
              providers={providers}
              redirectBack={redirectBack}
              bind={!!user}
              mode="popup"
              className="gap-4"
              onLoggedIn={() => {
                refresh().then((current) => {
                  // 绑定场景本来已登录：刷新页面看到新绑定的账号；登录场景回到原页面
                  if (user)
                    window.location.reload()
                  else if (current)
                    router.replace(redirectBack)
                })
              }}
            />
            <SectionDivider className="my-2">
              {t('or_continue_with_local_account')}
            </SectionDivider>
            <LocalLoginForm onSuccess={() => router.push(redirectBack)} />
            {/* 注册链接 */}
            <div className="text-center text-sm">
              {t('no_account')}
              {' '}
              <Link
                href={`${registerPath}?redirect_back=${encodeURIComponent(redirectBack)}`}
                className="underline underline-offset-4"
              >
                {t('register')}
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
      {/* 隐私政策提示 */}
      <div className="text-muted-foreground text-center text-xs text-balance">
        {t('by_logging_in_you_agree_to_our')}
        {' '}
        <Link href={mainPath.privacy} className="underline underline-offset-4 hover:text-primary">
          {t('privacy_policy')}
        </Link>
      </div>
    </div>
  )
}
