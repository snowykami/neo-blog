'use client'
import type { User } from '@/models/user'
import type { CaptchaProps } from '@/types/captcha'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { getCaptchaConfig, userLogin } from '@/api/user'
import Captcha from '@/components/common/captcha'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/contexts/auth-context'
import { resetPasswordPath } from '@/hooks/use-route'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { Link } from '@/i18n/navigation'

interface LoginValues {
  username: string
  password: string
  rememberMe: boolean
}

/**
 * 用户名（邮箱）+ 密码登录，含记住我、忘记密码与人机验证；登录页与快捷登录弹窗共用。
 * 成功后已写入登录状态，onSuccess 只负责后续动作（跳转、关闭弹窗等）
 */
export function LocalLoginForm({ onSuccess }: { onSuccess?: (user: User) => void }) {
  const t = useTranslations('Login')
  const operationT = useOperationT()
  // 后端错误码（如 invalid_credentials、too_many_requests）转为本地化文案
  const errorMessageT = useErrorMessageT()
  const { setUser } = useAuth()
  const form = useForm<LoginValues>({ defaultValues: { username: '', password: '', rememberMe: false } })
  const [captchaProps, setCaptchaProps] = useState<Pick<CaptchaProps, 'provider' | 'siteKey' | 'url'> | null>(null)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [refreshCaptchaKey, setRefreshCaptchaKey] = useState(0)
  const { isSubmitting } = form.formState

  useEffect(() => {
    getCaptchaConfig()
      .then((res) => {
        setCaptchaProps(res.data)
      })
      .catch((error) => {
        const message = errorMessageT(error)
        toast.error(t('fetch_captcha_config_failed') + (message ? `: ${message}` : ''))
        setCaptchaProps(null)
      })
  }, [refreshCaptchaKey, t, errorMessageT])

  const onSubmit = form.handleSubmit(async ({ username, password, rememberMe }) => {
    try {
      const res = await userLogin({ username, password, rememberMe, captcha: captchaToken || '' })
      const user = res.data.user
      toast.success(`${t('login_success')} ${user.nickname || user.username}`)
      setUser(user)
      onSuccess?.(user)
    }
    catch (error) {
      console.error(error)
      const message = errorMessageT(error)
      toast.error(t('login_failed') + (message ? `: ${message}` : ''))
      setRefreshCaptchaKey(k => k + 1)
      setCaptchaToken(null)
    }
  })

  const handleCaptchaError = (error: string) => {
    toast.error(t('captcha_error') + (error ? `: ${error}` : ''))
    setTimeout(() => {
      setRefreshCaptchaKey(k => k + 1)
    }, 1500)
  }

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-4">
        <FormField
          control={form.control}
          name="username"
          rules={{ required: t('username_required') }}
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel>{t('email_or_username')}</FormLabel>
                <FormField
                  control={form.control}
                  name="rememberMe"
                  render={({ field: rememberField }) => (
                    <Label className="cursor-pointer text-sm">
                      <Checkbox checked={rememberField.value} onCheckedChange={checked => rememberField.onChange(!!checked)} />
                      {t('remember_me')}
                    </Label>
                  )}
                />
              </div>
              <FormControl>
                <Input type="text" autoComplete="username" placeholder="example@liteyuki.org" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          rules={{ required: t('password_required') }}
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center">
                <FormLabel>{t('password')}</FormLabel>
                <Link href={resetPasswordPath} className="ml-auto text-sm underline-offset-4 hover:underline">
                  {t('forgot_password')}
                </Link>
              </div>
              <FormControl>
                <Input type="password" autoComplete="current-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {captchaProps && (
          <div className="flex w-full items-center justify-center">
            <Captcha {...captchaProps} onSuccess={setCaptchaToken} onError={handleCaptchaError} key={refreshCaptchaKey} />
          </div>
        )}
        <Button type="submit" className="w-full" disabled={!captchaToken || isSubmitting}>
          {isSubmitting ? t('logging') : operationT('login')}
        </Button>
      </form>
    </Form>
  )
}
