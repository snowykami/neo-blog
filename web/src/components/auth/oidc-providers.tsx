'use client'
import type { OidcConfig } from '@/models/oidc-config'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { listOidcConfigs } from '@/api/user'
import { ImageAvatar } from '@/components/common/avatar'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * 读取后台已启用的第三方登录，登录完成后回到 redirectBack；isBind 为已登录时绑定第三方账号。
 * 读取失败时返回空列表与 error，是否提示由调用方决定
 */
export function useOidcProviders({ redirectBack, isBind = false }: { redirectBack: string, isBind?: boolean }) {
  const [providers, setProviders] = useState<OidcConfig[]>([])
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    let cancelled = false
    listOidcConfigs({ redirectBack, isBind })
      .then((res) => {
        if (cancelled)
          return
        setProviders(res.data ?? [])
        setError(null)
      })
      .catch((err) => {
        if (cancelled)
          return
        setProviders([])
        setError(err)
      })
    return () => {
      cancelled = true
    }
  }, [redirectBack, isBind])

  return { providers, error }
}

/** 第三方登录按钮：icon 为圆形图标按钮（评论区登录邀请），full 为带名称的整行按钮（登录页、快捷登录弹窗） */
export function OidcProviderButtons({
  providers,
  variant = 'full',
  className,
}: {
  providers: OidcConfig[]
  variant?: 'icon' | 'full'
  className?: string
}) {
  const t = useTranslations('Login')
  if (providers.length === 0)
    return null

  return (
    <div className={cn(variant === 'icon' ? 'flex items-center gap-2' : 'grid gap-2', className)}>
      {providers.map((provider, index) => {
        const label = t('login_with', { name: provider.displayName })
        return variant === 'icon'
          ? (
              <Button key={provider.id || provider.loginUrl || index} asChild variant="outline" size="icon" className="shrink-0 rounded-full">
                <a href={provider.loginUrl} title={label} aria-label={label}>
                  <ImageAvatar src={provider.icon} alt="" fallback={provider.displayName.slice(0, 1)} className="size-5" fallbackClassName="text-[10px]" />
                </a>
              </Button>
            )
          : (
              <Button key={provider.id || provider.loginUrl || index} asChild variant="outline" className="w-full">
                <a href={provider.loginUrl}>
                  <ImageAvatar src={provider.icon} alt="" fallback={provider.displayName.slice(0, 1)} className="size-6" fallbackClassName="text-xs" />
                  {label}
                </a>
              </Button>
            )
      })}
    </div>
  )
}
