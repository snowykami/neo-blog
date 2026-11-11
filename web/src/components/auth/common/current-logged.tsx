'use client'

import { LogOut } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import React from 'react'
import { UserAvatar } from '@/components/common/avatar'
import { SectionDivider } from '@/components/common/section-divider'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/auth-context'
import { readRedirectBack } from '@/hooks/use-route'
import { useRouter } from '@/i18n/navigation'
import { formatDisplayName } from '@/utils/common/username'

export function CurrentLogged() {
  const t = useTranslations('Login')
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectBack = readRedirectBack(searchParams)
  const { user, logout } = useAuth()

  const handleLoggedContinue = () => {
    router.push(redirectBack)
  }

  const handleLogOut = () => {
    logout()
  }

  if (!user)
    return null
  return (
    <div className="mb-4">
      <SectionDivider className="mb-4">{t('currently_logged_in')}</SectionDivider>
      <div className="flex justify-evenly items-center border border-border rounded-md p-2">
        <Button
          type="button"
          variant="ghost"
          onClick={handleLoggedContinue}
          title={t('continue')}
          className="h-auto gap-4 px-2 py-1"
        >
          <UserAvatar user={user} className="size-10" />
          <span className="grid place-items-center text-sm leading-tight text-center">
            <span className="text-primary font-medium">{formatDisplayName(user)}</span>
            <span className="text-muted-foreground truncate text-xs font-normal">{user.email}</span>
          </span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleLogOut}
          aria-label={t('logout')}
          title={t('logout')}
          className="text-muted-foreground"
        >
          <LogOut />
        </Button>
      </div>
    </div>
  )
}
