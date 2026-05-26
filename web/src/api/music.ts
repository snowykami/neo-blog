import type { MusicTrack } from '@/models/music'
import { snakeToCamelObj } from 'field-conv'

export interface MusicLyrics {
  lrc?: { lyric: string, version: number } | null
  tlyric?: { lyric: string, version: number } | null
  romalrc?: { lyric: string, version: number } | null
  yrc?: { lyric: string, version: number } | null
  ytlrc?: { lyric: string, version: number } | null
  yromalrc?: { lyric: string, version: number } | null
}

export async function fetchPlaylist(): Promise<MusicTrack[]> {
  const response = await fetch('https://cdn.liteyuki.org/snowykami/music/playlists/favorite.json')
  if (!response.ok) {
    throw new Error('Network response was not ok')
  }
  return snakeToCamelObj(await response.json())
}

export async function fetchNcmLyric(id: number): Promise<MusicLyrics> {
  const url = `/api/music/lyric?song_id=${encodeURIComponent(String(id))}`
  const resp = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
    },
  })
  if (!resp.ok) {
    throw new Error('Network response was not ok')
  }
  return await resp.json()
}
