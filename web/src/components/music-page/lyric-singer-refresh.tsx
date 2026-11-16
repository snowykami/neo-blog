'use client'

import { UsersIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/auth-context'
import { refreshSingers, useLyricSingersGenerating } from '@/contexts/lyric-singers'
import { useMusic } from '@/contexts/music-context'
import { useSiteInfo } from '@/contexts/site-info-context'
import { canResolveLyricSingers } from '@/lib/lyrics/apply-singers'
import { toLyricTargetLang } from '@/lib/lyrics/target-lang'
import { cn } from '@/lib/utils'
import { isAdmin } from '@/utils/common/permission'

/** 管理员手动触发或重新生成当前词源的 AI 歌手标识（声部分配） */
export function LyricSingerRefresh({ className }: { className?: string }) {
  const { user } = useAuth()
  const { siteInfo } = useSiteInfo()
  const { currentTrack, lyrics, showTranslation, effectiveTranslationLang } = useMusic()
  const locale = useLocale()
  const targetLang = effectiveTranslationLang || toLyricTargetLang(locale)
  const t = useTranslations('MusicPage')
  const [refreshing, setRefreshing] = useState(false)
  const trackId = currentTrack?.id ?? null
  const lyricSource = lyrics.source !== 'none' ? lyrics.source : null
  const singersGenerating = useLyricSingersGenerating(trackId, lyricSource)

  if (!user || !isAdmin({ user }) || !siteInfo.musicAiEnabled || !currentTrack || !canResolveLyricSingers(lyrics))
    return null

  const busy = refreshing || singersGenerating

  const handleRefresh = async () => {
    if (busy)
      return
    setRefreshing(true)
    try {
      const result = await refreshSingers(currentTrack.id, lyrics.source, showTranslation ? targetLang : '', false)
      if (result === 'started')
        toast.success(t('lyric_singer_refresh_started'))
      else
        toast.error(t('lyric_singer_refresh_failed'))
    }
    catch {
      toast.error(t('lyric_singer_refresh_failed'))
    }
    finally {
      setRefreshing(false)
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={t('lyric_singer_refresh')}
      title={t('lyric_singer_refresh')}
      disabled={busy}
      className={cn('size-[1.125rem] rounded-full bg-white/10 text-white/70 hover:bg-white/15 hover:text-white/90', className)}
      onClick={() => void handleRefresh()}
    >
      <UsersIcon aria-hidden className={cn('size-2.5', busy && 'motion-safe:animate-pulse')} />
    </Button>
  )
}
