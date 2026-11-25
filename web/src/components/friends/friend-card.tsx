'use client'

import type { CSSProperties } from 'react'
import type { FriendColorKey, FriendGroupPresetKey, FriendHealthStatus } from '@/models/friend'
import { XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { ImageAvatar } from '@/components/common/avatar'
import { cn } from '@/lib/utils'
import { resolveFriendPalette } from '@/models/friend'

export interface FriendCardItem {
  name: string
  url: string
  avatar: string
  avatarUrl?: string
  description: string
  colorKey: FriendColorKey | string
  healthStatus?: FriendHealthStatus
  latencyMs?: number
}

export function useFriendPresetTranslator() {
  const t = useTranslations('Friends')
  return {
    groupName(presetKey: FriendGroupPresetKey, customName: string): string {
      switch (presetKey) {
        case 'friends':
          return t('preset_friends')
        case 'seniors':
          return t('preset_seniors')
        case 'official':
          return t('preset_official')
        case 'projects':
          return t('preset_projects')
        case 'tech':
          return t('preset_tech')
        case 'others':
          return t('preset_others')
        default:
          return customName || t('preset_others')
      }
    },
    groupDescription(presetKey: FriendGroupPresetKey, customDesc: string): string {
      if (customDesc)
        return customDesc
      switch (presetKey) {
        case 'friends':
          return t('preset_friends_desc')
        case 'seniors':
          return t('preset_seniors_desc')
        case 'official':
          return t('preset_official_desc')
        case 'projects':
          return t('preset_projects_desc')
        case 'tech':
          return t('preset_tech_desc')
        case 'others':
          return t('preset_others_desc')
        default:
          return ''
      }
    },
  }
}

function FriendProbeSignal({
  healthStatus = 'unknown',
  latencyMs = 0,
}: {
  healthStatus?: FriendHealthStatus
  latencyMs?: number
}) {
  const t = useTranslations('Friends')

  if (healthStatus === 'unknown')
    return null

  if (healthStatus === 'unreachable') {
    return (
      <span
        className="absolute top-2.5 right-2.5 inline-flex items-center justify-center text-destructive/90"
        title={t('probe_unreachable')}
        aria-label={t('probe_unreachable')}
      >
        <XIcon className="size-3.5 stroke-[2.5]" />
      </span>
    )
  }

  let filledBars = 1
  if (healthStatus === 'healthy') {
    if (latencyMs >= 0 && latencyMs < 1000)
      filledBars = 3
    else if (latencyMs < 2000)
      filledBars = 2
  }

  const label = latencyMs > 0
    ? t('probe_latency', { ms: latencyMs })
    : t('probe_reachable')

  return (
    <span
      className="absolute top-2.5 right-2.5 inline-flex h-3 items-end gap-[1.5px] text-(--fl-sig) opacity-90"
      title={label}
      aria-label={label}
    >
      <i className={cn('h-[5px] w-[2.5px] rounded-[1px] border border-current', filledBars >= 1 && 'bg-current')} />
      <i className={cn('h-[8.5px] w-[2.5px] rounded-[1px] border border-current', filledBars >= 2 && 'bg-current')} />
      <i className={cn('h-3 w-[2.5px] rounded-[1px] border border-current', filledBars >= 3 && 'bg-current')} />
    </span>
  )
}

export function FriendCard({
  item,
  interactive = true,
  className,
}: {
  item: FriendCardItem
  interactive?: boolean
  className?: string
}) {
  const t = useTranslations('Friends')
  const palette = resolveFriendPalette(item.colorKey)
  const initial = (item.name || '?').trim().slice(0, 1).toUpperCase()
  const style = {
    '--fl-h': String(palette.h),
    '--fl-c': String(palette.c),
  } as CSSProperties

  const primaryAvatar = item.avatarUrl || item.avatar || undefined
  const backupAvatar = item.avatarUrl && item.avatarUrl !== item.avatar ? item.avatar : undefined

  const content = (
    <>
      <span className="cf-friends-avatar hidden" data-src={item.avatar} aria-hidden />
      <ImageAvatar
        src={primaryAvatar}
        fallbackSrc={backupAvatar}
        alt=""
        fallback={initial}
        sizes="48px"
        fallbackDelayMs={150}
        className={cn(
          'size-11 ring-2 ring-white/55 transition-transform duration-200 dark:ring-white/15',
          interactive && 'group-hover/fcard:scale-105',
        )}
        fallbackClassName="text-sm font-bold text-white"
        fallbackStyle={{ backgroundColor: 'var(--fl-avatar-bg)' }}
      />
      <div className="min-w-0 flex-1 pr-4 whitespace-normal">
        <div className="cf-friends-name truncate text-sm leading-snug font-semibold">
          {item.name || t('preview_default_name')}
        </div>
        <div className="mt-0.5 line-clamp-2 text-xs leading-snug wrap-anywhere text-(--fl-desc)">
          {item.description || t('no_description')}
        </div>
      </div>
      <FriendProbeSignal healthStatus={item.healthStatus} latencyMs={item.latencyMs} />
    </>
  )

  const baseClass = cn(
    'friend-card-adaptive cf-friends-link group/fcard relative flex min-h-[74px] min-w-0 items-center gap-3 overflow-hidden rounded-xl px-3.5 py-3 text-left transition-[transform,background-color,box-shadow] duration-150',
    interactive && 'hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    className,
  )

  if (!interactive) {
    return (
      <div className={baseClass} style={style}>
        {content}
      </div>
    )
  }

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className={baseClass}
      style={style}
    >
      {content}
    </a>
  )
}
