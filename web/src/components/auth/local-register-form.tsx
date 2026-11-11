'use client'

import type { User } from '@/models/user'
import type { CaptchaProvider } from '@/types/captcha'
import { MailWarningIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { getCaptchaConfig, requestEmailVerifyCode, userRegister } from '@/api/user'
import Captcha from '@/components/common/captcha'
import { InputOTPControlled } from '@/components/common/input-otp'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/contexts/auth-context'
import { loginPath } from '@/hooks/use-route'
import { useCommonT, useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { useVerifyCodeSender } from '@/hooks/use-verify-code-sender'
import { Link } from '@/i18n/navigation'
import { isValidEmail, isValidPassword, PASSWORD_MAX, PASSWORD_MIN } from '@/utils/common/account'

interface RegisterValues {
  username: string
  password: string
  email: string
  verifyCode: string
}

/**
 * 用户名 + 密码 + 邮箱验证码注册，含人机验证；注册页与快捷登录弹窗的注册视图共用。
 * 站点关闭邮箱验证时不显示验证码；要求验证码但站点没有配置邮件服务时提示联系管理员（不改变验证策略，见 useVerifyCodeSender）。
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
  const t = useTranslations('Register')
  // 后端 message 若有对应翻译则显示翻译，否则原样显示（网络错误等）
  const translateErrorDetails = useErrorMessageT()
  const commonT = useCommonT()
  const operationT = useOperationT()
  const form = useForm<RegisterValues>({ defaultValues: { username: '', password: '', email: '', verifyCode: '' } })
  const { isSubmitting } = form.formState
  const sender = useVerifyCodeSender()
  const { verifyRequired, emailUnavailable } = sender
  // 要求验证码却发不出邮件：注册无法完成，禁用提交并说明原因
  const blocked = verifyRequired && emailUnavailable
  const [captchaProps, setCaptchaProps] = useState<{
    provider: CaptchaProvider
    siteKey: string
    url?: string
  } | null>(null)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [refreshCaptchaKey, setRefreshCaptchaKey] = useState(0)

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

  // 先校验邮箱再发送：格式不对时在邮箱下方提示，不发请求
  const handleSendVerifyCode = async () => {
    if (!(await form.trigger('email')))
      return
    const email = form.getValues('email').trim()
    try {
      if (await sender.send(() => requestEmailVerifyCode({ email, captchaToken: captchaToken || '' })))
        toast.success(t('send_verify_code_success'))
    }
    catch (error) {
      toast.error(`${t('send_verify_code_failed')}: ${translateErrorDetails(error)}`)
    }
  }

  const onSubmit = form.handleSubmit(async ({ username, password, email, verifyCode }) => {
    if (!captchaToken || blocked)
      return
    try {
      const res = await userRegister({ username: username.trim(), password, email: email.trim(), verifyCode: verifyRequired ? verifyCode : '', captchaToken })
      toast.success(
        `${t('register_success')} ${res.data.user.nickname || res.data.user.username}`,
      )
      setUser(res.data.user)
      onSuccess?.(res.data.user)
    }
    catch (error) {
      toast.error(
        `${t('register_failed')}: ${translateErrorDetails(error)}`,
      )
      setRefreshCaptchaKey(k => k + 1)
      setCaptchaToken(null)
    }
  })

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        {blocked && (
          <Alert>
            <MailWarningIcon />
            <AlertDescription>{t('email_unavailable')}</AlertDescription>
          </Alert>
        )}
        <FormField
          control={form.control}
          name="username"
          rules={{ validate: v => Boolean(v.trim()) || t('username_required') }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{commonT('username')}</FormLabel>
              <FormControl>
                <Input type="text" autoComplete="username" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          rules={{
            required: t('password_required'),
            validate: v => isValidPassword(v) || t('password_length', { min: PASSWORD_MIN, max: PASSWORD_MAX }),
          }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{commonT('password')}</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          rules={{
            required: t('email_required'),
            validate: v => isValidEmail(v.trim()) || t('email_invalid'),
          }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{commonT('email')}</FormLabel>
              <FormControl>
                <Input type="email" inputMode="email" placeholder="example@liteyuki.org" autoComplete="email" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {verifyRequired && (
          <FormField
            control={form.control}
            name="verifyCode"
            rules={{ validate: v => v.length === 6 || t('verify_code_required') }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{commonT('verify_code')}</FormLabel>
                <div className="flex justify-between gap-3">
                  <FormControl>
                    <InputOTPControlled value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <Button
                    onClick={() => void handleSendVerifyCode()}
                    disabled={emailUnavailable || sender.coolDown > 0 || sender.sending}
                    variant="outline"
                    className="border-2"
                    type="button"
                  >
                    {commonT('obtain')}
                    {sender.coolDown > 0 ? `(${sender.coolDown})` : ''}
                  </Button>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
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
          type="submit"
          className="w-full"
          disabled={!captchaToken || isSubmitting || blocked}
        >
          {isSubmitting ? t('registering') : operationT('register')}
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
      </form>
    </Form>
  )
}
