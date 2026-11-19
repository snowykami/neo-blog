'use client'

import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { updateUser } from '@/api/user'
import { ColorSchemeSelector } from '@/components/console/common/color-scheme-selector'
import { DesktopIslandSettingsForm } from '@/components/console/user-preference/desktop-island-settings-form'
import { AIWritingHabitForm } from '@/components/tiptap-editor/ai-writing-habit-form'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/contexts/auth-context'
import { useSiteInfo } from '@/contexts/site-info-context'
import { useColorSchemeName } from '@/hooks/use-color-scheme-name'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { Link } from '@/i18n/navigation'
import { isEditor } from '@/utils/common/permission'
import { mainPath } from '@/utils/common/route'

export function UserPreferencePage() {
  const t = useTranslations('Console.user_preference')
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const schemeName = useColorSchemeName()
  const { user, setUser } = useAuth()
  const { siteInfo } = useSiteInfo()
  const [color, setColor] = useState<string | null>(user?.preferredColor || null)
  // 记录首次同步，避免未设过主题色的用户刚打开页面时弹出「更新成功」提示
  const hadInitialColorRef = useRef(Boolean(user?.preferredColor))

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

  return (
    <div className="grid w-full max-w-2xl gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">{t('color_scheme')}</CardTitle>
            {color && <Badge variant="secondary">{schemeName(color)}</Badge>}
          </div>
        </CardHeader>
        <CardContent>
          {user && <ColorSchemeSelector color={color} onColorChange={onColorChange} />}
        </CardContent>
      </Card>

      {/* 通知设置的开关都在独立页里管理，这里只放一句引导，避免两处都能改 */}
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

      {siteInfo.musicEnabled && <DesktopIslandSettingsForm />}

      {/* AI 写作只对编辑者与管理员开放 */}
      {user && isEditor({ user }) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('ai_writing')}</CardTitle>
          </CardHeader>
          <CardContent>
            <AIWritingHabitForm />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
