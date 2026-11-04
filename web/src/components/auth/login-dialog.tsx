'use client'
import type { User } from '@/models/user'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createContext, use, useCallback, useState } from 'react'
import { LocalLoginForm } from '@/components/auth/local-login-form'
import { OidcProviderButtons, useOidcProviders } from '@/components/auth/oidc-providers'
import { SectionDivider } from '@/components/common/section-divider'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAuth } from '@/contexts/auth-context'
import { registerPath } from '@/hooks/use-route'
import { mainPath } from '@/utils/common/route'

/** 触发快捷登录的操作，决定弹窗里的提示文案 */
export type LoginReason = 'like' | 'reply' | 'comment'

interface LoginRequest {
  reason: LoginReason
  // 账号密码登录成功后继续执行；第三方登录会离开当前页面，回来后不再执行
  onSuccess?: (user: User) => void
}

const LoginDialogContext = createContext<(request: LoginRequest) => void>(() => {})

/** 快捷登录弹窗：在当前页面完成登录，不再跳转到登录页 */
export function LoginDialogProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [request, setRequest] = useState<LoginRequest | null>(null)
  // 记录打开时所在的页面：点了注册、忘记密码等链接跳走后自动关闭
  const [openedAt, setOpenedAt] = useState<string | null>(null)
  const open = openedAt === pathname

  const openLogin = useCallback((next: LoginRequest) => {
    setRequest(next)
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
          className="bg-card sm:max-w-sm"
          // hCaptcha 的验证挑战在弹窗外的 iframe 中，与之交互时不应关闭弹窗
          onInteractOutside={(e) => {
            if (e.target instanceof HTMLIFrameElement)
              e.preventDefault()
          }}
        >
          {request && <LoginDialogBody reason={request.reason} redirectBack={pathname} onLoggedIn={handleLoggedIn} />}
        </DialogContent>
      </Dialog>
    </LoginDialogContext.Provider>
  )
}

function LoginDialogBody({ reason, redirectBack, onLoggedIn }: { reason: LoginReason, redirectBack: string, onLoggedIn: (user: User) => void }) {
  const t = useTranslations('Login')
  const { providers } = useOidcProviders()

  return (
    <>
      <DialogHeader className="text-center sm:text-center">
        <DialogTitle className="text-xl">{t('welcome')}</DialogTitle>
        <DialogDescription>{t(`reason_${reason}`)}</DialogDescription>
      </DialogHeader>
      {providers.length > 0 && (
        <>
          {/* 第三方登录会离开当前页面，完成后回到这里 */}
          <OidcProviderButtons providers={providers} redirectBack={redirectBack} />
          <SectionDivider>{t('or_continue_with_local_account')}</SectionDivider>
        </>
      )}
      <LocalLoginForm onSuccess={onLoggedIn} />
      <div className="text-center text-sm">
        {t('no_account')}
        {' '}
        <Link href={`${registerPath}?redirect_back=${encodeURIComponent(redirectBack)}`} className="underline underline-offset-4">
          {t('register')}
        </Link>
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

/** 打开快捷登录弹窗 */
export function useLoginDialog() {
  return use(LoginDialogContext)
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
