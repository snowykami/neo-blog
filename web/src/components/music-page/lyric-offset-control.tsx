'use client'

import { TimerResetIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAuth } from '@/contexts/auth-context'
import { setLyricOffset, useLyricOffsets } from '@/contexts/lyric-settings'
import { useMusic } from '@/contexts/music-context'
import { formatLyricOffset } from '@/lib/lyrics/offset'
import { cn } from '@/lib/utils'
import { isAdmin } from '@/utils/common/permission'
import { lyricSourceLabelKey } from './lyric-source-badge'

// 每次调整的步长（毫秒）与上限（与后端 lyricOffsetMaxMs 一致）
const STEPS = [-500, -100, 100, 500]
const MAX_OFFSET_MS = 10000

/**
 * 歌词整体偏移微调（见 spec 7.2l）：仅管理员可见（后端保存接口同样限管理员）。按当前显示的歌词来源保存，
 * 调整后立即生效，停止调整片刻后保存到后台，之后所有人播放这首歌（同一来源）都按这个偏移显示
 */
export function LyricOffsetControl({ className }: { className?: string }) {
  const t = useTranslations('MusicPage')
  const { user } = useAuth()
  const { currentTrack, lyrics } = useMusic()
  const trackId = currentTrack?.id ?? 0
  const offsets = useLyricOffsets(trackId > 0 ? trackId : null)
  const [saved, setSaved] = useState(true)
  const sourceKey = lyricSourceLabelKey(lyrics.source)
  if (!user || !isAdmin({ user }) || trackId <= 0 || lyrics.source === 'none' || lyrics.lines.length === 0 || !sourceKey)
    return null

  const offset = offsets[lyrics.source] ?? 0
  const apply = (next: number) => {
    const clamped = Math.max(-MAX_OFFSET_MS, Math.min(MAX_OFFSET_MS, next))
    if (clamped === offset)
      return
    setSaved(false)
    setLyricOffset(trackId, lyrics.source, clamped, {
      onSaved: () => setSaved(true),
      onError: () => toast.error(t('lyric_offset_save_failed')),
    })
  }

  return (
    <Popover>
      <PopoverTrigger
        title={t('lyric_offset')}
        aria-label={t('lyric_offset')}
        className={cn(
          'inline-flex h-[1.125rem] items-center gap-1 rounded-full bg-white/10 px-1 text-[10px] leading-none font-medium text-white/70 transition-colors hover:bg-white/15 hover:text-white/90 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none',
          className,
        )}
      >
        <TimerResetIcon aria-hidden className="size-2.5" />
        {offset !== 0 && <span className="tabular-nums">{formatLyricOffset(offset)}</span>}
      </PopoverTrigger>
      <PopoverContent className="grid w-64 gap-3" align="center">
        <div className="grid gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium">{t('lyric_offset')}</span>
            <span className="text-lg font-semibold tabular-nums">{formatLyricOffset(offset)}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('lyric_offset_hint', { source: t(sourceKey) })}
          </p>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {STEPS.map(step => (
            <Button key={step} type="button" size="sm" variant="outline" className="tabular-nums" onClick={() => apply(offset + step)}>
              {formatLyricOffset(step)}
            </Button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {t(saved ? 'lyric_offset_saved' : 'lyric_offset_saving')}
          </span>
          <Button type="button" size="sm" variant="ghost" disabled={offset === 0} onClick={() => apply(0)}>
            {t('lyric_offset_reset')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
