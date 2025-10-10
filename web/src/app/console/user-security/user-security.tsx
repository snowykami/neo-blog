'use client'
import type { BaseResponseError } from '@/models/resp'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'
import { requestEmailVerifyCode, updateEmail, updatePassword } from '@/api/user'
import { InputOTPControlled } from '@/components/common/input-otp'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/contexts/auth-context'
import { useCommonT } from '@/hooks/translations'
import { resetPasswordPath } from '@/hooks/use-route'
// const VERIFY_CODE_COOL_DOWN = 60; // seconds

export function UserSecurityPage() {
  const t = useTranslations('Console.user_security')
  const commonT = useCommonT()
  const { user, setUser } = useAuth()
  const [email, setEmail] = useState(user?.email || '')
  const [verifyCode, setVerifyCode] = useState('')
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')

  const handleSubmitPassword = () => {
    updatePassword({ oldPassword, newPassword })
      .then(() => {
        toast.success(t('update_password_success'))
        setOldPassword('')
        setNewPassword('')
      })
      .catch((error: BaseResponseError) => {
        toast.error(`${t('update_password_failed')}: ${error.response.data.message}`)
      })
  }

  const handleSendVerifyCode = () => {
    requestEmailVerifyCode({ email })
      .then(() => {
        toast.success(t('send_verify_code_success'))
      })
      .catch((error: BaseResponseError) => {
        console.error('error', error)
        toast.error(`${t('send_verify_code_failed')}: ${error.response.data.message}`)
      })
  }

  const handleSubmitEmail = () => {
    updateEmail({ newEmail: email, verifyCode })
      .then(() => {
        toast.success(t('update_email_success'))
        if (user) {
          setUser({
            ...user,
            email,
          })
        }
        setVerifyCode('')
      })
      .catch((error: BaseResponseError) => {
        toast.error(`${t('update_email_failed')}: ${error.response.data.message}`)
      })
  }
  if (!user)
    return null
  return (
    <div>
      <div className="grid w-full max-w-sm items-center gap-4">
        <h1 className="text-2xl font-bold">{t('password_setting')}</h1>
        <div className="grid gap-2">
          <Label htmlFor="password">{t('old_password')}</Label>
          <Input
            id="password"
            type="password"
            value={oldPassword}
            onChange={e => setOldPassword(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password">{t('new_password')}</Label>
          <Input
            id="password"
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
          />
        </div>

        <div className="flex w-full items-center justify-between">
          <Button
            disabled={!oldPassword || !newPassword}
            className="max-w-1/3 border-2"
            onClick={handleSubmitPassword}
          >
            {t('update_password')}
          </Button>
          <Link href={resetPasswordPath}>{t('forgot_password_or_no_password')}</Link>
        </div>
      </div>
      <Separator className="my-4" />
      <div className="grid w-full max-w-sm items-center gap-4 py-4">
        <h1 className="text-2xl font-bold">{t('email_setting')}</h1>

        <div className="grid gap-2">
          <Label htmlFor="email">{commonT('email')}</Label>
          <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="verify-code">{t('verify_code')}</Label>
          <div className="flex gap-2 justify-between">
            <InputOTPControlled onChange={value => setVerifyCode(value)} />
            <Button
              disabled={!email || email === user.email}
              variant="outline"
              className="border-2"
              onClick={handleSendVerifyCode}
            >
              {t('send_verify_code')}
            </Button>
          </div>
        </div>
        <Button disabled={verifyCode.length < 6} className="border-2" onClick={handleSubmitEmail}>
          {t('update_email')}
        </Button>
      </div>
    </div>
  )
}
