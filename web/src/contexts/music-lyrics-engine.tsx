'use client'

import type { MusicLyricsState } from './music-lyrics-engine-state'
import type { LyricTrackInfo } from '@/lib/lyrics/strip-credits'
import { useEffect, useMemo } from 'react'
import { applyEmphasis } from '@/lib/lyrics/emphasis'
import { requestLyricAnnotations, useLyricAnnotations, useLyricAnnotationsGenerating } from './lyric-annotations'
import { useResolvedSongLyrics } from './song-lyrics'

/**
 * 当前曲目的歌词引擎（来源获取与选择、各平台歌词解析、逐字音译对齐、AI 强调标注），从 music-context 中拆出来按需加载：
 * 这些代码（连带 wanakana 等）不小，而 MusicProvider 在根布局里、每一页都挂着。没有曲目时不加载，
 * 有曲目后（播放器空闲挂载、歌单就绪，或读者在文章里点了单曲卡）才下载，结果经 onChange 交回 MusicProvider
 */

export function MusicLyricsEngine({
  trackId,
  track,
  isPlaying,
  showLyricEffects,
  onChange,
}: {
  trackId: number | null
  track: LyricTrackInfo | null
  isPlaying: boolean
  showLyricEffects: boolean
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
  const wantsAnnotations = isPlaying && showLyricEffects && rawLyrics.wordTimed && isSiteVersion && trackId != null && trackId > 0
  useEffect(() => {
    if (wantsAnnotations && trackId != null)
      requestLyricAnnotations(trackId)
  }, [trackId, wantsAnnotations])
  const storedAnnotations = useLyricAnnotations(trackId)
  const annotations = storedAnnotations?.source === rawLyrics.source ? storedAnnotations : null
  const lyrics = useMemo(() => applyEmphasis(rawLyrics, annotations), [annotations, rawLyrics])
  const annotationsGenerating = useLyricAnnotationsGenerating(showLyricEffects && rawLyrics.wordTimed && isSiteVersion ? trackId : null)
  const annotated = showLyricEffects && rawLyrics.wordTimed && (annotations?.lines.length ?? 0) > 0

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
  }), [annotated, annotationsGenerating, candidates, isSiteVersion, kind, lyrics, pending, siteKind, status])

  useEffect(() => {
    onChange(state)
  }, [onChange, state])
  return null
}
