'use client'
import type { AuthDialogMode } from '@/components/auth/login-dialog'
import { ArrowLeftRightIcon, LogIn, LogOut, PanelLeft, User, UserPlus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useCallback } from 'react'
import { useAuthDialog } from '@/components/auth/login-dialog'
import { UserAvatar } from '@/components/common/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/contexts/auth-context'
import { useOperationT } from '@/hooks/use-translations'
import { Role } from '@/models/user'
import { consolePath, getUserUrl } from '@/utils/common/route'
import { formatDisplayName } from '@/utils/common/username'

export function AvatarWithDropdownMenu({ className }: { className?: string }) {
  const operationT = useOperationT()
  const routeT = useTranslations('Route')
  const { user, logout } = useAuth()
  const openAuthDialog = useAuthDialog()

  const handleLogout = () => {
    logout()
  }

  // 下拉菜单关闭时 Radix 会把焦点恢复到触发按钮，紧接着打开弹窗会被当成「点到了外面」而立刻关掉，
  // 所以等这一轮事件处理结束再打开
  const openDialog = useCallback((mode: AuthDialogMode) => {
    window.setTimeout(openAuthDialog, 0, mode)
  }, [openAuthDialog])

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={className}
          aria-label={user ? formatDisplayName(user) : operationT('login')}
          title={user ? formatDisplayName(user) : operationT('login')}
        >
          {user
            ? (
                <UserAvatar user={user} size={64} alt="" className="size-7" />
              )
            : (
                <User aria-hidden className="size-5" />
              )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent className="w-auto no-animate" align="end">
        {user && (
          <>
            <DropdownMenuLabel>
              <div className="flex items-center gap-2 p-0 text-left text-sm">
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium max-w-[16ch]">{formatDisplayName(user)}</span>
                  <span className="text-muted-foreground truncate text-xs">{user.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}

        {user && (
          <>
            <DropdownMenuGroup className="p-0">
              <DropdownMenuItem asChild>
                <Link href={getUserUrl(user)}>
                  <User />
                  {routeT('profile')}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link
                  href={user.role === Role.ADMIN ? consolePath.dashboard : consolePath.userProfile}
                >
                  <PanelLeft />
                  {routeT('console')}
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuGroup className="p-0">
          {user
            ? (
                <>
                  <DropdownMenuItem onSelect={() => openDialog('login')}>
                    <ArrowLeftRightIcon />
                    {operationT('switch_account')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleLogout}>
                    <LogOut />
                    {operationT('logout')}
                  </DropdownMenuItem>
                </>
              )
            : (
                <>
                  {/* 顶栏的登录与注册都在当前页弹窗完成，不再跳转到登录页 / 注册页 */}
                  <DropdownMenuItem onSelect={() => openDialog('login')}>
                    <LogIn />
                    {operationT('login')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => openDialog('register')}>
                    <UserPlus />
                    {operationT('register')}
                  </DropdownMenuItem>
                </>
              )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
