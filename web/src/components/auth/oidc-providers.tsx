'use client'
import type { OidcConfig } from '@/models/oidc-config'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { getOidcAuthorizeUrl, listOidcConfigs } from '@/api/user'
import { ImageAvatar } from '@/components/common/avatar'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// 列表只含展示信息，页面内共用一次请求（评论区邀请卡片与快捷登录弹窗同时用到），失败后下次重新请求
let providersRequest: Promise<OidcConfig[]> | null = null

function loadOidcProviders() {
  providersRequest ??= listOidcConfigs()
    .then(res => res.data ?? [])
    .catch((error) => {
      providersRequest = null
      throw error
    })
  return providersRequest
}

/** 读取后台已启用的第三方登录；读取失败时返回空列表与 error，是否提示由调用方决定 */
export function useOidcProviders() {
  const [providers, setProviders] = useState<OidcConfig[]>([])
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    let cancelled = false
    loadOidcProviders()
      .then((list) => {
        if (!cancelled)
          setProviders(list)
      })
      .catch((err) => {
        if (!cancelled)
          setError(err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { providers, error }
}

/**
 * 第三方登录按钮：icon 为圆形图标按钮（评论区登录邀请），full 为带名称的整行按钮（登录页、快捷登录弹窗）。
 * 按钮是普通链接，点击时后端才生成 state，完成后回到 redirectBack；bind 为已登录用户绑定第三方账号
 */
export function OidcProviderButtons({
  providers,
  redirectBack,
  bind = false,
  variant = 'full',
  className,
}: {
  providers: OidcConfig[]
  redirectBack: string
  bind?: boolean
  variant?: 'icon' | 'full'
  className?: string
}) {
  const t = useTranslations('Login')
  if (providers.length === 0)
    return null

  return (
    <div className={cn(variant === 'icon' ? 'flex items-center gap-2' : 'grid gap-2', className)}>
      {providers.map((provider) => {
        const label = t('login_with', { name: provider.displayName })
        // nofollow：避免搜索引擎顺着链接反复发起登录
        const href = getOidcAuthorizeUrl({ name: provider.name, redirectBack, bind })
        return variant === 'icon'
          ? (
              <Button key={provider.name} asChild variant="outline" size="icon" className="shrink-0 rounded-full">
                <a href={href} rel="nofollow" title={label} aria-label={label}>
                  <ImageAvatar src={provider.icon} alt="" fallback={provider.displayName.slice(0, 1)} className="size-5" fallbackClassName="text-[10px]" />
                </a>
              </Button>
            )
          : (
              <Button key={provider.name} asChild variant="outline" className="w-full">
                <a href={href} rel="nofollow">
                  <ImageAvatar src={provider.icon} alt="" fallback={provider.displayName.slice(0, 1)} className="size-6" fallbackClassName="text-xs" />
                  {label}
                </a>
              </Button>
            )
      })}
    </div>
  )
}
