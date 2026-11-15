'use client'

import type { MusicLyricsState } from './music-lyrics-engine-state'
import type { MusicLyricTranslationLangStatus } from '@/api/music'
import type { LyricTrackInfo } from '@/lib/lyrics/strip-credits'
import type { LyricTargetLang } from '@/lib/lyrics/target-lang'
import { useLocale } from 'next-intl'
import { useEffect, useMemo } from 'react'
import { useSiteInfo } from '@/contexts/site-info-context'
import { applyLyricSingers, canResolveLyricSingers } from '@/lib/lyrics/apply-singers'
import { applyEmphasis } from '@/lib/lyrics/emphasis'
import {
  applyLanguageTranslations,
  canAdminAiTranslateLyrics,
  canAiTranslateLyrics,
  hasNativeTargetTranslation,
  toLyricTargetLang,
} from '@/lib/lyrics/lyric-language'
import { applyPronunciationsAndFilter, canAiPronounceLyrics } from '@/lib/lyrics/lyric-pronunciation'
import { SUPPORTED_LYRIC_TARGET_LANGS } from '@/lib/lyrics/target-lang'
import { requestLyricAnnotations, useLyricAnnotations, useLyricAnnotationsGenerating } from './lyric-annotations'
import { requestLyricPronunciations, useLyricPronunciations, useLyricPronunciationsGenerating } from './lyric-pronunciations'
import { requestLyricSingers, useLyricSingers } from './lyric-singers'
import {
  requestLyricTranslationLanguages,
  requestLyricTranslations,
  useLyricTranslationLanguages,
  useLyricTranslations,
  useLyricTranslationsGenerating,
} from './lyric-translations'
import { requestSongHotComment, useSongHotComment } from './song-hot-comment'
import { useResolvedSongLyrics } from './song-lyrics'
import { requestSongMetaTranslation } from './song-meta-translations'

/**
 * 当前曲目的歌词引擎（来源获取与选择、各平台歌词解析、逐字音译对齐、AI 强调标注、AI 歌词翻译），从 music-context 中拆出来按需加载：
 * 这些代码（连带 wanakana 等）不小，而 MusicProvider 在根布局里、每一页都挂着。没有曲目时不加载，
 * 有曲目后（播放器空闲挂载、歌单就绪，或读者在文章里点了单曲卡）才下载，结果经 onChange 交回 MusicProvider
 */

export function MusicLyricsEngine({
  trackId,
  track,
  isPlaying,
  showLyricEffects,
  showLyricMoments,
  showTranslation,
  translationRequested,
  translationLang,
  showRomaji,
  romajiRequested,
  onChange,
}: {
  trackId: number | null
  track: (LyricTrackInfo & { album?: string }) | null
  isPlaying: boolean
  showLyricEffects: boolean
  showLyricMoments: boolean
  showTranslation: boolean
  translationRequested: boolean
  translationLang: LyricTargetLang | null
  showRomaji: boolean
  romajiRequested: boolean
  onChange: (state: MusicLyricsState) => void
}) {
  // 与文章内的单曲卡、歌词摘录共用同一份来源与选择结果（见 contexts/song-lyrics.ts）
  // 解构具体字段作为 memo 依赖，避免外层包装对象引用变化时触发无意义重算或循环更新
  const {
    lyrics: rawLyrics,
    candidates,
    kind,
    siteKind,
    isSiteVersion,
    pending,
    status,
  } = useResolvedSongLyrics(trackId, track)
  const locale = useLocale()
  const targetLang = useMemo(() => toLyricTargetLang(locale), [locale])
  const { siteInfo } = useSiteInfo()
  const lyricSource = rawLyrics.source !== 'none' ? rawLyrics.source : null
  const validTrackId = trackId != null && trackId > 0 ? trackId : null
  const sourceTransitioning = pending && siteKind == null && !lyricSource?.startsWith('ttml-')

  // 只读拉取当前曲目可用翻译语言列表，用于菜单与 AI 覆盖判定
  useEffect(() => {
    if (validTrackId == null || lyricSource == null)
      return
    if (!sourceTransitioning) {
      requestLyricTranslationLanguages(validTrackId, lyricSource)
      return
    }
    const timer = setTimeout(() => {
      requestLyricTranslationLanguages(validTrackId, lyricSource)
    }, 650)
    return () => clearTimeout(timer)
  }, [lyricSource, sourceTransitioning, validTrackId])

  const rawLangCapabilities = useLyricTranslationLanguages(validTrackId, lyricSource)
  const requestedEntryGenerating = useLyricTranslationsGenerating(
    validTrackId,
    lyricSource,
    translationLang ?? targetLang,
  )

  const availableTranslationLangs = useMemo<MusicLyricTranslationLangStatus[]>(() => {
    if (lyricSource == null)
      return []
    const serverMap = new Map<string, MusicLyricTranslationLangStatus>()
    if (rawLangCapabilities?.source === lyricSource) {
      for (const item of rawLangCapabilities.languages)
        serverMap.set(item.lang, item)
    }
    return SUPPORTED_LYRIC_TARGET_LANGS.map((lang) => {
      const server = serverMap.get(lang)
      const clientNative = hasNativeTargetTranslation(rawLyrics, lang)
      const clientSameLanguage = !canAdminAiTranslateLyrics(rawLyrics, lang, track?.artists)
      return {
        lang,
        hasAi: Boolean(server?.hasAi),
        hasNative: Boolean(server?.hasNative || clientNative),
        generating: Boolean(
          server?.generating
          || (lang === (translationLang ?? targetLang) && requestedEntryGenerating),
        ),
        sameLanguage: server?.sameLanguage ?? clientSameLanguage,
      }
    })
  }, [lyricSource, rawLangCapabilities, rawLyrics, requestedEntryGenerating, targetLang, track?.artists, translationLang])

  const effectiveTranslationLang = useMemo<LyricTargetLang>(() => {
    if (translationLang == null)
      return targetLang
    if (translationLang === targetLang)
      return targetLang
    const entry = availableTranslationLangs.find(item => item.lang === translationLang)
    if (entry && (entry.hasAi || entry.hasNative || entry.generating))
      return translationLang
    return targetLang
  }, [availableTranslationLangs, targetLang, translationLang])

  const effectiveEntry = useMemo(
    () => availableTranslationLangs.find(item => item.lang === effectiveTranslationLang),
    [availableTranslationLangs, effectiveTranslationLang],
  )
  const hasExistingOrGeneratingAi = Boolean(effectiveEntry?.hasAi || effectiveEntry?.generating)
  const canAutoGenerateDefault = effectiveTranslationLang === targetLang
    && canAiTranslateLyrics(rawLyrics, targetLang, track?.artists)
  const canAiTranslate = Boolean(siteInfo.musicAiEnabled)
    && validTrackId != null
    && lyricSource != null
    && (hasExistingOrGeneratingAi || canAutoGenerateDefault)
  const wantsTranslations = showTranslation
    && canAiTranslate
    && (hasExistingOrGeneratingAi || isPlaying || translationRequested)
  useEffect(() => {
    if (!wantsTranslations || validTrackId == null || lyricSource == null)
      return
    if (!sourceTransitioning) {
      requestLyricTranslations(validTrackId, lyricSource, effectiveTranslationLang)
      return
    }
    // 歌词流仍在竞速选源且非最高优 TTML 时短暂防抖，避免为短暂过渡源误触发 AI 翻译
    const timer = setTimeout(() => {
      requestLyricTranslations(validTrackId, lyricSource, effectiveTranslationLang)
    }, 650)
    return () => clearTimeout(timer)
  }, [effectiveTranslationLang, lyricSource, sourceTransitioning, validTrackId, wantsTranslations])

  // 曲名与歌手译名并行触发，不等待歌词流结果
  const wantsMetaTranslation = Boolean(siteInfo.musicAiEnabled)
    && validTrackId != null
    && showTranslation
    && (effectiveTranslationLang === targetLang || hasExistingOrGeneratingAi)
    && (hasExistingOrGeneratingAi || isPlaying || translationRequested)
  useEffect(() => {
    if (wantsMetaTranslation && validTrackId != null)
      requestSongMetaTranslation(validTrackId, effectiveTranslationLang)
  }, [effectiveTranslationLang, validTrackId, wantsMetaTranslation])

  // 独立演唱者 / 多声部归属（有非器乐歌词行即请求后端查证，与翻译等任务进度完全隔离）
  const singerLang = showTranslation ? effectiveTranslationLang : ''
  const canResolveSingers = useMemo(() => canResolveLyricSingers(rawLyrics), [rawLyrics])
  const wantsSingers = Boolean(siteInfo.musicAiEnabled)
    && isPlaying
    && validTrackId != null
    && lyricSource != null
    && canResolveSingers
  useEffect(() => {
    if (!wantsSingers || validTrackId == null || lyricSource == null)
      return
    if (!sourceTransitioning) {
      requestLyricSingers(validTrackId, lyricSource, singerLang)
      return
    }
    const timer = setTimeout(() => {
      requestLyricSingers(validTrackId, lyricSource, singerLang)
    }, 650)
    return () => clearTimeout(timer)
  }, [lyricSource, singerLang, sourceTransitioning, validTrackId, wantsSingers])
  const rawSingers = useLyricSingers(canResolveSingers ? validTrackId : null, lyricSource, singerLang)
  const storedSingers = rawSingers && (!rawSingers.source || rawSingers.source === lyricSource) ? rawSingers : null

  // AI 歌词读音（按语种与当前界面语言自动显隐 / 缺口补全）
  const canAiPronounce = Boolean(siteInfo.musicAiEnabled)
    && validTrackId != null
    && lyricSource != null
    && canAiPronounceLyrics(rawLyrics, targetLang, track?.artists)
  const wantsPronunciations = showRomaji && canAiPronounce && (isPlaying || romajiRequested)
  useEffect(() => {
    if (!wantsPronunciations || validTrackId == null || lyricSource == null)
      return
    if (!sourceTransitioning) {
      requestLyricPronunciations(validTrackId, lyricSource)
      return
    }
    const timer = setTimeout(() => {
      requestLyricPronunciations(validTrackId, lyricSource)
    }, 650)
    return () => clearTimeout(timer)
  }, [lyricSource, sourceTransitioning, validTrackId, wantsPronunciations])
  const rawPronunciations = useLyricPronunciations(canAiPronounce ? validTrackId : null, lyricSource)
  const storedPronunciations = rawPronunciations && (!rawPronunciations.source || rawPronunciations.source === lyricSource)
    ? rawPronunciations
    : null
  const pronunciationsGenerating = useLyricPronunciationsGenerating(canAiPronounce ? validTrackId : null, lyricSource)

  const rawTranslations = useLyricTranslations(canAiTranslate ? validTrackId : null, lyricSource, effectiveTranslationLang)
  const storedTranslations = rawTranslations?.source === lyricSource
    && (!rawTranslations.targetLang || rawTranslations.targetLang === effectiveTranslationLang)
    ? rawTranslations
    : null
  const translationsGenerating = useLyricTranslationsGenerating(
    canAiTranslate ? validTrackId : null,
    lyricSource,
    effectiveTranslationLang,
  )
  const translatedLyrics = useMemo(
    () => applyLanguageTranslations(rawLyrics, effectiveTranslationLang, storedTranslations),
    [effectiveTranslationLang, rawLyrics, storedTranslations],
  )
  const aiTranslated = Boolean(
    storedTranslations
    && !storedTranslations.native
    && !storedTranslations.sameLanguage
    && storedTranslations.lines.some(line => line.translation.trim().length > 0),
  )
  const pronouncedLyrics = useMemo(
    () => applyPronunciationsAndFilter(translatedLyrics, targetLang, storedPronunciations),
    [storedPronunciations, targetLang, translatedLyrics],
  )
  const aiRomanized = Boolean(
    storedPronunciations
    && !storedPronunciations.completeUpstream
    && storedPronunciations.lines.some(line => Boolean(line.pronunciation?.trim()))
    && pronouncedLyrics.lines.some(line => Boolean(line.romanization)),
  )

  const wantsAnnotations = isPlaying && showLyricEffects && rawLyrics.wordTimed && isSiteVersion && trackId != null && trackId > 0
  useEffect(() => {
    if (wantsAnnotations && trackId != null)
      requestLyricAnnotations(trackId)
  }, [trackId, wantsAnnotations])
  const wantsHotComment = isPlaying && showLyricMoments && validTrackId != null
  useEffect(() => {
    if (wantsHotComment && validTrackId != null)
      requestSongHotComment(validTrackId)
  }, [validTrackId, wantsHotComment])
  const hotComment = useSongHotComment(showLyricMoments ? validTrackId : null)
  const storedAnnotations = useLyricAnnotations(trackId)
  const annotations = storedAnnotations?.source === rawLyrics.source ? storedAnnotations : null
  const emphasizedLyrics = useMemo(() => applyEmphasis(pronouncedLyrics, annotations), [annotations, pronouncedLyrics])
  const singerLyrics = useMemo(
    () => applyLyricSingers(emphasizedLyrics, storedSingers, showTranslation),
    [emphasizedLyrics, showTranslation, storedSingers],
  )
  const lyrics = useMemo(
    () => (showLyricMoments && !singerLyrics.outro && hotComment
      ? { ...singerLyrics, outro: hotComment }
      : singerLyrics),
    [hotComment, showLyricMoments, singerLyrics],
  )
  const annotationsGenerating = useLyricAnnotationsGenerating(showLyricEffects && rawLyrics.wordTimed && isSiteVersion ? trackId : null)
  const annotated = showLyricEffects && rawLyrics.wordTimed && ((annotations?.lines.length ?? 0) > 0 || (annotations?.singers?.length ?? 0) > 0)

  const state = useMemo<MusicLyricsState>(() => ({
    lyrics,
    candidates,
    kind,
    siteKind,
    isSiteVersion,
    pending,
    status,
    annotated,
    annotationsGenerating,
    aiTranslated,
    translationsGenerating,
    canAiTranslate,
    effectiveTranslationLang,
    availableTranslationLangs,
    aiRomanized,
    pronunciationsGenerating,
    canAiPronounce,
  }), [aiRomanized, aiTranslated, annotated, annotationsGenerating, availableTranslationLangs, canAiPronounce, canAiTranslate, candidates, effectiveTranslationLang, isSiteVersion, kind, lyrics, pending, pronunciationsGenerating, siteKind, status, translationsGenerating])

  useEffect(() => {
    onChange(state)
  }, [onChange, state])
  return null
}
