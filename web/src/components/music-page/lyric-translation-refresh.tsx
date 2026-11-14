'use client'

import { LanguagesIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/auth-context'
import { refreshSingers, useLyricSingers } from '@/contexts/lyric-singers'
import { refreshTranslations } from '@/contexts/lyric-translations'
import { useMusic } from '@/contexts/music-context'
import { useSiteInfo } from '@/contexts/site-info-context'
import { refreshSongMetaTranslations, useSongMetaTranslation, useSongMetaTranslationGenerating } from '@/contexts/song-meta-translations'
import { canAiTranslateLyrics, toLyricTargetLang } from '@/lib/lyrics/lyric-language'
import { cn } from '@/lib/utils'
import { isAdmin } from '@/utils/common/permission'

export function LyricTranslationRefresh({ className }: { className?: string }) {
  const { user } = useAuth()
  const { siteInfo } = useSiteInfo()
  const { currentTrack, lyrics, lyricAiTranslated, lyricTranslationsGenerating } = useMusic()
  const locale = useLocale()
  const targetLang = toLyricTargetLang(locale)
  const t = useTranslations('MusicPage')
  const [refreshing, setRefreshing] = useState(false)
  const trackId = currentTrack?.id ?? null
  const lyricSource = lyrics.source !== 'none' ? lyrics.source : null
  const metaTranslation = useSongMetaTranslation(trackId, targetLang)
  const metaGenerating = useSongMetaTranslationGenerating(trackId, targetLang)
  const lyricSingers = useLyricSingers(trackId, lyricSource, targetLang)

  if (!user || !isAdmin({ user }) || !siteInfo.musicAiEnabled || !currentTrack)
    return null

  const canTranslateLines = lyricSource != null
    && (lyricAiTranslated || lyricTranslationsGenerating || canAiTranslateLyrics(lyrics, targetLang, currentTrack.artists))
  const canTranslateMeta = Boolean(metaTranslation && !metaTranslation.sameLanguage) || metaGenerating
  const hasSingers = Boolean(lyricSingers && lyricSingers.singers.length > 0 && !metaTranslation?.sameLanguage)
  const singerNamesTranslating = Boolean(hasSingers && lyricSingers?.translationPending)

  if (!canTranslateLines && !canTranslateMeta && !singerNamesTranslating)
    return null

  const busy = refreshing || lyricTranslationsGenerating || metaGenerating || singerNamesTranslating

  const handleRefresh = async () => {
    if (busy)
      return
    setRefreshing(true)
    try {
      const tasks: Promise<'started' | 'unavailable'>[] = []
      if (canTranslateLines && lyricSource)
        tasks.push(refreshTranslations(currentTrack.id, lyricSource, targetLang))
      if (canTranslateMeta || !metaTranslation?.sameLanguage)
        tasks.push(refreshSongMetaTranslations(currentTrack.id, targetLang))
      if (lyricSource && hasSingers)
        tasks.push(refreshSingers(currentTrack.id, lyricSource, targetLang, true))

      const results = await Promise.allSettled(tasks)
      const anyStarted = results.some(res => res.status === 'fulfilled' && res.value === 'started')
      if (anyStarted)
        toast.success(t('lyric_translation_refresh_started'))
      else
        toast.error(t('lyric_translation_refresh_failed'))
    }
    catch {
      toast.error(t('lyric_translation_refresh_failed'))
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
      aria-label={t('lyric_translation_refresh')}
      title={t('lyric_translation_refresh')}
      disabled={busy}
      className={cn('size-[1.125rem] rounded-full bg-white/10 text-white/70 hover:bg-white/15 hover:text-white/90', className)}
      onClick={() => void handleRefresh()}
    >
      <LanguagesIcon aria-hidden className={cn('size-2.5', busy && 'motion-safe:animate-spin')} />
    </Button>
  )
}
