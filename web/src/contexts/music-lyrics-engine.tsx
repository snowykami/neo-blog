'use client'

import type { SiteLyricTranslations } from './lyric-translations'
import type { MusicLyricsState } from './music-lyrics-engine-state'
import type { MusicLyricTranslationLangStatus } from '@/api/music'
import type { LyricTranslationSelection } from '@/lib/lyrics/lyric-language'
import type { LyricTrackInfo } from '@/lib/lyrics/strip-credits'
import type { LyricTargetLang } from '@/lib/lyrics/target-lang'
import type { LyricLang } from '@/lib/lyrics/types'
import { useLocale } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useSiteInfo } from '@/contexts/site-info-context'
import { normalizeDisplayLangTag } from '@/lib/language-label'
import { applyLyricSingers, canResolveLyricSingers } from '@/lib/lyrics/apply-singers'
import { applyEmphasis } from '@/lib/lyrics/emphasis'
import {
  applyDualLanguageTranslations,
  canAdminAiTranslateLyrics,
  canAiTranslateLyrics,
  detectClientSongDisplayLang,
  detectSongTranslationBucket,
  hasNativeTargetTranslation,
  toLyricTargetLang,
} from '@/lib/lyrics/lyric-language'
import {
  applyPronunciationsAndFilter,
  canAiPronounceLyrics,
  detectSongPronunciationBucket,
  shouldHideSameLangPronunciation,
} from '@/lib/lyrics/lyric-pronunciation'
import { getRhythmParams, subscribeRhythmParams } from '@/lib/lyrics/rhythm/params'
import {
  resolveBucketSelections,
  resolvePronunciationEnabled,
  resolveTranslationEnabled,
  SUPPORTED_LYRIC_TARGET_LANGS,
  toPronunciationBucket,
} from '@/lib/lyrics/target-lang'
import { requestLyricAnnotations, useLyricAnnotations, useLyricAnnotationsGenerating } from './lyric-annotations'
import { requestLyricMotion, useLyricMotion } from './lyric-motion'
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
  preferNativeTranslation = false,
  translationSelections,
  translationPrefs,
  defaultShowTranslation,
  translationSelectionsByBucket,
  defaultTranslationSelections,
  showRomaji,
  romajiRequested,
  pronunciationPrefs,
  defaultShowRomaji,
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
  preferNativeTranslation?: boolean
  translationSelections?: LyricTranslationSelection[]
  translationPrefs?: Record<string, boolean>
  defaultShowTranslation?: boolean
  translationSelectionsByBucket?: Record<string, LyricTranslationSelection[]>
  defaultTranslationSelections?: LyricTranslationSelection[]
  showRomaji: boolean
  romajiRequested: boolean
  pronunciationPrefs?: Record<string, boolean>
  defaultShowRomaji?: boolean
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

  // 能力检测放开同语种（同语言策略仅作默认关闭，允许读者手动打开拼音/音标）
  const canAiPronounce = Boolean(siteInfo.musicAiEnabled)
    && validTrackId != null
    && lyricSource != null
    && canAiPronounceLyrics(rawLyrics, targetLang, track?.artists, { includeSameLang: true })
  const rawPronunciations = useLyricPronunciations(canAiPronounce ? validTrackId : null, lyricSource)
  const storedPronunciations = rawPronunciations && (!rawPronunciations.source || rawPronunciations.source === lyricSource)
    ? rawPronunciations
    : null
  const pronunciationsGenerating = useLyricPronunciationsGenerating(canAiPronounce ? validTrackId : null, lyricSource)

  const pronunciationBucket = useMemo(
    () => detectSongPronunciationBucket(rawLyrics, storedPronunciations, track?.artists),
    [rawLyrics, storedPronunciations, track?.artists],
  )
  const translationBucket = useMemo(
    () => detectSongTranslationBucket(rawLyrics, targetLang, track?.artists),
    [rawLyrics, targetLang, track?.artists],
  )

  const effectiveShowRomaji = useMemo(() => (
    pronunciationPrefs
      ? resolvePronunciationEnabled(pronunciationPrefs, targetLang, pronunciationBucket, defaultShowRomaji ?? showRomaji)
      : showRomaji
  ), [defaultShowRomaji, pronunciationBucket, pronunciationPrefs, showRomaji, targetLang])

  const effectiveShowTranslation = useMemo(() => (
    translationPrefs
      ? resolveTranslationEnabled(
          translationPrefs,
          translationSelectionsByBucket ?? {},
          targetLang,
          translationBucket,
          defaultShowTranslation ?? showTranslation,
        )
      : showTranslation
  ), [defaultShowTranslation, showTranslation, targetLang, translationBucket, translationPrefs, translationSelectionsByBucket])

  const resolvedBucketSelections = useMemo<LyricTranslationSelection[] | undefined>(() => {
    if (translationSelectionsByBucket) {
      return resolveBucketSelections(
        translationSelectionsByBucket,
        targetLang,
        translationBucket,
        defaultTranslationSelections ?? [],
      )
    }
    return translationSelections
  }, [defaultTranslationSelections, targetLang, translationBucket, translationSelections, translationSelectionsByBucket])

  const rawSelections = useMemo<LyricTranslationSelection[]>(() => {
    if (resolvedBucketSelections !== undefined)
      return resolvedBucketSelections.slice(0, 2)
    return translationLang ? [{ lang: translationLang, preferNative: preferNativeTranslation }] : []
  }, [preferNativeTranslation, resolvedBucketSelections, translationLang])

  const rawLangCapabilities = useLyricTranslationLanguages(validTrackId, lyricSource)
  const rawSlot0Lang = rawSelections[0]?.lang ?? targetLang
  const rawSlot1Lang = rawSelections[1]?.lang ?? ''
  const rawSlot0Generating = useLyricTranslationsGenerating(validTrackId, lyricSource, rawSlot0Lang)
  const rawSlot1Generating = useLyricTranslationsGenerating(validTrackId, lyricSource, rawSlot1Lang)

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
      const clientSlotGenerating = (lang === rawSlot0Lang && rawSlot0Generating)
        || (lang === rawSlot1Lang && rawSlot1Generating)
      return {
        lang,
        hasAi: Boolean(server?.hasAi),
        hasNative: Boolean(server?.hasNative || clientNative),
        generating: Boolean(server?.generating || clientSlotGenerating),
        sameLanguage: server?.sameLanguage ?? clientSameLanguage,
      }
    })
  }, [lyricSource, rawLangCapabilities, rawLyrics, rawSlot0Generating, rawSlot0Lang, rawSlot1Generating, rawSlot1Lang, track?.artists])

  const effectiveSelections = useMemo<LyricTranslationSelection[]>(() => {
    const resolved: LyricTranslationSelection[] = []
    const seen = new Set<string>()
    for (const item of rawSelections) {
      const entry = availableTranslationLangs.find(candidate => candidate.lang === item.lang)
      const available = item.lang === targetLang || Boolean(entry && (entry.hasAi || entry.hasNative || entry.generating))
      if (!available)
        continue
      const preferNative = Boolean(item.preferNative && hasNativeTargetTranslation(rawLyrics, item.lang))
      const key = `${item.lang}:${preferNative}`
      if (seen.has(key))
        continue
      seen.add(key)
      resolved.push({ lang: item.lang, preferNative })
    }
    if (resolved.length === 2 && resolved[0].lang === resolved[1].lang) {
      const entry = availableTranslationLangs.find(candidate => candidate.lang === resolved[0].lang)
      const hasDualForLang = hasNativeTargetTranslation(rawLyrics, resolved[0].lang)
        && Boolean(entry?.hasAi || entry?.generating)
      if (!hasDualForLang)
        resolved.splice(1)
    }
    if (resolved.length === 0) {
      // 同语言歌曲若用户打开了译文且当前无本语种译文，智能回退到首个可用的外语译文
      if (translationBucket === 'same') {
        const targetEntry = availableTranslationLangs.find(candidate => candidate.lang === targetLang)
        const targetUnavailable = !targetEntry
          || (targetEntry.sameLanguage && !targetEntry.hasAi && !targetEntry.hasNative && !targetEntry.generating)
        if (targetUnavailable) {
          const firstAvailable = availableTranslationLangs.find(
            candidate => candidate.lang !== targetLang && (candidate.hasAi || candidate.hasNative || candidate.generating),
          )
          if (firstAvailable) {
            return [{
              lang: firstAvailable.lang as LyricTargetLang,
              preferNative: !firstAvailable.hasAi && !firstAvailable.generating && firstAvailable.hasNative,
            }]
          }
        }
      }
      return [{ lang: targetLang, preferNative: false }]
    }
    return resolved
  }, [availableTranslationLangs, rawLyrics, rawSelections, targetLang, translationBucket])

  const primarySlot = effectiveSelections[0]
  const secondarySlot = effectiveSelections[1] ?? null
  const effectiveTranslationLang = primarySlot.lang

  const primaryEntry = useMemo(
    () => availableTranslationLangs.find(item => item.lang === effectiveTranslationLang),
    [availableTranslationLangs, effectiveTranslationLang],
  )
  const secondaryEntry = useMemo(
    () => (secondarySlot ? availableTranslationLangs.find(item => item.lang === secondarySlot.lang) : undefined),
    [availableTranslationLangs, secondarySlot],
  )

  const checkSlotAiEnabled = (
    slot: LyricTranslationSelection | null,
    entry: MusicLyricTranslationLangStatus | undefined,
  ): boolean => {
    if (!slot || !siteInfo.musicAiEnabled || validTrackId == null || lyricSource == null)
      return false
    const hasAiOrGenerating = Boolean(entry?.hasAi || entry?.generating)
    const canAutoDefault = slot.lang === targetLang && canAiTranslateLyrics(rawLyrics, targetLang, track?.artists)
    return hasAiOrGenerating || canAutoDefault
  }

  const primaryCanAi = checkSlotAiEnabled(primarySlot, primaryEntry)
  const secondaryCanAi = checkSlotAiEnabled(secondarySlot, secondaryEntry)
  const canAiTranslate = primaryCanAi || secondaryCanAi

  const checkWantsSlotTranslation = (
    slot: LyricTranslationSelection | null,
    entry: MusicLyricTranslationLangStatus | undefined,
    slotCanAi: boolean,
  ): boolean => {
    if (!slot || !slotCanAi || slot.preferNative)
      return false
    const hasExistingOrGenerating = Boolean(entry?.hasAi || entry?.generating)
    return effectiveShowTranslation && (hasExistingOrGenerating || isPlaying || translationRequested)
  }

  const wantsPrimaryTranslations = checkWantsSlotTranslation(primarySlot, primaryEntry, primaryCanAi)
  const wantsSecondaryTranslations = checkWantsSlotTranslation(secondarySlot, secondaryEntry, secondaryCanAi)
  const primaryRequestLang = wantsPrimaryTranslations ? primarySlot.lang : null
  const secondaryRequestLang = wantsSecondaryTranslations && secondarySlot && secondarySlot.lang !== primaryRequestLang
    ? secondarySlot.lang
    : null

  useEffect(() => {
    if (validTrackId == null || lyricSource == null)
      return
    if (!primaryRequestLang && !secondaryRequestLang)
      return
    const trigger = () => {
      if (primaryRequestLang)
        requestLyricTranslations(validTrackId, lyricSource, primaryRequestLang)
      if (secondaryRequestLang)
        requestLyricTranslations(validTrackId, lyricSource, secondaryRequestLang)
    }
    if (!sourceTransitioning) {
      trigger()
      return
    }
    // 歌词流仍在竞速选源且非最高优 TTML 时短暂防抖，避免为短暂过渡源误触发 AI 翻译
    const timer = setTimeout(trigger, 650)
    return () => clearTimeout(timer)
  }, [lyricSource, primaryRequestLang, secondaryRequestLang, sourceTransitioning, validTrackId])

  // 曲名与歌手译名并行触发，不等待歌词流结果
  const hasExistingOrGeneratingPrimaryAi = Boolean(primaryEntry?.hasAi || primaryEntry?.generating)
  const wantsMetaTranslation = Boolean(siteInfo.musicAiEnabled)
    && validTrackId != null
    && effectiveShowTranslation
    && (effectiveTranslationLang === targetLang || hasExistingOrGeneratingPrimaryAi)
    && (hasExistingOrGeneratingPrimaryAi || isPlaying || translationRequested)
  useEffect(() => {
    if (wantsMetaTranslation && validTrackId != null)
      requestSongMetaTranslation(validTrackId, effectiveTranslationLang)
  }, [effectiveTranslationLang, validTrackId, wantsMetaTranslation])

  // 独立演唱者 / 多声部归属（有非器乐歌词行即请求后端查证，与翻译等任务进度完全隔离）
  const singerLang = effectiveShowTranslation ? effectiveTranslationLang : ''
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

  const isLineLangEnabled = useCallback((lineLang: LyricLang) => (
    pronunciationPrefs
      ? resolvePronunciationEnabled(pronunciationPrefs, targetLang, toPronunciationBucket(lineLang), defaultShowRomaji ?? showRomaji)
      : (showRomaji && !shouldHideSameLangPronunciation(lineLang, targetLang))
  ), [defaultShowRomaji, pronunciationPrefs, showRomaji, targetLang])

  const canAiPronounceEnabled = canAiPronounce
    && canAiPronounceLyrics(rawLyrics, targetLang, track?.artists, { isLangEnabled: isLineLangEnabled })
  const wantsPronunciations = effectiveShowRomaji && canAiPronounceEnabled && (isPlaying || romajiRequested)
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

  const rawPrimaryTranslations = useLyricTranslations(
    primaryCanAi && !primarySlot.preferNative ? validTrackId : null,
    lyricSource,
    primarySlot.lang,
  )
  const rawSecondaryTranslations = useLyricTranslations(
    secondarySlot && secondaryCanAi && !secondarySlot.preferNative ? validTrackId : null,
    lyricSource,
    secondarySlot?.lang ?? '',
  )
  const matchStoredTranslations = (
    raw: SiteLyricTranslations | null,
    lang: LyricTargetLang | undefined,
  ): SiteLyricTranslations | null => (
    raw?.source === lyricSource && (!raw.targetLang || raw.targetLang === lang) ? raw : null
  )
  const storedPrimaryTranslations = matchStoredTranslations(rawPrimaryTranslations, primarySlot.lang)
  const storedSecondaryTranslations = matchStoredTranslations(rawSecondaryTranslations, secondarySlot?.lang)

  const primaryGenerating = useLyricTranslationsGenerating(
    primaryCanAi && !primarySlot.preferNative ? validTrackId : null,
    lyricSource,
    primarySlot.lang,
  )
  const secondaryGenerating = useLyricTranslationsGenerating(
    secondarySlot && secondaryCanAi && !secondarySlot.preferNative ? validTrackId : null,
    lyricSource,
    secondarySlot?.lang ?? '',
  )
  const translationsGenerating = primaryGenerating || secondaryGenerating

  const translatedLyrics = useMemo(
    () => applyDualLanguageTranslations(
      rawLyrics,
      { lang: primarySlot.lang, preferNative: primarySlot.preferNative, ai: storedPrimaryTranslations },
      secondarySlot
        ? { lang: secondarySlot.lang, preferNative: secondarySlot.preferNative, ai: storedSecondaryTranslations }
        : null,
    ),
    [primarySlot, rawLyrics, secondarySlot, storedPrimaryTranslations, storedSecondaryTranslations],
  )
  const isAiTranslationActive = (
    slot: LyricTranslationSelection | null,
    stored: SiteLyricTranslations | null,
  ) => Boolean(
    slot
    && !slot.preferNative
    && stored
    && !stored.native
    && !stored.sameLanguage
    && stored.lines.some(line => line.translation.trim().length > 0),
  )
  const aiTranslated = isAiTranslationActive(primarySlot, storedPrimaryTranslations)
    || isAiTranslationActive(secondarySlot, storedSecondaryTranslations)
  const pronouncedLyrics = useMemo(
    () => applyPronunciationsAndFilter(translatedLyrics, targetLang, storedPronunciations, isLineLangEnabled),
    [isLineLangEnabled, storedPronunciations, targetLang, translatedLyrics],
  )
  const hasRomajiCandidate = useMemo(() => (
    rawLyrics.lines.some(line => Boolean(line.romanization?.trim()))
    || Boolean(storedPronunciations?.lines.some(line => Boolean(line.pronunciation?.trim())))
  ), [rawLyrics.lines, storedPronunciations])
  const aiRomanized = Boolean(
    storedPronunciations
    && !storedPronunciations.completeUpstream
    && storedPronunciations.lines.some(line => Boolean(line.pronunciation?.trim()))
    && pronouncedLyrics.lines.some(line => Boolean(line.romanization)),
  )

  const storedAnnotations = useLyricAnnotations(trackId)
  const annotations = storedAnnotations?.source === rawLyrics.source ? storedAnnotations : null
  const wantsAnnotations = isPlaying && showLyricEffects && rawLyrics.wordTimed && isSiteVersion && trackId != null && trackId > 0
  useEffect(() => {
    if (wantsAnnotations && trackId != null)
      requestLyricAnnotations(trackId)
  }, [trackId, wantsAnnotations])
  const wantsMotion = isPlaying && validTrackId != null && lyricSource != null && !rawLyrics.instrumental && rawLyrics.lines.length > 0
  useEffect(() => {
    if (!wantsMotion || validTrackId == null || lyricSource == null)
      return
    if (annotations?.motion)
      return
    // 逐字全站词源且已开启 AI 歌词特效时，错开 400ms 让 /annotations 先建立任务租约，避免同帧并发双倍触发大模型
    if (wantsAnnotations && siteInfo.musicAiEnabled) {
      const timer = setTimeout(requestLyricMotion, 400, validTrackId, lyricSource)
      return () => clearTimeout(timer)
    }
    requestLyricMotion(validTrackId, lyricSource)
  }, [annotations?.motion, lyricSource, siteInfo.musicAiEnabled, validTrackId, wantsAnnotations, wantsMotion])
  const wantsHotComment = isPlaying && showLyricMoments && validTrackId != null
  useEffect(() => {
    if (wantsHotComment && validTrackId != null)
      requestSongHotComment(validTrackId)
  }, [validTrackId, wantsHotComment])
  const hotComment = useSongHotComment(showLyricMoments ? validTrackId : null)
  const standaloneMotion = useLyricMotion(validTrackId, lyricSource)
  const motionPreview = useSyncExternalStore(
    subscribeRhythmParams,
    () => getRhythmParams().motionPreview,
    () => null,
  )
  const effectiveMotion = motionPreview
    ?? (standaloneMotion?.ai ? standaloneMotion.motion : undefined)
    ?? annotations?.motion
    ?? standaloneMotion?.motion
  const emphasizedLyrics = useMemo(() => applyEmphasis(pronouncedLyrics, annotations), [annotations, pronouncedLyrics])
  const singerLyrics = useMemo(
    () => applyLyricSingers(emphasizedLyrics, storedSingers, effectiveShowTranslation),
    [effectiveShowTranslation, emphasizedLyrics, storedSingers],
  )
  const lyrics = useMemo(() => {
    let resolved = singerLyrics
    if (effectiveMotion && resolved.motion !== effectiveMotion)
      resolved = { ...resolved, motion: effectiveMotion }
    if (showLyricMoments && !resolved.outro && hotComment)
      resolved = { ...resolved, outro: hotComment }
    return resolved
  }, [effectiveMotion, hotComment, showLyricMoments, singerLyrics])
  const annotationsGenerating = useLyricAnnotationsGenerating(showLyricEffects && rawLyrics.wordTimed && isSiteVersion ? trackId : null)
  const annotated = showLyricEffects && rawLyrics.wordTimed && ((annotations?.lines.length ?? 0) > 0 || (annotations?.singers?.length ?? 0) > 0)

  const matchedPronunciationLang = (storedPronunciations?.source === lyricSource ? storedPronunciations?.lang : '')?.trim().toLowerCase() ?? ''
  const refreshedSongLangKeyRef = useRef('')
  useEffect(() => {
    if (validTrackId == null || lyricSource == null)
      return
    const nextAiHint = annotations?.songLang || (matchedPronunciationLang && matchedPronunciationLang !== 'other' ? matchedPronunciationLang : '')
    if (!nextAiHint || rawLangCapabilities?.source !== lyricSource || rawLangCapabilities.songLang)
      return
    const refreshKey = `${validTrackId}:${lyricSource}:${nextAiHint}`
    if (refreshedSongLangKeyRef.current === refreshKey)
      return
    refreshedSongLangKeyRef.current = refreshKey
    requestLyricTranslationLanguages(validTrackId, lyricSource, true)
  }, [annotations?.songLang, lyricSource, matchedPronunciationLang, rawLangCapabilities?.songLang, rawLangCapabilities?.source, validTrackId])

  const songLang = useMemo<string | null>(() => {
    const rankOf = (code: string): number => {
      if (!code)
        return 0
      if (code === 'zh-cn' || code === 'en' || code === 'ja' || code === 'ko')
        return 1
      if (code === 'zh-tw' || code === 'zh-hk')
        return 2
      return 3
    }
    const fromCapabilities = rawLangCapabilities?.source === lyricSource
      ? normalizeDisplayLangTag(rawLangCapabilities.songLang)
      : ''
    const fromAnnotations = normalizeDisplayLangTag(annotations?.songLang)
    const fromPronunciations = matchedPronunciationLang === 'zh-hk'
      ? 'yue'
      : (matchedPronunciationLang && matchedPronunciationLang !== 'other' ? normalizeDisplayLangTag(matchedPronunciationLang) : '')
    const fromClient = normalizeDisplayLangTag(detectClientSongDisplayLang(rawLyrics))

    let best = ''
    let bestRank = 0
    for (const candidate of [fromCapabilities, fromAnnotations, fromPronunciations, fromClient]) {
      const r = rankOf(candidate)
      if (r > bestRank) {
        best = candidate
        bestRank = r
      }
    }
    return best || null
  }, [annotations?.songLang, lyricSource, matchedPronunciationLang, rawLangCapabilities, rawLyrics])

  const state = useMemo<MusicLyricsState>(() => ({
    trackId: validTrackId,
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
    songLang,
    availableTranslationLangs,
    aiRomanized,
    pronunciationsGenerating,
    canAiPronounce,
    hasRomajiCandidate,
    pronunciationBucket,
    translationBucket,
  }), [
    aiRomanized,
    aiTranslated,
    annotated,
    annotationsGenerating,
    availableTranslationLangs,
    canAiPronounce,
    canAiTranslate,
    candidates,
    effectiveTranslationLang,
    hasRomajiCandidate,
    isSiteVersion,
    kind,
    lyrics,
    pending,
    pronunciationBucket,
    pronunciationsGenerating,
    siteKind,
    songLang,
    status,
    translationBucket,
    translationsGenerating,
    validTrackId,
  ])

  useEffect(() => {
    onChange(state)
  }, [onChange, state])
  return null
}
