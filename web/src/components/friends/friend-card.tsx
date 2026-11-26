'use client'

import type { CSSProperties } from 'react'
import type {
  FriendColorKey,
  FriendGroupPresetKey,
  FriendHealthStatus,
  FriendTechCategory,
  FriendTechItem,
} from '@/models/friend'
import { InfoIcon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ImageAvatar } from '@/components/common/avatar'
import { FriendTechIcon } from '@/components/friends/friend-tech-icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { FRIEND_TECH_CATEGORIES, resolveFriendPalette } from '@/models/friend'

const HOVER_OPEN_DELAY_MS = 60
const HOVER_CLOSE_DELAY_MS = 150

export interface FriendCardItem {
  name: string
  url: string
  avatar: string
  avatarUrl?: string
  description: string
  colorKey: FriendColorKey | string
  healthStatus?: FriendHealthStatus
  latencyMs?: number
  techStack?: FriendTechItem[]
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

function normalizeTechStack(items?: FriendTechItem[]): FriendTechItem[] {
  if (!Array.isArray(items) || items.length === 0)
    return []
  const seen = new Set<string>()
  const result: FriendTechItem[] = []
  for (const raw of items) {
    if (!raw || typeof raw.id !== 'string' || typeof raw.name !== 'string')
      continue
    const id = raw.id.trim().toLowerCase()
    const name = raw.name.trim()
    if (!id || !name || seen.has(id))
      continue
    const category: FriendTechCategory = (FRIEND_TECH_CATEGORIES as readonly string[]).includes(raw.category)
      ? raw.category
      : 'framework'
    seen.add(id)
    result.push({ id, name, category })
  }
  return result
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
        className="pointer-events-auto inline-flex items-center justify-center text-destructive/90"
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
      className="pointer-events-auto inline-flex h-3 items-end gap-[2px]"
      title={label}
      aria-label={label}
    >
      <i className={cn('h-[5px] w-[2.5px] rounded-[1px]', filledBars >= 1 ? 'bg-(--fl-sig)' : 'bg-(--fl-sig-muted)')} />
      <i className={cn('h-[8.5px] w-[2.5px] rounded-[1px]', filledBars >= 2 ? 'bg-(--fl-sig)' : 'bg-(--fl-sig-muted)')} />
      <i className={cn('h-3 w-[2.5px] rounded-[1px]', filledBars >= 3 ? 'bg-(--fl-sig)' : 'bg-(--fl-sig-muted)')} />
    </span>
  )
}

function FriendTechPopover({
  siteName,
  techStack,
  healthStatus = 'unknown',
  latencyMs = 0,
}: {
  siteName: string
  techStack: FriendTechItem[]
  healthStatus?: FriendHealthStatus
  latencyMs?: number
}) {
  const t = useTranslations('Friends')
  const [open, setOpen] = useState(false)
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointerTypeRef = useRef<string>('')
  const openedByHoverRef = useRef(false)

  const clearTimers = useCallback(() => {
    if (openTimerRef.current !== null) {
      clearTimeout(openTimerRef.current)
      openTimerRef.current = null
    }
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  // 兼容 Next.js <Activity> 隐藏态与常规卸载，确保离场立即收起浮层并清理定时器
  useLayoutEffect(() => {
    return () => {
      clearTimers()
      openedByHoverRef.current = false
      setOpen(false)
    }
  }, [clearTimers])

  const scheduleHoverOpen = useCallback(() => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    if (open || openTimerRef.current !== null)
      return
    openTimerRef.current = setTimeout(() => {
      openTimerRef.current = null
      openedByHoverRef.current = true
      setOpen(true)
    }, HOVER_OPEN_DELAY_MS)
  }, [open])

  const scheduleHoverClose = useCallback(() => {
    if (openTimerRef.current !== null) {
      clearTimeout(openTimerRef.current)
      openTimerRef.current = null
    }
    // 仅当浮层由纯鼠标悬停触发时才自动延时收起；已点击固定或键盘展开时保持常驻直至主动关闭
    if (!openedByHoverRef.current)
      return
    if (closeTimerRef.current !== null)
      clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null
      openedByHoverRef.current = false
      setOpen(false)
    }, HOVER_CLOSE_DELAY_MS)
  }, [])

  const groupedTech = useMemo(() => {
    const groups: { category: FriendTechCategory, items: FriendTechItem[] }[] = []
    for (const cat of FRIEND_TECH_CATEGORIES) {
      const catItems = techStack.filter(item => item.category === cat)
      if (catItems.length > 0)
        groups.push({ category: cat, items: catItems })
    }
    return groups
  }, [techStack])

  const categoryLabel = (cat: FriendTechCategory): string => {
    switch (cat) {
      case 'cdn':
        return t('tech_cat_cdn')
      case 'server':
        return t('tech_cat_server')
      case 'cms':
        return t('tech_cat_cms')
      case 'framework':
        return t('tech_cat_framework')
    }
  }

  let probeSummary: string | null = null
  let probeDotClass = 'bg-emerald-500'
  if (healthStatus === 'unreachable') {
    probeSummary = t('probe_unreachable')
    probeDotClass = 'bg-destructive'
  }
  else if (healthStatus === 'healthy' || healthStatus === 'slow') {
    if (healthStatus === 'slow' || latencyMs >= 1000)
      probeDotClass = 'bg-amber-500'
    probeSummary = latencyMs > 0 ? `${latencyMs} ms` : t('probe_reachable')
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        clearTimers()
        openedByHoverRef.current = false
        setOpen(nextOpen)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('tech_stack_aria', { name: siteName })}
          className="pointer-events-auto -m-1 inline-flex size-5.5 items-center justify-center rounded-md text-(--fl-sig) opacity-75 transition-[opacity,background-color,color] hover:bg-black/6 hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:-m-1.5 pointer-coarse:size-6.5 dark:hover:bg-white/10"
          onPointerDown={(e) => {
            pointerTypeRef.current = e.pointerType
          }}
          onPointerEnter={(e) => {
            if (e.pointerType === 'mouse')
              scheduleHoverOpen()
          }}
          onPointerLeave={(e) => {
            if (e.pointerType === 'mouse')
              scheduleHoverClose()
          }}
          onClick={(e) => {
            // 桌面端鼠标悬停已展开时，单击将其固定为常驻展开态而不误触发收起
            if (pointerTypeRef.current === 'mouse' && open && openedByHoverRef.current) {
              e.preventDefault()
              clearTimers()
              openedByHoverRef.current = false
            }
            pointerTypeRef.current = ''
          }}
        >
          <InfoIcon className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        collisionPadding={12}
        aria-label={t('tech_stack_aria', { name: siteName })}
        className="w-64 max-w-[calc(100vw-1.5rem)] rounded-xl p-3 shadow-lg sm:w-72"
        onOpenAutoFocus={(e) => {
          // 浮层内无交互控件，保持焦点留在已带 aria-expanded 的触发按钮上，确保 Escape / Tab 顺序自然连贯
          e.preventDefault()
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
        }}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') {
            if (closeTimerRef.current !== null) {
              clearTimeout(closeTimerRef.current)
              closeTimerRef.current = null
            }
          }
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse')
            scheduleHoverClose()
        }}
      >
        <div className="grid gap-2.5">
          <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2">
            <span className="truncate text-xs font-semibold text-foreground">
              {t('tech_stack_title')}
            </span>
            {probeSummary && (
              <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                <span className={cn('size-1.5 rounded-full', probeDotClass)} aria-hidden="true" />
                <span>{probeSummary}</span>
              </span>
            )}
          </div>

          <div className="grid gap-2">
            {groupedTech.map(group => (
              <div key={group.category} className="grid gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">
                  {categoryLabel(group.category)}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {group.items.map(tech => (
                    <span
                      key={tech.id}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/45 px-2 py-0.5 text-xs font-medium text-foreground"
                    >
                      <FriendTechIcon
                        id={tech.id}
                        category={tech.category}
                        className="size-3.5 text-foreground/80"
                      />
                      <span>{tech.name}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
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
  const techStack = useMemo(() => normalizeTechStack(item.techStack), [item.techStack])
  const hasTechStack = techStack.length > 0
  const hasSignal = Boolean(item.healthStatus && item.healthStatus !== 'unknown')

  let textRightPadClass = 'pr-1'
  if (hasTechStack && hasSignal)
    textRightPadClass = 'pr-10'
  else if (hasTechStack || hasSignal)
    textRightPadClass = 'pr-5'

  const siteDisplayName = item.name || t('preview_default_name')

  const innerBody = (
    <>
      {interactive && <span className="cf-friends-avatar hidden" data-src={item.avatar} aria-hidden />}
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
      <div className={cn('min-w-0 flex-1 whitespace-normal', textRightPadClass)}>
        <div className={cn('truncate text-sm leading-snug font-semibold', interactive && 'cf-friends-name')}>
          {siteDisplayName}
        </div>
        <div className="mt-0.5 line-clamp-2 text-xs leading-snug wrap-anywhere text-(--fl-desc)">
          {item.description || t('no_description')}
        </div>
      </div>
    </>
  )

  return (
    <div
      className={cn(
        'friend-card-adaptive group/fcard relative min-w-0 overflow-hidden rounded-xl text-left transition-[transform,background-color,box-shadow] duration-150',
        interactive && 'hover:-translate-y-0.5',
        className,
      )}
      style={style}
    >
      {interactive
        ? (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="cf-friends-link flex h-full min-h-[74px] w-full min-w-0 items-center gap-3 rounded-xl px-3.5 py-3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
            >
              {innerBody}
            </a>
          )
        : (
            <div className="flex h-full min-h-[74px] w-full min-w-0 items-center gap-3 px-3.5 py-3">
              {innerBody}
            </div>
          )}

      {(hasTechStack || hasSignal) && (
        <div className="pointer-events-none absolute top-2.5 right-2.5 z-10 flex items-center gap-1.5">
          {hasTechStack && (
            <FriendTechPopover
              siteName={siteDisplayName}
              techStack={techStack}
              healthStatus={item.healthStatus}
              latencyMs={item.latencyMs}
            />
          )}
          {hasSignal && (
            <FriendProbeSignal healthStatus={item.healthStatus} latencyMs={item.latencyMs} />
          )}
        </div>
      )}
    </div>
  )
}
