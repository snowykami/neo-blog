'use client'
import type { User } from '@/models/user'
import dynamic from 'next/dynamic'
import { createContext, use, useCallback, useState } from 'react'
import { useAuth } from '@/contexts/auth-context'
import { usePathname } from '@/i18n/navigation'

const LoginDialogModal = dynamic(
  () => import('./login-dialog-body').then(m => m.LoginDialogModal),
  { ssr: false },
)

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

/** 快捷登录 / 注册弹窗：在当前页面完成登录，不再跳转到登录页或注册页；首次打开时才按需加载表单与人机验证代码 */
export function LoginDialogProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [request, setRequest] = useState<LoginRequest | null>(null)
  const [mode, setMode] = useState<AuthDialogMode>('login')
  // 记录打开时所在的页面：点了隐私政策、忘记密码等链接跳走后自动关闭
  const [openedAt, setOpenedAt] = useState<string | null>(null)
  const [everOpened, setEverOpened] = useState(false)
  const open = openedAt === pathname

  const openLogin = useCallback((next: LoginRequest = {}) => {
    setRequest(next)
    setMode(next.mode ?? 'login')
    setOpenedAt(pathname)
    setEverOpened(true)
  }, [pathname])

  const handleLoggedIn = (user: User) => {
    setOpenedAt(null)
    request?.onSuccess?.(user)
  }

  return (
    <LoginDialogContext.Provider value={openLogin}>
      {children}
      {everOpened && (
        <LoginDialogModal
          open={open}
          onOpenChange={next => !next && setOpenedAt(null)}
          mode={mode}
          reason={request?.reason}
          redirectBack={pathname}
          hasRequest={Boolean(request)}
          onSwitchMode={setMode}
          onLoggedIn={handleLoggedIn}
        />
      )}
    </LoginDialogContext.Provider>
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
