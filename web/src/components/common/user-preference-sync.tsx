'use client'

import { useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo } from 'react'
import { useAuth } from '@/contexts/auth-context'
import { useSiteInfo } from '@/contexts/site-info-context'
import { readLocaleCookie, writeLocaleCookie } from '@/i18n/locale-cookie'
import { resolveLocale } from '@/locales/registry'
import { applyColorScheme, readStoredColorScheme, writeStoredColorScheme } from '@/themes/color-scheme'
import { fallbackSiteInfo } from '@/utils/common/siteinfo'

/**
 * 登录后把账号偏好同步到本浏览器。服务端渲染不再查当前用户，账号偏好只能在浏览器取到用户后补上：
 * - 界面语言：写进语言 Cookie（服务端按它选语言，见 i18n/request.ts）；与当前页面语言不同时刷新一次服务端数据
 * - 配色：以账号为准，应用到页面并写回 localStorage，下次打开时首帧就是账号的配色（themeInitScript 读它）
 */
export function UserPreferenceSync() {
  const { user } = useAuth()
  const locale = useLocale()
  const router = useRouter()
  const { siteInfo } = useSiteInfo()
  const accountLocale = resolveLocale(user?.language)
  const accountColor = user?.preferredColor
  const colorSchemes = useMemo(
    () => (siteInfo.colorSchemes?.length ? siteInfo.colorSchemes : fallbackSiteInfo.colorSchemes),
    [siteInfo.colorSchemes],
  )

  useEffect(() => {
    if (!accountLocale)
      return
    if (readLocaleCookie(document.cookie) !== accountLocale)
      writeLocaleCookie(accountLocale)
    if (accountLocale !== locale)
      router.refresh()
  }, [accountLocale, locale, router])

  useEffect(() => {
    // 账号没设配色、或设的配色已被后台移除时，保留本地的选择
    if (!accountColor || !colorSchemes.includes(accountColor) || accountColor === readStoredColorScheme())
      return
    applyColorScheme(accountColor)
    writeStoredColorScheme(accountColor)
  }, [accountColor, colorSchemes])

  return null
}
