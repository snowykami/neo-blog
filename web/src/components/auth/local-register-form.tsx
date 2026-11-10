'use client'

import type { User } from '@/models/user'
import type { CaptchaProvider } from '@/types/captcha'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { getCaptchaConfig, requestEmailVerifyCode, userRegister } from '@/api/user'
import Captcha from '@/components/common/captcha'
import { InputOTPControlled } from '@/components/common/input-otp'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/contexts/auth-context'
import { useSiteInfo } from '@/contexts/site-info-context'
import { loginPath } from '@/hooks/use-route'
import { useCommonT, useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { Link } from '@/i18n/navigation'

/**
 * 用户名 + 密码 + 邮箱验证码注册，含人机验证；注册页与快捷登录弹窗的注册视图共用。
 * 成功后已写入登录状态，onSuccess 只负责后续动作（跳转、关闭弹窗等）；
 * 传了 onSwitchToLogin 时「已经有账号？」渲染为按钮（弹窗内切换视图），否则为跳转登录页的链接
 */
export function LocalRegisterForm({
  redirectBack,
  onSuccess,
  onSwitchToLogin,
}: {
  // 页面里用：切到登录页时带上，登录后回到原页面
  redirectBack?: string
  onSuccess?: (user: User) => void
  onSwitchToLogin?: () => void
}) {
  const { setUser } = useAuth()
  const { siteInfo } = useSiteInfo()
  const t = useTranslations('Register')
  // 后端 message 若有对应翻译则显示翻译，否则原样显示（网络错误等）
  const translateErrorDetails = useErrorMessageT()
  const commonT = useCommonT()
  const operationT = useOperationT()
  const [captchaProps, setCaptchaProps] = useState<{
    provider: CaptchaProvider
    siteKey: string
    url?: string
  } | null>(null)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [refreshCaptchaKey, setRefreshCaptchaKey] = useState(0)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [verifyCode, setVerifyCode] = useState('')
  const [sendingVerifyCode, setSendingVerifyCode] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [coolDown, setCoolDown] = useState(0)

  useEffect(() => {
    if (coolDown <= 0)
      return
    const id = setInterval(() => {
      setCoolDown(c => (c > 1 ? c - 1 : 0))
    }, 1000)
    return () => clearInterval(id)
  }, [coolDown])

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

  const handleCaptchaError = (error: string) => {
    toast.error(t('captcha_error') + (error ? `: ${error}` : ''))
    setTimeout(() => {
      setRefreshCaptchaKey(k => k + 1)
    }, 1500)
  }

  const handleSendVerifyCode = () => {
    if (!email || coolDown > 0 || sendingVerifyCode)
      return
    setSendingVerifyCode(true)
    requestEmailVerifyCode({ email, captchaToken: captchaToken || '' })
      .then(() => {
        toast.success(t('send_verify_code_success'))
      })
      .catch((error: unknown) => {
        toast.error(
          `${t('send_verify_code_failed')}: ${translateErrorDetails(error)}`,
        )
      })
      .finally(() => {
        setSendingVerifyCode(false)
        setCoolDown(siteInfo.verifyCodeCoolDown || 60)
      })
  }

  const handleRegister = () => {
    if (!username || !password || !email) {
      toast.error(t('please_fill_in_all_required_fields'))
      return
    }
    if (!captchaToken) {
      return
    }
    setRegistering(true)
    userRegister({ username, password, email, verifyCode, captchaToken })
      .then((res) => {
        toast.success(
          `${t('register_success')} ${res.data.user.nickname || res.data.user.username}`,
        )
        setUser(res.data.user)
        onSuccess?.(res.data.user)
      })
      .catch((error: unknown) => {
        toast.error(
          `${t('register_failed')}: ${translateErrorDetails(error)}`,
        )
        setRefreshCaptchaKey(k => k + 1)
        setCaptchaToken(null)
      })
      .finally(() => {
        setRegistering(false)
      })
  }

  return (
    <form>
      <div className="grid gap-4">
        {/* 用户名 */}
        <div className="grid gap-2">
          <div className="flex items-center">
            <Label htmlFor="register-username">{commonT('username')}</Label>
          </div>
          <Input
            id="register-username"
            type="text"
            autoComplete="username"
            required
            value={username}
            onChange={e => setUsername(e.target.value)}
          />
        </div>
        {/* 密码 */}
        <div className="grid gap-2">
          <div className="flex items-center">
            <Label htmlFor="register-password">{commonT('password')}</Label>
          </div>
          <Input
            id="register-password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
        </div>
        {/* 邮箱 */}
        <div className="grid gap-2">
          <Label htmlFor="register-email">{commonT('email')}</Label>
          <div className="flex gap-3">
            <Input
              id="register-email"
              type="text"
              placeholder="example@liteyuki.org"
              autoComplete="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </div>
        </div>
        {/* 邮箱验证码 */}
        <div className="grid gap-2">
          <Label htmlFor="register-email">{commonT('verify_code')}</Label>
          <div className="flex justify-between">
            <InputOTPControlled onChange={value => setVerifyCode(value)} />
            <Button
              onClick={handleSendVerifyCode}
              disabled={!email || coolDown > 0 || sendingVerifyCode}
              variant="outline"
              className="border-2"
              type="button"
            >
              {commonT('obtain')}
              {coolDown > 0 ? `(${coolDown})` : ''}
            </Button>
          </div>
        </div>
        {captchaProps && (
          <div className="flex w-full items-center justify-center">
            <Captcha
              {...captchaProps}
              onSuccess={setCaptchaToken}
              onError={handleCaptchaError}
              key={refreshCaptchaKey}
            />
          </div>
        )}
        <Button
          type="button"
          className="w-full"
          onClick={handleRegister}
          disabled={
            !captchaToken
            || registering
            || !username
            || !password
            || !email
            || !(verifyCode.length === 6)
          }
        >
          {registering ? t('registering') : operationT('register')}
        </Button>
        {/* 已经有账号：弹窗里切换回登录视图，页面里跳登录页 */}
        <div className="text-center text-sm">
          {t('already_have_account')}
          {' '}
          {onSwitchToLogin
            ? (
                <button type="button" className="underline underline-offset-4" onClick={onSwitchToLogin}>
                  {operationT('login')}
                </button>
              )
            : (
                <Link
                  href={redirectBack ? `${loginPath}?redirect_back=${encodeURIComponent(redirectBack)}` : loginPath}
                  className="underline underline-offset-4"
                >
                  {operationT('login')}
                </Link>
              )}
        </div>
      </div>
    </form>
  )
}
