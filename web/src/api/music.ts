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

// 歌单地址来自站点配置 siteInfo.musicPlaylistUrl
export async function fetchPlaylist(url: string): Promise<MusicTrack[]> {
  const response = await fetch(url)
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
