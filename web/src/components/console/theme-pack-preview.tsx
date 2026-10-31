'use client'

import { MoonIcon, SparklesIcon, SunIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { THEME_PACK_STORAGE_KEY, useTheme } from '@/contexts/theme-context'
import { BUILTIN_THEMES } from '@/themes'
import { readPreviewCookie, THEME_PREVIEW_AUTO, THEME_PREVIEW_NEVER, writePreviewCookie } from '@/themes/preview'

/**
 * 节日主题预览（控制台 → 全局设置 → 外观）。
 *
 * 节日主题按日期自动触发，一年只有几天能看到效果，改配色时几乎没法验证，
 * 所以这里给管理员一个强制指定主题的入口，选择写进 cookie（服务端渲染即可读到，刷新不闪）。
 * 只对本浏览器生效，不影响访客；具体权限校验在 utils/server/theme-preview.ts。
 */
export function ThemePackPreviewField() {
  const t = useTranslations('Console.global')
  const tPack = useTranslations('ThemePack')
  const tMode = useTranslations('ThemeMode')
  const router = useRouter()
  const { theme, enabled } = useTheme()
  const [preview, setPreview] = useState(THEME_PREVIEW_AUTO)
  const [, startTransition] = useTransition()

  // cookie 是浏览器端的，挂载后再回显，避免与静态结构不一致
  useEffect(() => {
    setPreview(readPreviewCookie())
  }, [])

  const themeName = (id: string) => tPack.has(`names.${id}`) ? tPack(`names.${id}`) : id

  const handleChange = (value: string) => {
    setPreview(value)
    writePreviewCookie(value === THEME_PREVIEW_AUTO ? null : value)
    // 预览就是「要看效果」，所以顺手把本浏览器的「关闭节日主题」偏好清掉，否则选了也看不见
    // 「从不使用」本身就是要关掉，不需要清
    if (value !== THEME_PREVIEW_AUTO && value !== THEME_PREVIEW_NEVER)
      localStorage.removeItem(THEME_PACK_STORAGE_KEY)
    startTransition(() => router.refresh())
  }

  return (
    <div className="grid gap-2 md:col-span-2">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <SparklesIcon aria-hidden className="size-4 text-primary" />
        {t('theme_pack_preview')}
      </div>
      <Select value={preview} onValueChange={handleChange}>
        <SelectTrigger className="w-full md:w-72">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={THEME_PREVIEW_AUTO}>{t('theme_pack_preview_auto')}</SelectItem>
          <SelectItem value={THEME_PREVIEW_NEVER}>{t('theme_pack_preview_never')}</SelectItem>
          {BUILTIN_THEMES.map(item => (
            <SelectItem key={item.id} value={item.id}>
              <span className="flex items-center gap-2">
                {item.mode === 'dark'
                  ? <MoonIcon aria-hidden className="size-3.5 shrink-0 opacity-60" />
                  : item.mode === 'light'
                    ? <SunIcon aria-hidden className="size-3.5 shrink-0 opacity-60" />
                    : null}
                {themeName(item.id)}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{t('theme_pack_preview_desc')}</p>
      <p className="text-xs text-muted-foreground">
        {theme ? t('theme_pack_preview_active', { name: themeName(theme.id) }) : t('theme_pack_preview_none')}
        {theme?.mode && enabled && ` · ${tMode(`${theme.mode}_mode`)}`}
      </p>
    </div>
  )
}
