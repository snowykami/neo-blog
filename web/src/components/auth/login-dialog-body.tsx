'use client'

import type { AuthDialogMode, LoginReason } from './login-dialog'
import type { User } from '@/models/user'
import { useTranslations } from 'next-intl'
import { LocalLoginForm } from '@/components/auth/local-login-form'
import { LocalRegisterForm } from '@/components/auth/local-register-form'
import { OidcProviderButtons, useOidcProviders } from '@/components/auth/oidc-providers'
import { SectionDivider } from '@/components/common/section-divider'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAuth } from '@/contexts/auth-context'
import { Link } from '@/i18n/navigation'
import { mainPath } from '@/utils/common/route'

export function LoginDialogModal({
  open,
  onOpenChange,
  mode,
  reason,
  redirectBack,
  hasRequest,
  onSwitchMode,
  onLoggedIn,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: AuthDialogMode
  reason?: LoginReason
  redirectBack: string
  hasRequest: boolean
  onSwitchMode: (mode: AuthDialogMode) => void
  onLoggedIn: (user: User) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // 注册视图比登录长，矮屏幕上在弹窗内滚动，不把按钮挤出可视区
        className="bg-card max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-sm"
        // hCaptcha 的验证挑战在弹窗外的 iframe 中，与之交互时不应关闭弹窗
        onInteractOutside={(e) => {
          if (e.target instanceof HTMLIFrameElement)
            e.preventDefault()
        }}
      >
        {hasRequest && (
          <LoginDialogBody
            mode={mode}
            reason={reason}
            redirectBack={redirectBack}
            onSwitchMode={onSwitchMode}
            onLoggedIn={onLoggedIn}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function LoginDialogBody({ mode, reason, redirectBack, onSwitchMode, onLoggedIn }: {
  mode: AuthDialogMode
  reason?: LoginReason
  redirectBack: string
  onSwitchMode: (mode: AuthDialogMode) => void
  onLoggedIn: (user: User) => void
}) {
  const t = useTranslations('Login')
  const registerT = useTranslations('Register')
  const { providers } = useOidcProviders()
  const { refresh } = useAuth()

  if (mode === 'register') {
    return (
      <>
        <DialogHeader className="text-center sm:text-center">
          <DialogTitle className="text-xl">{registerT('title')}</DialogTitle>
          <DialogDescription>{registerT('register_a_new_account')}</DialogDescription>
        </DialogHeader>
        <LocalRegisterForm onSwitchToLogin={() => onSwitchMode('login')} onSuccess={onLoggedIn} />
        <div className="text-muted-foreground text-center text-xs text-balance">
          {registerT('by_registering_you_agree_to_our')}
          {' '}
          <Link href={mainPath.privacy} className="underline underline-offset-4 hover:text-primary">
            {t('privacy_policy')}
          </Link>
        </div>
      </>
    )
  }

  return (
    <>
      <DialogHeader className="text-center sm:text-center">
        <DialogTitle className="text-xl">{t('welcome')}</DialogTitle>
        <DialogDescription>{reason ? t(`reason_${reason}`) : t('sign_in_hint')}</DialogDescription>
      </DialogHeader>
      {providers.length > 0 && (
        <>
          {/* 第三方登录在小窗里完成，本页不离开（见 components/auth/oidc-popup.ts） */}
          <OidcProviderButtons
            providers={providers}
            redirectBack={redirectBack}
            mode="popup"
            onLoggedIn={() => refresh().then(user => user && onLoggedIn(user))}
          />
          <SectionDivider>{t('or_continue_with_local_account')}</SectionDivider>
        </>
      )}
      <LocalLoginForm onSuccess={onLoggedIn} />
      <div className="text-center text-sm">
        {t('no_account')}
        {' '}
        <button type="button" className="underline underline-offset-4" onClick={() => onSwitchMode('register')}>
          {t('register')}
        </button>
      </div>
      <div className="text-muted-foreground text-center text-xs text-balance">
        {t('by_logging_in_you_agree_to_our')}
        {' '}
        <Link href={mainPath.privacy} className="underline underline-offset-4 hover:text-primary">
          {t('privacy_policy')}
        </Link>
      </div>
    </>
  )
}
