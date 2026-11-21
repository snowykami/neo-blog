'use client'

import type { NotificationPreferences } from '@/models/notification'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { getNotificationPreferences } from '@/api/notification'
import { updateUser } from '@/api/user'
import { ColorSchemeSelector } from '@/components/console/common/color-scheme-selector'
import { FloatingSaveBar, useSaveCoordinator } from '@/components/console/common/floating-save-bar'
import { DesktopIslandSettingsForm } from '@/components/console/user-preference/desktop-island-settings-form'
import { NotificationPreferencesForm } from '@/components/notification/notification-preferences-form'
import { AIWritingHabitForm } from '@/components/tiptap-editor/ai-writing-habit-form'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/contexts/auth-context'
import { useSiteInfo } from '@/contexts/site-info-context'
import { useColorSchemeName } from '@/hooks/use-color-scheme-name'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { writeLocaleCookie } from '@/i18n/locale-cookie'
import { Link } from '@/i18n/navigation'
import { LOCALES, resolveLocale } from '@/locales/registry'
import { isEditor } from '@/utils/common/permission'
import { mainPath } from '@/utils/common/route'

export function UserPreferencePage() {
  const t = useTranslations('Console.user_preference')
  const profileT = useTranslations('Console.user_profile')
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const schemeName = useColorSchemeName()
  const { user, setUser } = useAuth()
  const { siteInfo } = useSiteInfo()

  const [color, setColor] = useState<string | null>(user?.preferredColor || null)
  const [language, setLanguage] = useState<string>(() => resolveLocale(user?.language) ?? user?.language ?? 'zh')
  const [savingLang, setSavingLang] = useState(false)
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences | null>(null)
  const [notifLoading, setNotifLoading] = useState(true)
  const saveCtrl = useSaveCoordinator()

  const handleSaveAll = async () => {
    const { savedCount, hasInvalid, hasError } = await saveCtrl.saveAll()
    if (savedCount > 0 && !hasInvalid && !hasError)
      toast.success(operationT('save_success'))
  }

  // 记录首次同步，避免未设过主题色的用户刚打开页面时弹出「更新成功」提示
  const hadInitialColorRef = useRef(Boolean(user?.preferredColor))

  useEffect(() => {
    if (!user)
      return
    const nextLang = resolveLocale(user.language) ?? user.language
    if (nextLang)
      setLanguage(nextLang)
  }, [user])

  useEffect(() => {
    if (!user)
      return
    let cancelled = false
    setNotifLoading(true)
    getNotificationPreferences({})
      .then((res) => {
        if (!cancelled)
          setNotifPrefs(res.data)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled)
          setNotifLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [user])

  useEffect(() => {
    // 与当前用户配置一致时无需请求（包括挂载时以及同步到 context 之后）
    if (!color || !user || color === user.preferredColor)
      return
    const previousColor = user.preferredColor
    const shouldToast = hadInitialColorRef.current
    hadInitialColorRef.current = true
    if (typeof window !== 'undefined') {
      document.documentElement.setAttribute('data-user-color', color)
    }
    updateUser({ id: user.id, preferredColor: color }).then(() => {
      // 同步到全局用户状态，其他使用 user.preferredColor 的地方无需刷新页面
      setUser({ ...user, preferredColor: color })
      if (shouldToast) {
        toast.success(`${operationT('update_success')} · ${schemeName(color)}`)
      }
    }).catch((error) => {
      if (typeof window !== 'undefined') {
        document.documentElement.setAttribute('data-user-color', previousColor || 'blue')
      }
      setColor(previousColor || null)
      toast.error(t('update_color_scheme_failed'), {
        description: errorMessageT(error),
      })
    })
  }, [color, errorMessageT, operationT, schemeName, user, setUser, t])

  const onColorChange = useCallback((nextColor: string) => {
    setColor(nextColor)
  }, [])

  const onLanguageChange = async (nextLang: string) => {
    if (!user || savingLang)
      return
    const prevLang = resolveLocale(user.language) ?? user.language ?? 'zh'
    if (nextLang === prevLang)
      return
    setLanguage(nextLang)
    setSavingLang(true)
    try {
      await updateUser({ id: user.id, language: nextLang })
      const resolved = resolveLocale(nextLang)
      if (resolved)
        writeLocaleCookie(resolved)
      setUser({ ...user, language: nextLang })
      toast.success(operationT('update_success'))
      if (resolved && resolved !== prevLang) {
        window.setTimeout(() => window.location.reload(), 300)
      }
    }
    catch (error) {
      setLanguage(prevLang)
      toast.error(errorMessageT(error))
    }
    finally {
      setSavingLang(false)
    }
  }

  return (
    <div className="grid w-full max-w-2xl gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">{t('appearance_and_language')}</CardTitle>
            {color && <Badge variant="secondary">{schemeName(color)}</Badge>}
          </div>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="pref-language">{profileT('language')}</Label>
            <Select value={language} disabled={savingLang} onValueChange={next => void onLanguageChange(next)}>
              <SelectTrigger id="pref-language" className="w-full sm:max-w-xs">
                <SelectValue placeholder={profileT('select_language')} />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(LOCALES).map(([code, { name }]) => (
                  <SelectItem key={code} value={code}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>{t('color_scheme')}</Label>
            {user && <ColorSchemeSelector color={color} onColorChange={onColorChange} />}
          </div>
        </CardContent>
      </Card>

      {notifLoading
        ? <Skeleton className="h-44 w-full rounded-xl" />
        : notifPrefs
          ? <NotificationPreferencesForm initial={notifPrefs} coordinator={saveCtrl.coordinator} />
          : (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('notification')}</CardTitle>
                  <CardDescription>{t('notification_desc')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Link href={mainPath.notificationSettings} className="text-sm text-primary underline underline-offset-4 hover:opacity-80">
                    {t('notification_link')}
                  </Link>
                </CardContent>
              </Card>
            )}

      {siteInfo.musicEnabled && <DesktopIslandSettingsForm coordinator={saveCtrl.coordinator} />}

      {/* AI 写作只对编辑者与管理员开放 */}
      {user && isEditor({ user }) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('ai_writing')}</CardTitle>
          </CardHeader>
          <CardContent>
            <AIWritingHabitForm coordinator={saveCtrl.coordinator} />
          </CardContent>
        </Card>
      )}

      <FloatingSaveBar
        dirty={saveCtrl.dirty}
        saving={saveCtrl.saving}
        onReset={saveCtrl.resetAll}
        onSave={() => void handleSaveAll()}
      />
    </div>
  )
}
