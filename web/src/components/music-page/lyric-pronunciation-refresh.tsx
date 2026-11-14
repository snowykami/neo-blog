'use client'

import { CaseSensitiveIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/auth-context'
import { refreshPronunciations } from '@/contexts/lyric-pronunciations'
import { useMusic } from '@/contexts/music-context'
import { useSiteInfo } from '@/contexts/site-info-context'
import { canAiPronounceLyrics } from '@/lib/lyrics/lyric-pronunciation'
import { toLyricTargetLang } from '@/lib/lyrics/target-lang'
import { cn } from '@/lib/utils'
import { isAdmin } from '@/utils/common/permission'

/** 管理员手动重新生成当前词源的 AI 标准读音 */
export function LyricPronunciationRefresh({ className }: { className?: string }) {
  const { user } = useAuth()
  const { siteInfo } = useSiteInfo()
  const { currentTrack, lyrics, lyricAiRomanized, lyricPronunciationsGenerating } = useMusic()
  const locale = useLocale()
  const targetLang = toLyricTargetLang(locale)
  const t = useTranslations('MusicPage')
  const [refreshing, setRefreshing] = useState(false)

  if (!user || !isAdmin({ user }) || !siteInfo.musicAiEnabled || !currentTrack || lyrics.source === 'none')
    return null

  if (!lyricAiRomanized && !lyricPronunciationsGenerating && !canAiPronounceLyrics(lyrics, targetLang, currentTrack.artists))
    return null

  const busy = refreshing || lyricPronunciationsGenerating

  const handleRefresh = async () => {
    if (busy)
      return
    setRefreshing(true)
    try {
      const result = await refreshPronunciations(currentTrack.id, lyrics.source)
      if (result === 'started')
        toast.success(t('lyric_pronunciation_refresh_started'))
      else
        toast.error(t('lyric_pronunciation_refresh_failed'))
    }
    catch {
      toast.error(t('lyric_pronunciation_refresh_failed'))
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
      aria-label={t('lyric_pronunciation_refresh')}
      title={t('lyric_pronunciation_refresh')}
      disabled={busy}
      className={cn('size-[1.125rem] rounded-full bg-white/10 text-white/70 hover:bg-white/15 hover:text-white/90', className)}
      onClick={() => void handleRefresh()}
    >
      <CaseSensitiveIcon aria-hidden className={cn('size-2.5', busy && 'motion-safe:animate-pulse')} />
    </Button>
  )
}
