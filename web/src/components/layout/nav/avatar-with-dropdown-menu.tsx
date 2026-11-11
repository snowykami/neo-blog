'use client'
import type { AuthDialogMode } from '@/components/auth/login-dialog'
import { ArrowLeftRightIcon, Bell, LogIn, LogOut, PanelLeft, User, UserPlus } from 'lucide-react'
import { useTranslations } from 'next-intl'
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
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/contexts/auth-context'
import { useUnreadNotificationCount } from '@/hooks/use-notification-unread'
import { useOperationT } from '@/hooks/use-translations'
import { Link } from '@/i18n/navigation'
import { Role } from '@/models/user'
import { consolePath, getUserUrl, mainPath } from '@/utils/common/route'
import { formatDisplayName } from '@/utils/common/username'

export function AvatarWithDropdownMenu({ className }: { className?: string }) {
  const operationT = useOperationT()
  const routeT = useTranslations('Route')
  const { user, loading, logout } = useAuth()
  const openAuthDialog = useAuthDialog()
  const { count: unreadCount } = useUnreadNotificationCount()
  const notificationsT = useTranslations('Notifications')

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
          // 未读小圆点只是视觉提示，读屏通过按钮名称得知有未读通知
          aria-label={user
            ? (unreadCount > 0 ? notificationsT('account_with_unread', { name: formatDisplayName(user) }) : formatDisplayName(user))
            : operationT('login')}
          title={user ? formatDisplayName(user) : operationT('login')}
          // 登录状态在浏览器里确认（服务端外壳对所有人一致），确认前显示与头像同尺寸的占位，避免先出现登录菜单
          disabled={loading}
          aria-busy={loading || undefined}
        >
          <span className="relative inline-flex">
            {loading
              ? <Skeleton aria-hidden className="size-7 rounded-full" />
              : user
                ? (
                    <UserAvatar user={user} size={64} alt="" className="size-7" />
                  )
                : (
                    <User aria-hidden className="size-5" />
                  )}
            {/* 有未读通知时只在头像右上角点一个小圆点（跟随主题色），不显示数字：提示这里可以点开 */}
            {user && unreadCount > 0 && (
              <span
                aria-hidden
                className="bg-primary ring-background absolute -top-0.5 -right-0.5 size-2 rounded-full ring-2"
              />
            )}
          </span>
        </button>
      </DropdownMenuTrigger>

      {/* 非模态菜单在 iOS 上轻点打开后，焦点随即落回触发按钮，被当成「焦点移出菜单」立刻关掉（菜单一闪而过）：
          不按焦点移出关闭，点到菜单外仍会关闭 */}
      <DropdownMenuContent className="w-auto no-animate" align="end" onFocusOutside={event => event.preventDefault()}>
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
              {/* 通知是登录后最常回访的入口，放在第一项；未读数只用头像上的小点示意，这里不显示数字 */}
              <DropdownMenuItem asChild>
                <Link href={mainPath.notifications}>
                  <Bell />
                  {notificationsT('title')}
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
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
