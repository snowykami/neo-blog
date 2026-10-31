'use client'

import { CheckIcon, PaletteIcon, SparklesIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { updateUser } from '@/api/user'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/contexts/auth-context'
import { useSiteInfo } from '@/contexts/site-info-context'
import { useTheme } from '@/contexts/theme-context'
import { cn } from '@/lib/utils'
import { fallbackSiteInfo } from '@/utils/common/siteinfo'

// 访客也能切换配色：选择结果保存在 localStorage；登录用户额外同步到账号偏好
export const COLOR_SCHEME_STORAGE_KEY = 'color-scheme'

function applyColorScheme(scheme: string) {
  if (typeof document !== 'undefined')
    document.documentElement.setAttribute('data-user-color', scheme)
}

function readStoredColorScheme(): string | null {
  try {
    return localStorage.getItem(COLOR_SCHEME_STORAGE_KEY)
  }
  catch {
    return null
  }
}

function writeStoredColorScheme(scheme: string) {
  try {
    localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, scheme)
  }
  catch {
    // 隐私模式等场景写入失败时忽略，仅影响下次访问的默认配色
  }
}

/**
 * 当前配色及其切换逻辑：优先级为「本地保存 > 账号偏好 > 站点默认配色」
 * 配色通过 html 的 data-user-color 生效，与后台个性化设置保持同一套机制
 */
export function useColorScheme() {
  const { siteInfo } = useSiteInfo()
  const { user, setUser } = useAuth()
  const t = useTranslations('ColorScheme')

  const colorSchemes = useMemo(
    () => (siteInfo.colorSchemes?.length ? siteInfo.colorSchemes : fallbackSiteInfo.colorSchemes),
    [siteInfo.colorSchemes],
  )
  const defaultColorScheme = siteInfo.defaultColorScheme || fallbackSiteInfo.defaultColorScheme
  const [color, setColor] = useState(defaultColorScheme)

  // 服务端渲染读不到 localStorage，挂载后再按优先级确定一次当前配色
  useEffect(() => {
    const stored = readStoredColorScheme()
    const next = [stored, user?.preferredColor, defaultColorScheme]
      .find(item => !!item && colorSchemes.includes(item))
    if (!next)
      return
    setColor(next)
    applyColorScheme(next)
  }, [colorSchemes, defaultColorScheme, user?.preferredColor])

  const selectColor = useCallback((scheme: string) => {
    if (scheme === color)
      return
    const previous = color
    setColor(scheme)
    applyColorScheme(scheme)
    writeStoredColorScheme(scheme)
    if (!user)
      return
    updateUser({ id: user.id, preferredColor: scheme })
      .then(() => {
        // 同步到全局用户状态，其他使用 user.preferredColor 的地方无需刷新页面
        setUser({ ...user, preferredColor: scheme })
      })
      .catch((error) => {
        // 同步失败时回滚到切换前的配色，避免本地与账号偏好不一致
        setColor(previous)
        applyColorScheme(previous)
        writeStoredColorScheme(previous)
        toast.error(t('update_failed'), {
          description: error.message,
        })
      })
  }, [color, t, user, setUser])

  return { color, colorSchemes, selectColor }
}

/**
 * 配色圆形色块：data-user-color 让每个圆点按对应配色计算自己的主色
 */
export function ColorSchemeCircles({
  color,
  colorSchemes,
  onSelect,
  className,
}: {
  color: string
  colorSchemes: string[]
  onSelect: (scheme: string) => void
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {colorSchemes.map(scheme => (
        <button
          key={scheme}
          type="button"
          data-user-color={scheme}
          onClick={() => onSelect(scheme)}
          aria-label={scheme}
          aria-pressed={color === scheme}
          title={scheme}
          className={cn(
            'inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-transparent transition-[transform,box-shadow] duration-150 hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-ring',
            color === scheme && 'ring-foreground/40',
          )}
        >
          {color === scheme && <CheckIcon aria-hidden className="size-4" />}
        </button>
      ))}
    </div>
  )
}

/**
 * 节日 / 季节性主题开关：只在当前有生效主题时出现。
 * 关闭后写入本地偏好，之后不会再自动应用（见 contexts/theme-context）
 */
export function ThemePackSection() {
  const t = useTranslations('ThemePack')
  const tMode = useTranslations('ThemeMode')
  const { theme, enabled, setEnabled } = useTheme()
  if (!theme)
    return null
  // 内置主题都有对应文案；将来用户自定义主题可能没有，回退到 id
  const nameKey = `names.${theme.id}`
  const name = t.has(nameKey) ? t(nameKey) : theme.id
  return (
    <div className="mt-3 grid gap-2 border-t border-border pt-3 text-xs">
      <div className="font-medium text-muted-foreground">{t('title')}</div>
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1.5">
          <SparklesIcon aria-hidden className="size-3.5 shrink-0 text-primary" />
          <span className="truncate">{name}</span>
          {/* 节日绑定的明暗：让用户知道当前为什么是夜里 */}
          {theme.mode && (
            <span className="shrink-0 text-muted-foreground/70">
              ·
              {' '}
              {tMode(`${theme.mode}_mode`)}
            </span>
          )}
        </span>
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          aria-label={t('title')}
          title={enabled ? t('disable') : t('enable')}
        />
      </div>
    </div>
  )
}

/**
 * 顶栏配色切换：调色盘图标 + 弹层里的圆形色块
 */
export function ColorSchemePicker({ className }: { className?: string }) {
  const t = useTranslations('ColorScheme')
  const { color, colorSchemes, selectColor } = useColorScheme()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('title')}
          title={t('title')}
          className={className}
        >
          <PaletteIcon aria-hidden className="size-5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto max-w-[16rem]">
        <div className="pb-2 text-xs font-medium text-muted-foreground">{t('title')}</div>
        <ColorSchemeCircles
          color={color}
          colorSchemes={colorSchemes}
          onSelect={selectColor}
        />
        <ThemePackSection />
      </PopoverContent>
    </Popover>
  )
}
