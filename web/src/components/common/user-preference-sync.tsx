'use client'

import { useLocale } from 'next-intl'
import { useEffect, useMemo } from 'react'
import { useAuth } from '@/contexts/auth-context'
import { useSiteInfo } from '@/contexts/site-info-context'
import { readLocaleCookie, readSyncedAccountLocale, switchLocale, writeLocaleCookie, writeSyncedAccountLocale } from '@/i18n/locale-cookie'
import { resolveLocale } from '@/locales/registry'
import { applyColorScheme, readStoredColorScheme, writeStoredColorScheme } from '@/themes/color-scheme'
import { fallbackSiteInfo } from '@/utils/common/siteinfo'

/**
 * 登录后把账号偏好同步到本浏览器。服务端渲染不再查当前用户，账号偏好只能在浏览器取到用户后补上：
 * - 界面语言：账号语言是新设的（或本浏览器第一次同步）时，写进语言 Cookie 并跳到该语言的地址；
 *   之后在本浏览器用语言切换选的语言优先，不再被账号语言覆盖（proxy.ts 按 Cookie 决定首次访问跳到哪种语言）
 * - 配色：以账号为准，应用到页面并写回 localStorage，下次打开时首帧就是账号的配色（themeInitScript 读它）
 */
export function UserPreferenceSync() {
  const { user } = useAuth()
  const locale = useLocale()
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
    const cookieLocale = resolveLocale(readLocaleCookie(document.cookie))
    if (cookieLocale && readSyncedAccountLocale() === accountLocale)
      return
    writeSyncedAccountLocale(accountLocale)
    if (accountLocale === locale) {
      if (cookieLocale !== accountLocale)
        writeLocaleCookie(accountLocale)
      return
    }
    switchLocale(accountLocale)
  }, [accountLocale, locale])

  useEffect(() => {
    // 账号没设配色、或设的配色已被后台移除时，保留本地的选择
    if (!accountColor || !colorSchemes.includes(accountColor) || accountColor === readStoredColorScheme())
      return
    applyColorScheme(accountColor)
    writeStoredColorScheme(accountColor)
  }, [accountColor, colorSchemes])

  return null
}
