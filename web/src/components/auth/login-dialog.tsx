'use client'
import type { User } from '@/models/user'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createContext, use, useCallback, useState } from 'react'
import { LocalLoginForm } from '@/components/auth/local-login-form'
import { LocalRegisterForm } from '@/components/auth/local-register-form'
import { OidcProviderButtons, useOidcProviders } from '@/components/auth/oidc-providers'
import { SectionDivider } from '@/components/common/section-divider'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAuth } from '@/contexts/auth-context'
import { mainPath } from '@/utils/common/route'

/** 触发快捷登录的操作，决定弹窗里的提示文案 */
export type LoginReason = 'like' | 'reply' | 'comment'

/** 弹窗的两个视图：登录（含第三方登录）与注册 */
export type AuthDialogMode = 'login' | 'register'

interface LoginRequest {
  // 不传时用通用提示（顶栏的登录 / 注册入口）
  reason?: LoginReason
  mode?: AuthDialogMode
  // 登录或注册成功后继续执行；第三方登录在小窗里完成后同样会执行
  onSuccess?: (user: User) => void
}

const LoginDialogContext = createContext<(request?: LoginRequest) => void>(() => {})

/** 快捷登录 / 注册弹窗：在当前页面完成登录，不再跳转到登录页或注册页 */
export function LoginDialogProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [request, setRequest] = useState<LoginRequest | null>(null)
  const [mode, setMode] = useState<AuthDialogMode>('login')
  // 记录打开时所在的页面：点了隐私政策、忘记密码等链接跳走后自动关闭
  const [openedAt, setOpenedAt] = useState<string | null>(null)
  const open = openedAt === pathname

  const openLogin = useCallback((next: LoginRequest = {}) => {
    setRequest(next)
    setMode(next.mode ?? 'login')
    setOpenedAt(pathname)
  }, [pathname])

  const handleLoggedIn = (user: User) => {
    setOpenedAt(null)
    request?.onSuccess?.(user)
  }

  return (
    <LoginDialogContext.Provider value={openLogin}>
      {children}
      <Dialog open={open} onOpenChange={next => !next && setOpenedAt(null)}>
        <DialogContent
          // 注册视图比登录长，矮屏幕上在弹窗内滚动，不把按钮挤出可视区
          className="bg-card max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-sm"
          // hCaptcha 的验证挑战在弹窗外的 iframe 中，与之交互时不应关闭弹窗
          onInteractOutside={(e) => {
            if (e.target instanceof HTMLIFrameElement)
              e.preventDefault()
          }}
        >
          {request && (
            <LoginDialogBody
              mode={mode}
              reason={request.reason}
              redirectBack={pathname}
              onSwitchMode={setMode}
              onLoggedIn={handleLoggedIn}
            />
          )}
        </DialogContent>
      </Dialog>
    </LoginDialogContext.Provider>
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

/** 打开快捷登录弹窗（默认登录视图，mode 传 register 直接显示注册） */
export function useLoginDialog() {
  return use(LoginDialogContext)
}

/** 顶栏等处的登录 / 注册入口：打开同一个弹窗的两个视图 */
export function useAuthDialog() {
  const open = useLoginDialog()
  return useCallback((mode: AuthDialogMode = 'login') => open({ mode }), [open])
}

/**
 * 需要登录的操作：已登录直接执行，未登录弹出快捷登录，登录成功后接着执行。
 * action 里不要再判断登录状态（它捕获的仍是登录前的渲染）
 */
export function useRequireLogin() {
  const { user } = useAuth()
  const openLogin = useLoginDialog()
  return (action: () => void, reason: LoginReason) => {
    if (user)
      action()
    else
      openLogin({ reason, onSuccess: action })
  }
}
