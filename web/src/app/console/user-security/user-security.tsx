'use client'
import type { OpenIdDto } from '@/models/user'
import { Loader2, UnlinkIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { getUserOpenIdList, requestEmailVerifyCode, unbindUserOpenId, updateEmail, updatePassword } from '@/api/user'
import { ImageAvatar } from '@/components/common/avatar'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { InputOTPControlled } from '@/components/common/input-otp'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/contexts/auth-context'
import { useSiteInfo } from '@/contexts/site-info-context'
import { resetPasswordPath } from '@/hooks/use-route'
import { useCommonT, useErrorMessageT } from '@/hooks/use-translations'

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
    getUserOpenIdList()
      .then((res) => {
        setOpenIds(res.data.openids)
      })
      .catch((error: unknown) => {
        console.error('error', error)
        toast.error(errorMessageT(error))
      })
  }, [setOpenIds])

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
    <div>
      <Form {...passwordForm}>
        <form className="grid w-full max-w-sm items-center gap-4" onSubmit={passwordForm.handleSubmit(handleSubmitPassword)}>
          <h1 className="text-2xl font-bold">{t('password_setting')}</h1>
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

          <div className="flex w-full items-center justify-between">
            <Button
              type="submit"
              disabled={passwordForm.formState.isSubmitting}
              className="max-w-1/3 border-2"
            >
              {passwordForm.formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
              {t('update_password')}
            </Button>
            <Link href={resetPasswordPath}>{t('forgot_password_or_no_password')}</Link>
          </div>
        </form>
      </Form>
      <Separator className="my-4" />
      <Form {...emailForm}>
        <form className="grid w-full max-w-sm items-center gap-4 py-4" onSubmit={emailForm.handleSubmit(handleSubmitEmail)}>
          <h1 className="text-2xl font-bold">{t('email_setting')}</h1>
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
                <div className="flex gap-2 justify-between">
                  <FormControl>
                    <InputOTPControlled value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <Button
                    type="button"
                    disabled={!watchedEmail || watchedEmail === user.email || coolDown > 0 || sendingVerifyCode}
                    variant="outline"
                    className="border-2"
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
          <Button
            type="submit"
            disabled={watchedVerifyCode.length < 6 || emailForm.formState.isSubmitting}
            className="border-2"
          >
            {emailForm.formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
            {t('update_email')}
          </Button>
        </form>
      </Form>
      <Separator className="my-4" />
      <div className="grid w-full max-w-sm items-center gap-4 py-4">
        <h1 className="text-2xl font-bold">{t('openid_accounts')}</h1>
        {openIds.length === 0 && <p className="text-sm text-muted-foreground">{t('no_openid_accounts')}</p>}
        <div className="grid gap-4">
          {openIds.map(openId => (
            <UserOpenIdItem
              key={openId.id}
              openId={openId}
              onUnbind={id => setOpenIds(prev => prev.filter(item => item.id !== id))}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function UserOpenIdItem({ openId, onUnbind }: { openId: OpenIdDto, onUnbind: (id: number) => void }) {
  const t = useTranslations('Console.user_security')
  const errorMessageT = useErrorMessageT()
  const handleDelete = useCallback(() => {
    unbindUserOpenId(openId.id)
      .then(() => {
        toast.success(t('unbind_success'))
        onUnbind(openId.id)
      })
      .catch((error: unknown) => {
        toast.error(`${t('unbind_failed')}: ${errorMessageT(error)}`)
      })
  }, [openId.id, onUnbind, t])
  return (
    <div className="flex items-center justify-between w-full max-w-sm border p-2 rounded-md gap-2">
      {/* 左头像 */}
      <div className="flex items-center gap-2">
        <ImageAvatar src={openId.oidcIcon} alt={openId.oidcName} fallback={(openId.oidcDisplayName || openId.oidcName).slice(0, 1)} />
        <div className="grid">
          <span className="text-sm text-muted-foreground">{openId.oidcDisplayName || openId.oidcName}</span>
          <span className="font-medium truncate">
            {openId.name || openId.preferredUsername}
            {' '}
            (
            {openId.email}
            )
          </span>
        </div>
      </div>
      {/* 右信息 */}
      <div className="flex items-center gap-2 justify-start">

      </div>
      <ConfirmDialog
        title={t('confirm_unbind')}
        description={t('confirm_unbind_description')}
        onConfirm={handleDelete}
        confirmLabel={t('unbind')}
      >
        <Button
          variant="ghost"
          size="icon"
          className="text-red-500 hover:text-red-600"
          aria-label={t('unbind')}
          title={t('unbind')}
        >
          <UnlinkIcon size={16} />
        </Button>
      </ConfirmDialog>
    </div>
  )
}
