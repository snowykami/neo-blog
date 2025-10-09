'use client'
import { ArrowLeftRightIcon, LogIn, LogOut, PanelLeft, User } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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
import { useOperationT } from '@/hooks/translations'
import { useToLogin } from '@/hooks/use-route'
import { Role } from '@/models/user'
import { getAvatarOrGravatarUrlFromUser } from '@/utils/common/gravatar'
import { consolePath } from '@/utils/common/route'
import { formatDisplayName, getFallbackAvatarFromUsername } from '@/utils/common/username'

export function AvatarWithDropdownMenu() {
  const operationT = useOperationT()
  const routeT = useTranslations('Route')
  const { user, logout } = useAuth()
  const toLogin = useToLogin()

  const handleLogout = () => {
    logout()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <div className="">
          {
            user
              ? (
                  <Avatar className="h-7 w-7 rounded-full border-1">
                    <AvatarImage className="rounded-full h-7 w-7" src={getAvatarOrGravatarUrlFromUser({ user })} alt={user.username} />
                    <AvatarFallback className="rounded-full h-7 w-7">{getFallbackAvatarFromUsername(user.nickname || user.username)}</AvatarFallback>
                  </Avatar>
                )
              : <User className="h-7 w-7" />
          }
        </div>
      </DropdownMenuTrigger>

      <DropdownMenuContent className="w-auto no-animate" align="start">
        {user
          && (
            <>
              <DropdownMenuLabel>
                <div className="flex items-center gap-2 p-0 text-left text-sm">
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{formatDisplayName(user)}</span>
                    <span className="text-muted-foreground truncate text-xs">
                      {user.email}
                    </span>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
            </>
          )}

        {user
          && (
            <>
              <DropdownMenuGroup className="p-0">
                <DropdownMenuItem asChild>
                  <Link href={`/u/${user?.username}`}>
                    <User />
                    {routeT('profile')}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={user.role === Role.ADMIN ? consolePath.dashboard : consolePath.userProfile}>
                    <PanelLeft />
                    {routeT('console')}
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          )}
        <DropdownMenuGroup className="p-0">
          {user && (
            <DropdownMenuItem onClick={toLogin}>
              <ArrowLeftRightIcon />
              {operationT('switch_account')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={user ? handleLogout : toLogin}>
            {user
              ? (
                  <>
                    <LogOut />
                    {operationT('logout')}
                  </>
                )
              : (
                  <>
                    <LogIn />
                    {operationT('login')}
                  </>
                )}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
