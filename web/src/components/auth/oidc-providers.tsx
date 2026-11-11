'use client'
import type { OidcConfig } from '@/models/oidc-config'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { getOidcAuthorizeUrl, listOidcConfigs } from '@/api/user'
import { openOidcPopup } from '@/components/auth/oidc-popup'
import { ImageAvatar } from '@/components/common/avatar'
import { Button } from '@/components/ui/button'
import { useErrorMessageT } from '@/hooks/use-translations'
import { localizePath } from '@/i18n/routing'
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
 * 默认是普通链接，点击时后端才生成 state，完成后回到 redirectBack（离开当前页面）；
 * mode 为 popup 时改为在小窗里完成认证（见 openOidcPopup），成功后调用 onLoggedIn，本页不离开。
 * bind 为已登录用户绑定第三方账号
 */
export function OidcProviderButtons({
  providers,
  redirectBack,
  bind = false,
  variant = 'full',
  mode = 'redirect',
  onLoggedIn,
  className,
}: {
  providers: OidcConfig[]
  redirectBack: string
  bind?: boolean
  variant?: 'icon' | 'full'
  mode?: 'redirect' | 'popup'
  // 小窗登录成功后调用（Cookie 已写好，调用方负责重新拉取登录状态）
  onLoggedIn?: () => void
  className?: string
}) {
  const t = useTranslations('Login')
  const errorMessageT = useErrorMessageT()
  const [pending, setPending] = useState<string | null>(null)
  // 整页跳转登录后由后端带回这个地址：带上当前语言前缀，回来时仍是同一种语言
  const localizedRedirectBack = localizePath(redirectBack, useLocale())

  if (providers.length === 0)
    return null

  const loginInPopup = (provider: OidcConfig) => {
    // 触屏设备（iOS Safari 等）把小窗当成新标签页打开，跳到身份提供商再回来后与本页的关联会断开，
    // 本页收不到「登录完成」，只能手动刷新：直接整页跳转，登录后回到当前页面
    if (window.matchMedia('(pointer: coarse)').matches) {
      window.location.href = getOidcAuthorizeUrl({ name: provider.name, redirectBack: localizedRedirectBack, bind })
      return
    }
    setPending(provider.name)
    openOidcPopup({ name: provider.name, bind })
      .then((result) => {
        if (result.ok) {
          onLoggedIn?.()
          return
        }
        if (result.blocked) {
          // 小窗被拦截：退回整页跳转
          window.location.href = getOidcAuthorizeUrl({ name: provider.name, redirectBack: localizedRedirectBack, bind })
          return
        }
        if (result.error)
          toast.error(`${t('oidc_login_failed')}: ${errorMessageT(result.error)}`)
      })
      .finally(() => setPending(null))
  }

  return (
    <div className={cn(variant === 'icon' ? 'flex items-center gap-2' : 'grid gap-2', className)}>
      {providers.map((provider) => {
        const label = t('login_with', { name: provider.displayName })
        // nofollow：避免搜索引擎顺着链接反复发起登录
        const href = getOidcAuthorizeUrl({ name: provider.name, redirectBack: localizedRedirectBack, bind })
        const icon = (
          <ImageAvatar
            src={provider.icon}
            alt=""
            fallback={provider.displayName.slice(0, 1)}
            className={variant === 'icon' ? 'size-5' : 'size-6'}
            fallbackClassName={variant === 'icon' ? 'text-[10px]' : 'text-xs'}
          />
        )

        if (mode === 'popup') {
          return (
            <Button
              key={provider.name}
              type="button"
              variant="outline"
              className={variant === 'icon' ? 'shrink-0 rounded-full' : 'w-full'}
              size={variant === 'icon' ? 'icon' : 'default'}
              disabled={pending != null}
              title={label}
              aria-label={label}
              onClick={() => loginInPopup(provider)}
            >
              {icon}
              {variant === 'icon' ? <span className="sr-only">{label}</span> : label}
            </Button>
          )
        }

        return variant === 'icon'
          ? (
              <Button key={provider.name} asChild variant="outline" size="icon" className="shrink-0 rounded-full">
                <a href={href} rel="nofollow" title={label} aria-label={label}>
                  {icon}
                </a>
              </Button>
            )
          : (
              <Button key={provider.name} asChild variant="outline" className="w-full">
                <a href={href} rel="nofollow">
                  {icon}
                  {label}
                </a>
              </Button>
            )
      })}
    </div>
  )
}
