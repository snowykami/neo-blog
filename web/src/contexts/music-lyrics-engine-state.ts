import type { MusicLyricTranslationLangStatus } from '@/api/music'
import type { LyricCandidate, LyricSourceKind } from '@/lib/lyrics/resolve'
import type { LyricTargetLang, PronunciationLangBucket, TranslationSongBucket } from '@/lib/lyrics/target-lang'
import type { ResolvedLyrics } from '@/lib/lyrics/types'
import { EMPTY_LYRICS } from '@/lib/lyrics/types'

/** 歌词引擎交回 MusicProvider 的结果（引擎本身按需加载，见 music-lyrics-engine.tsx；这里只放类型与空值，不引入引擎） */
export interface MusicLyricsState {
  trackId: number | null
  lyrics: ResolvedLyrics
  candidates: LyricCandidate[]
  kind: LyricSourceKind | null
  siteKind: LyricSourceKind | null
  isSiteVersion: boolean
  pending: boolean
  status: 'loading' | 'ready' | 'none'
  annotated: boolean
  annotationsGenerating: boolean
  aiTranslated: boolean
  translationsGenerating: boolean
  canAiTranslate: boolean
  effectiveTranslationLang: LyricTargetLang
  availableTranslationLangs: MusicLyricTranslationLangStatus[]
  aiRomanized: boolean
  pronunciationsGenerating: boolean
  canAiPronounce: boolean
  hasRomajiCandidate: boolean
  pronunciationBucket: PronunciationLangBucket | null
  translationBucket: TranslationSongBucket | null
}

export const EMPTY_MUSIC_LYRICS_STATE: MusicLyricsState = {
  trackId: null,
  lyrics: EMPTY_LYRICS,
  candidates: [],
  kind: null,
  siteKind: null,
  isSiteVersion: true,
  pending: false,
  status: 'none',
  annotated: false,
  annotationsGenerating: false,
  aiTranslated: false,
  translationsGenerating: false,
  canAiTranslate: false,
  effectiveTranslationLang: 'en',
  availableTranslationLangs: [],
  aiRomanized: false,
  pronunciationsGenerating: false,
  canAiPronounce: false,
  hasRomajiCandidate: false,
  pronunciationBucket: null,
  translationBucket: null,
}
