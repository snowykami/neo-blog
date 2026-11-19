'use client'
import type { OpenIdDto } from '@/models/user'
import { Loader2, UnlinkIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { getUserOpenIdList, requestEmailVerifyCode, unbindUserOpenId, updateEmail, updatePassword } from '@/api/user'
import { ImageAvatar } from '@/components/common/avatar'
import { InputOTPControlled } from '@/components/common/input-otp'
import { Popconfirm } from '@/components/common/popconfirm'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/contexts/auth-context'
import { useSiteInfo } from '@/contexts/site-info-context'
import { resetPasswordPath } from '@/hooks/use-route'
import { useCommonT, useErrorMessageT } from '@/hooks/use-translations'
import { Link } from '@/i18n/navigation'

const PASSWORD_MIN_LENGTH = 8
const PASSWORD_MAX_LENGTH = 32

interface PasswordFormValues {
  oldPassword: string
  newPassword: string
  confirmPassword: string
}

interface EmailFormValues {
  email: string
  verifyCode: string
}

export function UserSecurityPage() {
  const t = useTranslations('Console.user_security')
  const errorMessageT = useErrorMessageT()
  const commonT = useCommonT()
  const { user, setUser } = useAuth()
  const { siteInfo } = useSiteInfo()
  const [openIds, setOpenIds] = useState<OpenIdDto[]>([])
  const [openIdsLoading, setOpenIdsLoading] = useState(true)
  const [coolDown, setCoolDown] = useState(0)
  const [sendingVerifyCode, setSendingVerifyCode] = useState(false)

  const passwordForm = useForm<PasswordFormValues>({
    defaultValues: { oldPassword: '', newPassword: '', confirmPassword: '' },
    mode: 'onChange',
  })
  const emailForm = useForm<EmailFormValues>({
    defaultValues: { email: user?.email || '', verifyCode: '' },
    mode: 'onChange',
  })
  const watchedEmail = emailForm.watch('email')
  const watchedVerifyCode = emailForm.watch('verifyCode')

  useEffect(() => {
    let cancelled = false
    getUserOpenIdList()
      .then((res) => {
        if (!cancelled)
          setOpenIds(res.data.openids)
      })
      .catch((error: unknown) => {
        console.error('error', error)
        if (!cancelled)
          toast.error(errorMessageT(error))
      })
      .finally(() => {
        if (!cancelled)
          setOpenIdsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [errorMessageT])

  // 验证码冷却倒计时
  useEffect(() => {
    if (coolDown <= 0)
      return
    const id = setInterval(() => {
      setCoolDown(c => (c > 1 ? c - 1 : 0))
    }, 1000)
    return () => clearInterval(id)
  }, [coolDown])

  const handleSubmitPassword = async ({ oldPassword, newPassword }: PasswordFormValues) => {
    try {
      await updatePassword({ oldPassword, newPassword })
      toast.success(t('update_password_success'))
      passwordForm.reset()
    }
    catch (error) {
      toast.error(`${t('update_password_failed')}: ${errorMessageT(error)}`)
    }
  }

  const handleSendVerifyCode = () => {
    const email = emailForm.getValues('email')
    if (!email || coolDown > 0 || sendingVerifyCode)
      return
    setSendingVerifyCode(true)
    requestEmailVerifyCode({ email })
      .then(() => {
        toast.success(t('send_verify_code_success'))
        setCoolDown(siteInfo.verifyCodeCoolDown || 60)
      })
      .catch((error: unknown) => {
        console.error('error', error)
        toast.error(`${t('send_verify_code_failed')}: ${errorMessageT(error)}`)
      })
      .finally(() => {
        setSendingVerifyCode(false)
      })
  }

  const handleSubmitEmail = async ({ email, verifyCode }: EmailFormValues) => {
    try {
      await updateEmail({ newEmail: email, verifyCode })
      toast.success(t('update_email_success'))
      if (user) {
        setUser({
          ...user,
          email,
        })
      }
      // 清空验证码输入框（受控）
      emailForm.reset({ email, verifyCode: '' })
    }
    catch (error) {
      toast.error(`${t('update_email_failed')}: ${errorMessageT(error)}`)
    }
  }
  if (!user)
    return null
  return (
    <div className="grid w-full max-w-2xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('password_setting')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...passwordForm}>
            <form className="grid gap-4" onSubmit={passwordForm.handleSubmit(handleSubmitPassword)}>
              <FormField
                control={passwordForm.control}
                name="oldPassword"
                rules={{ required: t('password_required') }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('old_password')}</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="current-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={passwordForm.control}
                name="newPassword"
                rules={{
                  required: t('password_required'),
                  minLength: { value: PASSWORD_MIN_LENGTH, message: t('password_length', { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH }) },
                  maxLength: { value: PASSWORD_MAX_LENGTH, message: t('password_length', { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH }) },
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
                control={passwordForm.control}
                name="confirmPassword"
                rules={{
                  required: t('password_required'),
                  validate: value => value === passwordForm.getValues('newPassword') || t('password_mismatch'),
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('confirm_new_password')}</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button
                  type="submit"
                  disabled={passwordForm.formState.isSubmitting}
                >
                  {passwordForm.formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
                  {t('update_password')}
                </Button>
                <Link
                  href={resetPasswordPath}
                  className="text-sm text-primary hover:underline underline-offset-4"
                >
                  {t('forgot_password_or_no_password')}
                </Link>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('email_setting')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...emailForm}>
            <form className="grid gap-4" onSubmit={emailForm.handleSubmit(handleSubmitEmail)}>
              <FormField
                control={emailForm.control}
                name="email"
                rules={{ required: true }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{commonT('email')}</FormLabel>
                    <FormControl>
                      <Input type="email" autoComplete="email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={emailForm.control}
                name="verifyCode"
                rules={{ required: true, minLength: 6 }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('verify_code')}</FormLabel>
                    {/* 窄屏放不下验证码输入框和按钮时，按钮换到下一行 */}
                    <div className="flex flex-wrap items-center gap-3">
                      <FormControl>
                        <InputOTPControlled value={field.value} onChange={field.onChange} />
                      </FormControl>
                      <Button
                        type="button"
                        disabled={!watchedEmail || watchedEmail === user.email || coolDown > 0 || sendingVerifyCode}
                        variant="outline"
                        onClick={handleSendVerifyCode}
                      >
                        {sendingVerifyCode && <Loader2 className="size-4 animate-spin" />}
                        {t('send_verify_code')}
                        {coolDown > 0 ? `(${coolDown})` : ''}
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-start">
                <Button
                  type="submit"
                  disabled={watchedVerifyCode.length < 6 || emailForm.formState.isSubmitting}
                >
                  {emailForm.formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
                  {t('update_email')}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('openid_accounts')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {openIdsLoading
            ? (
                <div className="grid gap-3" aria-busy="true">
                  {Array.from({ length: 2 }, (_, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                      <div className="flex items-center gap-3">
                        <Skeleton className="size-8 rounded-full" />
                        <div className="grid gap-1.5">
                          <Skeleton className="h-3.5 w-20" />
                          <Skeleton className="h-4 w-44" />
                        </div>
                      </div>
                      <Skeleton className="size-8 rounded-md" />
                    </div>
                  ))}
                </div>
              )
            : openIds.length === 0
              ? <p className="text-sm text-muted-foreground">{t('no_openid_accounts')}</p>
              : (
                  <div className="grid gap-3">
                    {openIds.map(openId => (
                      <UserOpenIdItem
                        key={openId.id}
                        openId={openId}
                        onUnbind={id => setOpenIds(prev => prev.filter(item => item.id !== id))}
                      />
                    ))}
                  </div>
                )}
        </CardContent>
      </Card>
    </div>
  )
}

function UserOpenIdItem({ openId, onUnbind }: { openId: OpenIdDto, onUnbind: (id: number) => void }) {
  const t = useTranslations('Console.user_security')
  // 失败时抛出，由 Popconfirm 统一提示并保持打开
  const handleDelete = useCallback(async () => {
    await unbindUserOpenId(openId.id)
    toast.success(t('unbind_success'))
    onUnbind(openId.id)
  }, [openId.id, onUnbind, t])
  return (
    <div className="flex w-full items-center justify-between gap-3 rounded-lg border p-3">
      {/* 左头像 */}
      <div className="flex min-w-0 items-center gap-3">
        <ImageAvatar src={openId.oidcIcon} alt={openId.oidcName} sizes="32px" fallback={(openId.oidcDisplayName || openId.oidcName).slice(0, 1)} />
        <div className="grid min-w-0">
          <span className="text-xs text-muted-foreground">{openId.oidcDisplayName || openId.oidcName}</span>
          <span className="truncate text-sm font-medium">
            {openId.name || openId.preferredUsername}
            {' '}
            (
            {openId.email}
            )
          </span>
        </div>
      </div>
      {/* 解绑可随时重新绑定，使用就地确认 */}
      <Popconfirm
        title={t('confirm_unbind')}
        description={t('confirm_unbind_description')}
        confirmText={t('unbind')}
        errorText={t('unbind_failed')}
        destructive
        onConfirm={handleDelete}
      >
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 text-destructive hover:text-destructive"
          aria-label={t('unbind')}
          title={t('unbind')}
        >
          <UnlinkIcon size={16} />
        </Button>
      </Popconfirm>
    </div>
  )
}
