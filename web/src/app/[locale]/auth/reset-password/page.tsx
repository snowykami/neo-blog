'use client'

import { MailWarningIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { requestEmailVerifyCode, resetPassword } from '@/api/user'
import { AuthHeader } from '@/components/auth/common/auth-header'
import { InputOTPControlled } from '@/components/common/input-otp'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { loginPath, registerPath } from '@/hooks/use-route'
import { useCommonT, useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { useVerifyCodeSender } from '@/hooks/use-verify-code-sender'
import { Link, useRouter } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import { isValidEmail, isValidPassword, PASSWORD_MAX, PASSWORD_MIN } from '@/utils/common/account'

export default function Page() {
  return (
    <>
      <AuthHeader />
      <ResetPasswordForm />
    </>
  )
}

interface ResetPasswordValues {
  email: string
  verifyCode: string
  newPassword: string
  confirmPassword: string
}

/**
 * 通过邮箱验证码重置密码：邮箱 → 验证码 → 新密码 → 确认密码。
 * 站点关闭邮箱验证或没有配置邮件服务时无法通过邮件找回，提示联系管理员并禁用表单
 */
export function ResetPasswordForm({ className, ...props }: React.ComponentProps<'div'>) {
  const t = useTranslations('ResetPassword')
  const errorMessageT = useErrorMessageT()
  const commonT = useCommonT()
  const operationT = useOperationT()
  const router = useRouter()
  const sender = useVerifyCodeSender()
  const form = useForm<ResetPasswordValues>({ defaultValues: { email: '', verifyCode: '', newPassword: '', confirmPassword: '' } })
  const { isSubmitting } = form.formState
  // 找回密码只能靠邮箱验证码：关闭了邮箱验证（后端直接拒绝）或发不出邮件时都走不通
  const unavailableHint = !sender.verifyRequired ? t('verify_disabled') : sender.emailUnavailable ? t('email_unavailable') : null

  // 先校验邮箱再发送：格式不对时在邮箱下方提示，不发请求
  const handleSendVerifyCode = async () => {
    if (!(await form.trigger('email')))
      return
    const email = form.getValues('email').trim()
    try {
      if (await sender.send(() => requestEmailVerifyCode({ email })))
        toast.success(t('send_verify_code_success'))
    }
    catch (error) {
      toast.error(`${t('send_verify_code_failed')}: ${errorMessageT(error)}`)
    }
  }

  const onSubmit = form.handleSubmit(async ({ email, verifyCode, newPassword }) => {
    if (unavailableHint)
      return
    try {
      await resetPassword({ email: email.trim(), newPassword, verifyCode })
      toast.success(t('reset_password_success'))
      router.push(loginPath)
    }
    catch (error) {
      toast.error(`${t('reset_password_failed')}: ${errorMessageT(error)}`)
    }
  })

  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">{t('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={onSubmit} className="grid gap-4" noValidate>
              {unavailableHint && (
                <Alert>
                  <MailWarningIcon />
                  <AlertDescription>{unavailableHint}</AlertDescription>
                </Alert>
              )}
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
                      <Input type="email" inputMode="email" autoComplete="email" placeholder="example@liteyuki.org" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="verifyCode"
                rules={{ validate: v => v.length === 6 || t('verify_code_required') }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('verify_code')}</FormLabel>
                    <div className="flex justify-between gap-3">
                      <FormControl>
                        <InputOTPControlled value={field.value} onChange={field.onChange} />
                      </FormControl>
                      <Button
                        disabled={Boolean(unavailableHint) || sender.coolDown > 0 || sender.sending}
                        variant="outline"
                        className="border-2"
                        type="button"
                        onClick={() => void handleSendVerifyCode()}
                      >
                        {commonT('obtain')}
                        {sender.coolDown > 0 ? `(${sender.coolDown})` : ''}
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="newPassword"
                rules={{
                  required: t('new_password_required'),
                  validate: v => isValidPassword(v) || t('password_length', { min: PASSWORD_MIN, max: PASSWORD_MAX }),
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('new_password')}</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirmPassword"
                rules={{
                  required: t('confirm_password_required'),
                  validate: (v, values) => v === values.newPassword || t('password_mismatch'),
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('confirm_password')}</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={isSubmitting || Boolean(unavailableHint)}>
                {isSubmitting ? t('resetting') : t('reset_password')}
              </Button>
              <div className="text-center text-sm">
                <Link href={loginPath} className="underline underline-offset-4">
                  {operationT('login')}
                </Link>
                {'  '}
                <Link href={registerPath} className="underline underline-offset-4">
                  {operationT('register')}
                </Link>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}
