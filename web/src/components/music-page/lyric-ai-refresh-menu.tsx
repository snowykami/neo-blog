'use client'

import {
  CaseSensitiveIcon,
  EllipsisIcon,
  LanguagesIcon,
  LoaderCircleIcon,
  SparklesIcon,
  UsersIcon,
  WavesIcon,
} from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { fetchLyricAnnotations } from '@/api/music'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/contexts/auth-context'
import { refreshAnnotations, useLyricAnnotations } from '@/contexts/lyric-annotations'
import { refreshMotion, useLyricMotion, useLyricMotionGenerating } from '@/contexts/lyric-motion'
import { refreshPronunciations } from '@/contexts/lyric-pronunciations'
import { refreshSingers, useLyricSingers, useLyricSingersGenerating } from '@/contexts/lyric-singers'
import { refreshTranslations } from '@/contexts/lyric-translations'
import { useMusic } from '@/contexts/music-context'
import { useSiteInfo } from '@/contexts/site-info-context'
import {
  refreshSongMetaTranslations,
  useSongMetaTranslation,
  useSongMetaTranslationGenerating,
} from '@/contexts/song-meta-translations'
import { LYRIC_MOTIONS } from '@/lib/lyrics/annotation-options'
import { canResolveLyricSingers } from '@/lib/lyrics/apply-singers'
import { canAdminAiTranslateLyrics, toLyricTargetLang } from '@/lib/lyrics/lyric-language'
import { canAiPronounceLyrics } from '@/lib/lyrics/lyric-pronunciation'
import { cn } from '@/lib/utils'
import { isAdmin } from '@/utils/common/permission'

/**
 * 管理员 AI 歌词能力聚合三点菜单：
 * 收敛「重新生成 AI 歌词特效 / 歌词弹性 / 歌手标识 / 歌词翻译 / 歌词读音」入口，避免英雄区圆钮堆叠。
 * 其中「歌词弹性」支持在逐行 LRC、非全站版本或关闭歌词特效时独立生成与刷新，不会覆盖手动编辑过的短语特效。
 */
export function LyricAiRefreshMenu({ className }: { className?: string }) {
  const t = useTranslations('MusicPage')
  const optionT = useTranslations('LyricOptions')
  const locale = useLocale()
  const { user } = useAuth()
  const { siteInfo } = useSiteInfo()
  const {
    currentTrack,
    lyrics,
    showLyricEffects,
    lyricIsSiteVersion,
    lyricAnnotationsGenerating,
    showTranslation,
    lyricAiTranslated,
    lyricTranslationsGenerating,
    effectiveTranslationLang,
    translationSelections,
    setTranslationSelections,
    lyricAiRomanized,
    lyricPronunciationsGenerating,
  } = useMusic()

  const [busyState, setBusyState] = useState<{
    trackId: number
    action: 'effects' | 'motion' | 'singer' | 'translation' | 'pronunciation'
  } | null>(null)
  const [confirmTrackId, setConfirmTrackId] = useState<number | null>(null)
  const currentTrackIdRef = useRef<number | null>(currentTrack?.id ?? null)
  currentTrackIdRef.current = currentTrack?.id ?? null

  const trackId = currentTrack?.id ?? null
  const lyricSource = lyrics.source !== 'none' ? lyrics.source : null
  const targetLang = effectiveTranslationLang || toLyricTargetLang(locale)
  const pronTargetLang = toLyricTargetLang(locale)

  const storedAnnotations = useLyricAnnotations(trackId)
  const matchedAnnotations = storedAnnotations?.source === lyrics.source ? storedAnnotations : null
  const edited = matchedAnnotations?.edited ?? false
  const storedMotion = useLyricMotion(trackId, lyricSource)
  const motionGenerating = useLyricMotionGenerating(trackId, lyricSource)
  const singersGenerating = useLyricSingersGenerating(trackId, lyricSource)
  const metaTranslation = useSongMetaTranslation(trackId, targetLang)
  const metaGenerating = useSongMetaTranslationGenerating(trackId, targetLang)
  const lyricSingers = useLyricSingers(trackId, lyricSource, targetLang)

  if (!user || !isAdmin({ user }) || !siteInfo.musicAiEnabled || !currentTrack)
    return null

  const canRefreshEffects = lyrics.wordTimed && showLyricEffects && lyricIsSiteVersion
  const canRefreshMotion = lyricSource != null && !lyrics.instrumental && lyrics.lines.length > 0
  const canRefreshSingers = canResolveLyricSingers(lyrics)

  const canTranslateLines = lyricSource != null
    && (lyricAiTranslated || lyricTranslationsGenerating || canAdminAiTranslateLyrics(lyrics, targetLang, currentTrack.artists))
  const canTranslateMeta = Boolean(metaTranslation && !metaTranslation.sameLanguage) || metaGenerating
  const hasSingersForTrans = Boolean(lyricSingers && lyricSingers.singers.length > 0 && !metaTranslation?.sameLanguage)
  const singerNamesTranslating = Boolean(hasSingersForTrans && lyricSingers?.translationPending)
  const canRefreshTranslation = canTranslateLines || canTranslateMeta || singerNamesTranslating

  const canRefreshPronunciation = lyricSource != null
    && (lyricAiRomanized || lyricPronunciationsGenerating || canAiPronounceLyrics(lyrics, pronTargetLang, currentTrack.artists))

  if (!canRefreshEffects && !canRefreshMotion && !canRefreshSingers && !canRefreshTranslation && !canRefreshPronunciation)
    return null

  const activeBusy = busyState?.trackId === currentTrack.id ? busyState.action : null
  const effectsBusy = activeBusy === 'effects' || (canRefreshEffects && lyricAnnotationsGenerating)
  const motionBusy = activeBusy === 'motion' || motionGenerating
  const singersBusy = activeBusy === 'singer' || singersGenerating
  const translationBusy = activeBusy === 'translation' || lyricTranslationsGenerating || metaGenerating || singerNamesTranslating
  const pronunciationBusy = activeBusy === 'pronunciation' || lyricPronunciationsGenerating
  const anyGenerating = effectsBusy || motionBusy || singersBusy || translationBusy || pronunciationBusy

  const rawMotion = lyrics.motion ?? storedMotion?.motion ?? matchedAnnotations?.motion
  const activeMotion = rawMotion && LYRIC_MOTIONS.includes(rawMotion) ? rawMotion : 'flow'
  const motionLabel = optionT(`motions.${activeMotion}`)

  const doRefreshEffects = async (targetId: number) => {
    setBusyState({ trackId: targetId, action: 'effects' })
    try {
      await refreshAnnotations(targetId)
      toast.success(t('lyric_ai_refresh_started'))
    }
    catch {
      toast.error(t('lyric_ai_refresh_failed'))
    }
    finally {
      setBusyState(prev => (prev?.trackId === targetId && prev.action === 'effects' ? null : prev))
    }
  }

  const handleSelectEffects = async () => {
    if (effectsBusy)
      return
    const targetId = currentTrack.id
    setBusyState({ trackId: targetId, action: 'effects' })
    const current = edited ? null : await fetchLyricAnnotations(targetId).catch(() => null)
    setBusyState(prev => (prev?.trackId === targetId && prev.action === 'effects' ? null : prev))
    if (currentTrackIdRef.current !== targetId)
      return
    if (edited || current?.edited)
      setConfirmTrackId(targetId)
    else
      void doRefreshEffects(targetId)
  }

  const handleSelectMotion = async () => {
    if (motionBusy || !lyricSource)
      return
    const targetId = currentTrack.id
    const targetSource = lyricSource
    setBusyState({ trackId: targetId, action: 'motion' })
    try {
      await refreshMotion(targetId, targetSource)
      toast.success(t('lyric_motion_refresh_started'))
    }
    catch {
      toast.error(t('lyric_motion_refresh_failed'))
    }
    finally {
      setBusyState(prev => (prev?.trackId === targetId && prev.action === 'motion' ? null : prev))
    }
  }

  const handleSelectSingers = async () => {
    if (singersBusy || !lyricSource)
      return
    const targetId = currentTrack.id
    const targetSource = lyricSource
    setBusyState({ trackId: targetId, action: 'singer' })
    try {
      const result = await refreshSingers(targetId, targetSource, showTranslation ? targetLang : '', false)
      if (result === 'started')
        toast.success(t('lyric_singer_refresh_started'))
      else
        toast.error(t('lyric_singer_refresh_failed'))
    }
    catch {
      toast.error(t('lyric_singer_refresh_failed'))
    }
    finally {
      setBusyState(prev => (prev?.trackId === targetId && prev.action === 'singer' ? null : prev))
    }
  }

  const handleSelectTranslation = async () => {
    if (translationBusy)
      return
    const targetId = currentTrack.id
    const targetSource = lyricSource
    setBusyState({ trackId: targetId, action: 'translation' })
    try {
      const tasks: Promise<'started' | 'unavailable'>[] = []
      if (canTranslateLines && targetSource)
        tasks.push(refreshTranslations(targetId, targetSource, targetLang))
      if (canTranslateMeta || !metaTranslation?.sameLanguage)
        tasks.push(refreshSongMetaTranslations(targetId, targetLang))
      if (targetSource && hasSingersForTrans)
        tasks.push(refreshSingers(targetId, targetSource, targetLang, true))

      const results = await Promise.allSettled(tasks)
      const anyStarted = results.some(res => res.status === 'fulfilled' && res.value === 'started')
      if (anyStarted) {
        if (currentTrackIdRef.current === targetId && canTranslateLines && targetSource && translationSelections.length > 0) {
          const hasTargetAi = translationSelections.some(item => item.lang === targetLang && !item.preferNative)
          if (!hasTargetAi && translationSelections.some(item => item.lang === targetLang)) {
            setTranslationSelections(
              translationSelections.map(item =>
                item.lang === targetLang ? { lang: targetLang, preferNative: false } : item,
              ),
            )
          }
        }
        toast.success(t('lyric_translation_refresh_started'))
      }
      else {
        toast.error(t('lyric_translation_refresh_failed'))
      }
    }
    catch {
      toast.error(t('lyric_translation_refresh_failed'))
    }
    finally {
      setBusyState(prev => (prev?.trackId === targetId && prev.action === 'translation' ? null : prev))
    }
  }

  const handleSelectPronunciation = async () => {
    if (pronunciationBusy || !lyricSource)
      return
    const targetId = currentTrack.id
    const targetSource = lyricSource
    setBusyState({ trackId: targetId, action: 'pronunciation' })
    try {
      const result = await refreshPronunciations(targetId, targetSource)
      if (result === 'started')
        toast.success(t('lyric_pronunciation_refresh_started'))
      else
        toast.error(t('lyric_pronunciation_refresh_failed'))
    }
    catch {
      toast.error(t('lyric_pronunciation_refresh_failed'))
    }
    finally {
      setBusyState(prev => (prev?.trackId === targetId && prev.action === 'pronunciation' ? null : prev))
    }
  }

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          title={t('lyric_ai_menu_label')}
          aria-label={t('lyric_ai_menu_label')}
          className={cn(
            'inline-flex size-[1.125rem] items-center justify-center rounded-full bg-white/10 text-white/70 transition-colors hover:bg-white/15 hover:text-white/90 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none',
            className,
          )}
        >
          {anyGenerating
            ? <LoaderCircleIcon aria-hidden className="size-2.5 motion-safe:animate-spin" />
            : <EllipsisIcon aria-hidden className="size-3" />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="dark z-1001 min-w-56 border-white/10 bg-neutral-900/95 text-white backdrop-blur-xl">
          <DropdownMenuLabel className="text-xs text-white/60">
            {t('lyric_ai_menu_label')}
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="bg-white/10" />

          {canRefreshEffects && (
            <DropdownMenuItem disabled={effectsBusy} onSelect={() => void handleSelectEffects()} className="gap-2 text-xs">
              <SparklesIcon aria-hidden className={cn('size-3.5 shrink-0 text-white/80', effectsBusy && 'motion-safe:animate-pulse')} />
              <span className="flex-1">{t('lyric_ai_refresh')}</span>
            </DropdownMenuItem>
          )}

          {canRefreshMotion && (
            <DropdownMenuItem disabled={motionBusy} onSelect={() => void handleSelectMotion()} className="gap-2 text-xs">
              <WavesIcon aria-hidden className={cn('size-3.5 shrink-0 text-white/80', motionBusy && 'motion-safe:animate-pulse')} />
              <span className="flex-1">{t('lyric_motion_refresh')}</span>
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/65">{motionLabel}</span>
            </DropdownMenuItem>
          )}

          {canRefreshSingers && (
            <DropdownMenuItem disabled={singersBusy} onSelect={() => void handleSelectSingers()} className="gap-2 text-xs">
              <UsersIcon aria-hidden className={cn('size-3.5 shrink-0 text-white/80', singersBusy && 'motion-safe:animate-pulse')} />
              <span className="flex-1">{t('lyric_singer_refresh')}</span>
            </DropdownMenuItem>
          )}

          {canRefreshTranslation && (
            <DropdownMenuItem disabled={translationBusy} onSelect={() => void handleSelectTranslation()} className="gap-2 text-xs">
              <LanguagesIcon aria-hidden className={cn('size-3.5 shrink-0 text-white/80', translationBusy && 'motion-safe:animate-pulse')} />
              <span className="flex-1">{t('lyric_translation_refresh')}</span>
            </DropdownMenuItem>
          )}

          {canRefreshPronunciation && (
            <DropdownMenuItem disabled={pronunciationBusy} onSelect={() => void handleSelectPronunciation()} className="gap-2 text-xs">
              <CaseSensitiveIcon aria-hidden className={cn('size-3.5 shrink-0 text-white/80', pronunciationBusy && 'motion-safe:animate-pulse')} />
              <span className="flex-1">{t('lyric_pronunciation_refresh')}</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirmTrackId !== null && confirmTrackId === currentTrack.id}
        onOpenChange={(open) => {
          if (!open)
            setConfirmTrackId(null)
        }}
        title={t('lyric_ai_refresh_edited_title')}
        description={t('lyric_ai_refresh_edited_description')}
        confirmLabel={t('lyric_ai_refresh')}
        confirmVariant="destructive"
        onConfirm={() => {
          const lockedId = confirmTrackId
          setConfirmTrackId(null)
          if (lockedId != null && lockedId === currentTrackIdRef.current)
            void doRefreshEffects(lockedId)
        }}
      />
    </>
  )
}
