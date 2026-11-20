'use client'

import type { OwnerLink } from '@/utils/common/siteinfo'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useFormContext } from 'react-hook-form'
import { LabelWithInfo } from '@/components/common/info-tooltip'
import { IconPickerButton } from '@/components/tiptap-ui/inline-icon-picker'
import { Button } from '@/components/ui/button'
import { FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  DEFAULT_OWNER_LINK_ICON,
  fallbackLabelFromIconName,
  isOwnerLinkIconName,
  isSafeOwnerLinkUrl,
  OWNER_LINK_NAME_MAX,
  OWNER_LINK_URL_MAX,
  OWNER_LINKS_MAX,
} from '@/lib/social-icons/types'
import { detectPlatformFromUrl } from '@/lib/social-icons/url-detect'
import { cn } from '@/lib/utils'

function isOwnerLinkRowValid(link: OwnerLink): boolean {
  const name = link.name?.trim() ?? ''
  const url = link.url?.trim() ?? ''
  if (!name && !url)
    return true
  if (name.length > OWNER_LINK_NAME_MAX || !isSafeOwnerLinkUrl(url))
    return false
  return !link.icon || isOwnerLinkIconName(link.icon)
}

/**
 * 站长个人链接配置（侧边栏「关于我」卡片下方的社交与常用平台入口）：
 * - 复用带搜索、分类与最近使用记录的图标选择器（含 150+ 常见社交与平台图标及全部 Lucide 图标）
 * - 输入或粘贴常见平台链接（GitHub、Steam、X、Telegram、Bilibili、邮箱、RSS 等）时自动识别图标
 */
export function OwnerLinksField({ name, label, description }: { name: string, label: string, description?: string }) {
  const t = useTranslations('Console.global')
  const { control } = useFormContext<Record<string, OwnerLink[]>>()

  return (
    <FormField
      control={control}
      name={name}
      rules={{
        validate: (items) => {
          const list = items ?? []
          if (list.length > OWNER_LINKS_MAX)
            return t('owner_link_invalid')
          return list.every(isOwnerLinkRowValid) || t('owner_link_invalid')
        },
      }}
      render={({ field }) => {
        const items = field.value ?? []
        const setItems = (next: OwnerLink[]) => field.onChange(next)
        const update = (index: number, next: OwnerLink) => setItems(items.map((old, i) => (i === index ? next : old)))
        const move = (from: number, to: number) => {
          const next = items.slice()
          next.splice(to, 0, ...next.splice(from, 1))
          setItems(next)
        }

        const handleUrlChange = (index: number, current: OwnerLink, nextUrl: string) => {
          const prevDetected = detectPlatformFromUrl(current.url)?.icon
          const nextDetected = detectPlatformFromUrl(nextUrl)
          const currentIcon = current.icon || DEFAULT_OWNER_LINK_ICON
          // 当前图标仍为默认图标，或与上一次地址自动识别出的图标相同时，跟随新地址自动切换对应平台图标
          const shouldAutoIcon = nextDetected && (currentIcon === DEFAULT_OWNER_LINK_ICON || currentIcon === prevDetected)
          update(index, {
            name: current.name ?? '',
            url: nextUrl,
            icon: shouldAutoIcon ? nextDetected.icon : currentIcon,
          })
        }

        return (
          <FormItem className="md:col-span-2">
            <LabelWithInfo info={description}><FormLabel>{label}</FormLabel></LabelWithInfo>
            <div className="grid gap-2">
              {items.map((link, index) => {
                const icon = link.icon || DEFAULT_OWNER_LINK_ICON
                const detected = detectPlatformFromUrl(link.url)
                const namePlaceholder = detected?.label
                  || (icon !== DEFAULT_OWNER_LINK_ICON ? fallbackLabelFromIconName(icon) : t('owner_link_name_placeholder'))
                const invalid = !isOwnerLinkRowValid(link)

                return (
                  <div key={index} className="flex items-center gap-2">
                    <IconPickerButton
                      value={icon}
                      includeBrands
                      ariaLabel={t('owner_link_icon')}
                      onChange={nextIcon => update(index, { ...link, icon: nextIcon })}
                    />
                    <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-[11rem_1fr]">
                      <Input
                        aria-label={t('owner_link_name_placeholder')}
                        placeholder={namePlaceholder}
                        maxLength={OWNER_LINK_NAME_MAX}
                        value={link.name ?? ''}
                        onChange={e => update(index, { ...link, name: e.target.value })}
                      />
                      <Input
                        aria-label={t('owner_link_url_placeholder')}
                        placeholder={t('owner_link_url_placeholder')}
                        maxLength={OWNER_LINK_URL_MAX}
                        className={cn(invalid && 'border-destructive focus-visible:ring-destructive/30')}
                        value={link.url ?? ''}
                        onChange={e => handleUrlChange(index, link, e.target.value)}
                      />
                    </div>
                    <div className="flex shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t('move_up')}
                        disabled={index === 0}
                        onClick={() => move(index, index - 1)}
                      >
                        <ArrowUpIcon className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t('move_down')}
                        disabled={index === items.length - 1}
                        onClick={() => move(index, index + 1)}
                      >
                        <ArrowDownIcon className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t('remove')}
                        onClick={() => setItems(items.filter((_, i) => i !== index))}
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    </div>
                  </div>
                )
              })}
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={items.length >= OWNER_LINKS_MAX}
                  onClick={() => setItems([...items, { name: '', url: '', icon: DEFAULT_OWNER_LINK_ICON }])}
                >
                  <PlusIcon className="size-4" />
                  {t('add')}
                </Button>
              </div>
            </div>
            <FormMessage />
          </FormItem>
        )
      }}
    />
  )
}
