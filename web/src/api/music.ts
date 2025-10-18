import type { MusicTrack } from '@/models/music'
import { snakeToCamelObj } from 'field-conv'

export async function fetchPlaylist(): Promise<MusicTrack[]> {
  const response = await fetch('https://cdn.liteyuki.org/snowykami/playlist.json')
  if (!response.ok) {
    throw new Error('Network response was not ok')
  }
  return snakeToCamelObj(await response.json())
}

export async function fetchNcmLyric(id: number): Promise<string> {
  const url = `/api/music/lyric?song_id=${encodeURIComponent(String(id))}`
  const resp = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
    },
  })
  if (!resp.ok) {
    throw new Error('Network response was not ok')
  }
  const data = await resp.json()
  return data.lyrics
}
