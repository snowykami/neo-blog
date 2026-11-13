'use client'

import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { updateUser } from '@/api/user'
import { ColorSchemeSelector } from '@/components/console/common/color-scheme-selector'
import { AIWritingHabitForm } from '@/components/tiptap-editor/ai-writing-habit-form'
import { useAuth } from '@/contexts/auth-context'
import { useErrorMessageT } from '@/hooks/use-translations'
import { Link } from '@/i18n/navigation'
import { isEditor } from '@/utils/common/permission'
import { mainPath } from '@/utils/common/route'

export function UserPreferencePage() {
  const t = useTranslations('Console.user_preference')
  const errorMessageT = useErrorMessageT()
  const { user, setUser } = useAuth()
  const [color, setColor] = useState<string | null>(user?.preferredColor || null)

  useEffect(() => {
    // 与当前用户配置一致时无需请求（包括挂载时以及同步到 context 之后）
    if (!color || !user || color === user.preferredColor)
      return
    const previousColor = user.preferredColor
    if (typeof window !== 'undefined') {
      document.documentElement.setAttribute('data-user-color', color)
    }
    updateUser({ id: user.id, preferredColor: color }).then(() => {
      // 同步到全局用户状态，其他使用 user.preferredColor 的地方无需刷新页面
      setUser({ ...user, preferredColor: color })
    }).catch((error) => {
      if (typeof window !== 'undefined') {
        document.documentElement.setAttribute('data-user-color', previousColor || 'blue')
      }
      setColor(previousColor || null)
      toast.error(t('update_color_scheme_failed'), {
        description: errorMessageT(error),
      })
    })
  }, [color, errorMessageT, user, setUser, t])

  const onColorChange = useCallback((color: string) => {
    setColor(color)
  }, [])

  return (
    <div>
      <div className="grid w-full items-center gap-4">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <div className="grid gap-2">
          <h2 className="text">{t('color_scheme')}</h2>
          {user && <ColorSchemeSelector color={color} onColorChange={onColorChange} />}
        </div>
        {/* 通知设置的开关都在独立页里管理，这里只放一句引导，避免两处都能改 */}
        <div className="grid gap-2">
          <h2 className="text">{t('notification')}</h2>
          <p className="text-muted-foreground text-sm text-balance">{t('notification_desc')}</p>
          <div>
            <Link href={mainPath.notificationSettings} className="text-primary text-sm underline underline-offset-4 hover:opacity-80">
              {t('notification_link')}
            </Link>
          </div>
        </div>
        {/* AI 写作只对编辑者与管理员开放 */}
        {user && isEditor({ user }) && (
          <div className="grid gap-2">
            <h2 className="text">{t('ai_writing')}</h2>
            <AIWritingHabitForm className="max-w-2xl" />
          </div>
        )}
      </div>
    </div>
  )
}
