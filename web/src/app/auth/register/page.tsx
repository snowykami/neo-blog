'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { AuthHeader } from '@/components/auth/common/auth-header'
import { CurrentLogged } from '@/components/auth/common/current-logged'
import { LocalRegisterForm } from '@/components/auth/local-register-form'
import { SectionDivider } from '@/components/common/section-divider'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { mainPath } from '@/utils/common/route'

export default function Page() {
  return (
    <>
      <AuthHeader />
      <RegisterForm />
    </>
  )
}

/** 注册页：表单本身与快捷登录弹窗的注册视图共用（components/auth/local-register-form.tsx） */
export function RegisterForm({ className, ...props }: React.ComponentProps<'div'>) {
  const t = useTranslations('Register')
  const routeT = useTranslations('Route')
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectBack = searchParams.get('redirect_back') || '/'

  return (
    <div className={cn('', className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">{t('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <CurrentLogged />
          <div className="grid gap-4">
            <SectionDivider className="mt-0">{t('register_a_new_account')}</SectionDivider>
            <LocalRegisterForm redirectBack={redirectBack} onSuccess={() => router.push(redirectBack)} />
          </div>
        </CardContent>
      </Card>
      {/* 隐私政策提示 */}
      <div className="text-muted-foreground text-center text-xs text-balance">
        {t('by_registering_you_agree_to_our')}
        {' '}
        <Link href={mainPath.privacy} className="underline underline-offset-4 hover:text-primary">
          {routeT('privacy_policy')}
        </Link>
      </div>
    </div>
  )
}
