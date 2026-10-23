'use client'

import type { ComponentHeight } from '../layout'
import { Music2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { ProgressControl } from '@/components/common/controlled-progress'
import { SafeImage } from '@/components/common/safe-image'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatDurationMMSS } from '@/utils/common/datetime'
import { useComponentHeight } from '../use-component-height'

export interface MusicCardProgress {
  currentTime: number
  duration: number | null
  onSeek: (seconds: number) => void
}

/** 高度 3 单位及以上时显示多行歌词区 */
export function isTallMusicCard(height: ComponentHeight | null): boolean {
  return height != null && height >= 3
}

// 各高度档位的卡片布局与封面尺寸（key 0 为自动高度）
const CARD_LAYOUTS: Record<ComponentHeight | 0, { card: string, cover: string }> = {
  0: { card: 'gap-2.5 p-3', cover: 'size-16' },
  // 1 单位：只有封面、标题与按钮，收起进度
  1: { card: 'h-full overflow-hidden content-center p-3', cover: 'size-18 @max-3xs:hidden' },
  2: { card: 'h-full overflow-hidden content-center gap-4 p-4', cover: 'size-24' },
  // 3 / 4 单位：头部、歌词区、进度三行，歌词区占满剩余高度
  3: { card: 'h-full overflow-hidden grid-rows-[auto_minmax(0,1fr)_auto] gap-3 p-4', cover: 'size-20' },
  4: { card: 'h-full overflow-hidden grid-rows-[auto_minmax(0,1fr)_auto] gap-3 p-4', cover: 'size-24' },
}

/**
 * 音乐卡片的展示部分（网易云与自定义音频共用）：封面、标题、副标题、操作按钮，以及可拖动的进度
 * loading 时显示骨架；progress 为空时不显示进度；lyrics 为 3 单位及以上高度时的歌词区
 */
export function MusicCardView({ cover, title, href, subtitle, action, progress, loading, lyrics }: {
  cover?: string
  title?: string
  href?: string
  subtitle?: React.ReactNode
  action?: React.ReactNode
  progress?: MusicCardProgress | null
  loading?: boolean
  lyrics?: React.ReactNode
}) {
  const height = useComponentHeight()
  const layout = CARD_LAYOUTS[height ?? 0]
  const tall = isTallMusicCard(height)
  return (
    // minmax(0,1fr)：网格项默认不小于内容宽度，过长的一行歌词会把卡片撑宽，导致无法触发横向滚动
    <div className={cn('grid grid-cols-[minmax(0,1fr)] rounded-xl border bg-card text-card-foreground', layout.card)}>
      <div className="flex items-center gap-3.5">
        <div className={cn('relative shrink-0 overflow-hidden rounded-lg bg-muted', layout.cover)}>
          {cover
            ? <SafeImage src={cover} alt="" fill sizes="96px" className="object-cover" />
            : loading
              ? <Skeleton className="size-full" />
              : <Music2Icon aria-hidden className="absolute inset-0 m-auto size-6 text-muted-foreground" />}
        </div>
        <div className="min-w-0 flex-1">
          {loading
            ? (
                <div className="grid gap-2">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3.5 w-1/3" />
                </div>
              )
            : (
                <>
                  {title && (href
                    ? <a href={href} target="_blank" rel="noopener noreferrer" className="block truncate font-semibold text-foreground no-underline hover:text-primary">{title}</a>
                    : <p className="truncate font-semibold text-foreground">{title}</p>)}
                  {subtitle}
                </>
              )}
        </div>
        {action}
      </div>
      {tall && <div className="min-h-0">{lyrics}</div>}
      {progress && height !== 1 && <MusicCardProgressRow {...progress} />}
    </div>
  )
}

/** 歌词区的提示文字（未播放、没有歌词等） */
export function MusicCardLyricHint({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center px-2 text-center text-sm text-muted-foreground">{children}</div>
}

function MusicCardProgressRow({ currentTime, duration, onSeek }: MusicCardProgress) {
  const t = useTranslations('ContentComponents.neteaseSong')
  // 拖动进度时的预览位置（百分比），松开后才真正跳转
  const [dragPercent, setDragPercent] = useState<number | null>(null)
  const hasDuration = !!duration && Number.isFinite(duration)
  const progress = hasDuration ? Math.min(100, (currentTime / duration) * 100) : 0
  const shownSeconds = hasDuration && dragPercent != null ? (dragPercent / 100) * duration : currentTime
  const shownTime = formatDurationMMSS(Math.floor(shownSeconds))
  const totalTime = hasDuration ? formatDurationMMSS(Math.floor(duration)) : '--:--'

  return (
    <div className="flex items-center gap-2.5 text-xs text-muted-foreground tabular-nums">
      <span className="w-10 shrink-0 text-right">{shownTime}</span>
      <ProgressControl
        className="flex-1"
        value={progress}
        disabled={!hasDuration}
        step={2}
        ariaLabel={t('progress')}
        ariaValueText={`${shownTime} / ${totalTime}`}
        onChange={setDragPercent}
        onChangeEnd={(value) => {
          setDragPercent(null)
          if (hasDuration)
            onSeek((value / 100) * duration)
        }}
      />
      <span className="w-10 shrink-0">{totalTime}</span>
    </div>
  )
}
