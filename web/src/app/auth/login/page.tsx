'use client'
import type { OidcConfig } from '@/models/oidc-config'
import type { CaptchaProvider } from '@/types/captcha'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { getCaptchaConfig, listOidcConfigs, userLogin } from '@/api/user'
import { AuthHeader } from '@/components/auth/common/auth-header'
import { CurrentLogged } from '@/components/auth/common/current-logged'
import Captcha from '@/components/common/captcha'
import { SectionDivider } from '@/components/common/section-divider'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/contexts/auth-context'
import { useOperationT } from '@/hooks/translations'
import { registerPath, resetPasswordPath } from '@/hooks/use-route'
import { cn } from '@/lib/utils'

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
  const operationT = useOperationT()
  const { user, setUser } = useAuth()
  const [oidcConfigs, setOidcConfigs] = useState<OidcConfig[]>([])
  const [captchaProps, setCaptchaProps] = useState<{
    provider: CaptchaProvider
    siteKey: string
    url?: string
  } | null>(null)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [isLogging, setIsLogging] = useState(false)
  const [refreshCaptchaKey, setRefreshCaptchaKey] = useState(0)
  const [{ username, password }, setCredentials] = useState({
    username: '',
    password: '',
  })
  const [rememberMe, setRememberMe] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectBack = searchParams.get('redirect_back') || '/'

  useEffect(() => {
    listOidcConfigs()
      .then((res) => {
        setOidcConfigs(res.data || [])
      })
      .catch((error) => {
        toast.error(t('fetch_oidc_configs_failed') + (error?.message ? `: ${error.message}` : ''))
        setOidcConfigs([])
      })
  }, [t])

  useEffect(() => {
    getCaptchaConfig()
      .then((res) => {
        setCaptchaProps(res.data)
      })
      .catch((error) => {
        toast.error(
          t('fetch_captcha_config_failed') + (error?.message ? `: ${error.message}` : ''),
        )
        setCaptchaProps(null)
      })
  }, [refreshCaptchaKey, t])

  const handleLogin = async (e: React.FormEvent) => {
    setIsLogging(true)
    e.preventDefault()
    userLogin({ username, password, rememberMe, captcha: captchaToken || '' })
      .then((res) => {
        toast.success(`${t('login_success')} ${res.data.user.nickname || res.data.user.username}`)
        setUser(res.data.user)
        router.push(redirectBack)
      })
      .catch((error) => {
        console.error(error)
        toast.error(
          t('login_failed')
          + (error?.response?.data?.message ? `: ${error.response.data.message}` : ''),
        )
        setRefreshCaptchaKey(k => k + 1)
        setCaptchaToken(null)
      })
      .finally(() => {
        setIsLogging(false)
      })
  }

  const handleCaptchaError = (error: string) => {
    toast.error(t('captcha_error') + (error ? `: ${error}` : ''))
    setTimeout(() => {
      setRefreshCaptchaKey(k => k + 1)
    }, 1500)
  }

  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">{t('welcome')}</CardTitle>
        </CardHeader>
        <CardContent>
          {user && <CurrentLogged />}
          {oidcConfigs.length > 0 && (
            <SectionDivider className="mb-6">
              {user ? t('continue_bind_oidc') : t('with_oidc')}
            </SectionDivider>
          )}
          <form onSubmit={handleLogin}>
            <div className="grid gap-4">
              {/* OIDC 登录选项 */}
              {oidcConfigs.length > 0 && (
                <div className="flex flex-col gap-4">
                  {oidcConfigs.map((config, index) => {
                    const uniqueKey
                      = config.id
                        || config.loginUrl
                        || `${config.displayName}-${index}`
                        || `oidc-${index}`
                    return (
                      <LoginWithOidc
                        key={uniqueKey}
                        // 这个REDIRECT_BACK需要前端自己拼接，传给后端服务器，后端服务器拿来响应给前端另一个页面获取，然后改变路由
                        // 因为这个是我暑假那会写的，后面因为其他事情太忙了，好久没看了，忘了为什么当时要这么设计了，在弄清楚之前先保持这样
                        // 貌似是因为oidc认证时是后端响应重定向的，所以前端只能把redirect_back传给后端，由后端再传回来；普通登录时，这个参数可以被前端直接拿到进行路由跳转
                        loginUrl={config.loginUrl.replace(
                          'REDIRECT_BACK',
                          encodeURIComponent(
                            `?redirect_back=${redirectBack}&is_bind=${user ? 'true' : 'false'}`,
                          ),
                        )}
                        displayName={config.displayName}
                        icon={config.icon}
                      />
                    )
                  })}
                </div>
              )}
              {/* 分隔线 */}
              <SectionDivider className="my-2">
                {' '}
                {t('or_continue_with_local_account')}
              </SectionDivider>
              {/* 邮箱密码登录 */}
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="email">{t('email_or_username')}</Label>
                    <Label className="text-sm cursor-pointer">
                      <Checkbox
                        checked={rememberMe}
                        onCheckedChange={checked => setRememberMe(!!checked)}
                      />
                      {t('remember_me')}
                    </Label>
                  </div>
                  <Input
                    id="email"
                    type="text"
                    placeholder="example@liteyuki.org"
                    required
                    value={username}
                    onChange={e =>
                      setCredentials(c => ({
                        ...c,
                        username: e.target.value,
                      }))}
                  />
                </div>
                <div className="grid gap-2">
                  <div className="flex items-center">
                    <Label htmlFor="password">{t('password')}</Label>
                    <Link
                      href={resetPasswordPath}
                      className="ml-auto text-sm underline-offset-4 hover:underline"
                    >
                      {t('forgot_password')}
                    </Link>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    required
                    value={password}
                    onChange={e =>
                      setCredentials(c => ({
                        ...c,
                        password: e.target.value,
                      }))}
                  />
                </div>
                {captchaProps && (
                  <div className="flex justify-center items-center w-full">
                    <Captcha
                      {...captchaProps}
                      onSuccess={setCaptchaToken}
                      onError={handleCaptchaError}
                      key={refreshCaptchaKey}
                    />
                  </div>
                )}
                <Button type="submit" className="w-full" disabled={!captchaToken || isLogging}>
                  {isLogging ? t('logging') : operationT('login')}
                </Button>
              </div>

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
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

interface LoginWithOidcProps {
  loginUrl: string
  displayName?: string
  icon?: string
}

function LoginWithOidc({
  loginUrl,
  displayName = 'Login with OIDC',
  icon = '/oidc-icon.svg',
}: LoginWithOidcProps) {
  const router = useRouter()
  const handleOidcLogin = async () => {
    router.push(loginUrl)
  }

  return (
    <Button type="button" variant="outline" className="w-full" onClick={handleOidcLogin}>
      <Avatar className="h-6 w-6 rounded-full">
        <AvatarImage src={icon} alt={displayName} />
        <AvatarFallback className="rounded-full"></AvatarFallback>
      </Avatar>
      {displayName}
    </Button>
  )
}
