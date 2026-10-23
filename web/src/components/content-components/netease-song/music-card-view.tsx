'use client'

import { Music2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { ProgressControl } from '@/components/common/controlled-progress'
import { SafeImage } from '@/components/common/safe-image'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDurationMMSS } from '@/utils/common/datetime'

export interface MusicCardProgress {
  currentTime: number
  duration: number | null
  onSeek: (seconds: number) => void
}

/**
 * 音乐卡片的展示部分（网易云与自定义音频共用）：封面、标题、副标题、操作按钮，以及可拖动的进度
 * loading 时显示骨架；progress 为空时不显示进度
 */
export function MusicCardView({ cover, title, href, subtitle, action, progress, loading }: {
  cover?: string
  title?: string
  href?: string
  subtitle?: React.ReactNode
  action?: React.ReactNode
  progress?: MusicCardProgress | null
  loading?: boolean
}) {
  return (
    // minmax(0,1fr)：网格项默认不小于内容宽度，过长的一行歌词会把卡片撑宽，导致无法触发横向滚动
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5 rounded-xl border bg-card p-3 text-card-foreground">
      <div className="flex items-center gap-3.5">
        <div className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-muted">
          {cover
            ? <SafeImage src={cover} alt="" fill sizes="64px" className="object-cover" />
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
      {progress && <MusicCardProgressRow {...progress} />}
    </div>
  )
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
