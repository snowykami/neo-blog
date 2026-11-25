'use client'

import type { LoginReason } from './login-dialog'
import { LogIn } from 'lucide-react'
import { GuestAvatar } from '@/components/common/avatar'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/auth-context'
import { useOperationT } from '@/hooks/use-translations'
import { usePathname } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import { useLoginDialog } from './login-dialog'
import { OidcProviderButtons, useOidcProviders } from './oidc-providers'

export interface GuestLoginInviteProps {
  title: string
  description?: string
  reason?: LoginReason
  className?: string
}

/**
 * 未登录时的通用登录引导条（供评论区、友链申请区等互动模块复用）：
 * 展示后台已启用的第三方小窗快捷登录按钮与登录弹窗入口，登录完成后原地刷新状态而不离开当前页面
 */
export function GuestLoginInvite({
  title,
  description,
  reason,
  className,
}: GuestLoginInviteProps) {
  const operationT = useOperationT()
  const openLogin = useLoginDialog()
  const pathname = usePathname()
  const { refresh } = useAuth()
  const { providers } = useOidcProviders()

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-primary/30 bg-primary/5 p-4 fade-in-up sm:flex-nowrap',
        className,
      )}
    >
      <GuestAvatar />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
        <OidcProviderButtons
          providers={providers}
          redirectBack={pathname}
          variant="icon"
          mode="popup"
          onLoggedIn={() => refresh()}
        />
        <Button type="button" className="flex-1 sm:flex-none" onClick={() => openLogin({ reason })}>
          <LogIn />
          {operationT('login')}
        </Button>
      </div>
    </div>
  )
}
