import type { LyricCandidate, LyricSourceKind } from '@/lib/lyrics/resolve'
import type { ResolvedLyrics } from '@/lib/lyrics/types'
import { EMPTY_LYRICS } from '@/lib/lyrics/types'

/** 歌词引擎交回 MusicProvider 的结果（引擎本身按需加载，见 music-lyrics-engine.tsx；这里只放类型与空值，不引入引擎） */
export interface MusicLyricsState {
  lyrics: ResolvedLyrics
  candidates: LyricCandidate[]
  kind: LyricSourceKind | null
  siteKind: LyricSourceKind | null
  isSiteVersion: boolean
  pending: boolean
  status: 'loading' | 'ready' | 'none'
  annotated: boolean
  annotationsGenerating: boolean
}

export const EMPTY_MUSIC_LYRICS_STATE: MusicLyricsState = {
  lyrics: EMPTY_LYRICS,
  candidates: [],
  kind: null,
  siteKind: null,
  isSiteVersion: true,
  pending: false,
  status: 'none',
  annotated: false,
  annotationsGenerating: false,
}
