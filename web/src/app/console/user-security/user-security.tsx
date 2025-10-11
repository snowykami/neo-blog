'use client'
import type { BaseResponseError } from '@/models/resp'
import type { OpenIdDto } from '@/models/user'
import { UnlinkIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { getUserOpenIdList, requestEmailVerifyCode, unbindUserOpenId, updateEmail, updatePassword } from '@/api/user'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { InputOTPControlled } from '@/components/common/input-otp'
import { Avatar, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/contexts/auth-context'
import { resetPasswordPath } from '@/hooks/use-route'
import { useCommonT } from '@/hooks/use-translations'
// const VERIFY_CODE_COOL_DOWN = 60; // seconds

export function UserSecurityPage() {
  const t = useTranslations('Console.user_security')
  const commonT = useCommonT()
  const { user, setUser } = useAuth()
  const [email, setEmail] = useState(user?.email || '')
  const [verifyCode, setVerifyCode] = useState('')
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [openIds, setOpenIds] = useState<OpenIdDto[]>([])

  useEffect(() => {
    getUserOpenIdList()
      .then((res) => {
        setOpenIds(res.data.openids)
      })
      .catch((error: BaseResponseError) => {
        console.error('error', error)
        toast.error(`${error.response.data.message}`)
      })
  }, [setOpenIds])

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
      <Separator className="my-4" />
      <div className="grid w-full max-w-sm items-center gap-4 py-4">
        <h1 className="text-2xl font-bold">{t('openid_accounts')}</h1>
        {openIds.length === 0 && <p className="text-sm text-muted-foreground">{t('no_openid_accounts')}</p>}
        <div className="grid gap-4">
          {openIds.map(openId => (
            <UserOpenIdItem key={openId.id} openId={openId} />
          ))}
        </div>
      </div>
    </div>
  )
}

function UserOpenIdItem({ openId }: { openId: OpenIdDto }) {
  const t = useTranslations('Console.user_security')
  const handleDelete = useCallback(() => {
    unbindUserOpenId(openId.id)
      .then(() => {
        toast.success(t('unbind_success'))
        window.location.reload()
      })
      .catch((error: BaseResponseError) => {
        toast.error(`${t('unbind_failed')}: ${error.response.data.message}`)
      })
  }, [openId.id])
  return (
    <div className="flex items-center justify-between w-full max-w-sm border p-2 rounded-md gap-2">
      {/* 左头像 */}
      <div className="flex items-center gap-2">
        <Avatar>
          <AvatarImage src={openId.oidcIcon} alt={openId.oidcName} />
        </Avatar>
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
        <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-600">
          <UnlinkIcon size={16} />
        </Button>
      </ConfirmDialog>
    </div>
  )
}
