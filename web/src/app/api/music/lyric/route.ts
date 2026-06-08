import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

interface CachedLyric {
  lrc?: { lyric: string, version: number } | null
  tlyric?: { lyric: string, version: number } | null
  romalrc?: { lyric: string, version: number } | null
  yrc?: { lyric: string, version: number } | null
  ytlrc?: { lyric: string, version: number } | null
  yromalrc?: { lyric: string, version: number } | null
}

const lyricCache = new Map<string, CachedLyric>()

const LYRIC_API_BASE = 'https://ncm-api.sfkm.me/lyric'

async function fetchLyricJson(songId: string) {
  const response = await fetch(`${LYRIC_API_BASE}/new?id=${encodeURIComponent(songId)}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch lyric: ${response.status} ${response.statusText}`)
  }
  return await response.json()
}

async function fetchFallbackLyricJson(songId: string) {
  const response = await fetch(`https://music.163.com/api/song/lyric?id=${encodeURIComponent(songId)}&cp=false&lv=1&tv=1&rv=1&kv=1&yv=1&ytv=1`)
  if (!response.ok) {
    throw new Error('Failed to fetch lyrics')
  }
  return JSON.parse(await response.text())
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const songId = searchParams.get('song_id')

  if (!songId) {
    return NextResponse.json({ error: 'Song ID is required' }, { status: 400 })
  }

  if (lyricCache.has(songId)) {
    return NextResponse.json(lyricCache.get(songId), { status: 200 })
  }

  let payload: CachedLyric = {
    lrc: { lyric: '[00:00.00]no_lyric', version: 1 },
    yrc: null,
  }
  try {
    const lyricsJson = await fetchLyricJson(songId).catch(() => fetchFallbackLyricJson(songId))
    payload = {
      lrc: lyricsJson?.lrc ?? { lyric: lyricsJson?.nolyric ? '[00:00.00]pure_music_without_lyric' : '[00:00.00]no_lyric', version: 1 },
      tlyric: lyricsJson?.tlyric ?? null,
      romalrc: lyricsJson?.romalrc ?? null,
      yrc: lyricsJson?.yrc ?? null,
      ytlrc: lyricsJson?.ytlrc ?? null,
      yromalrc: lyricsJson?.yromalrc ?? null,
    }
  }
  catch (error) {
    console.error('Failed to parse lyrics JSON:', error)
  }
  lyricCache.set(songId, payload)

  return NextResponse.json(payload, { status: 200 })
}
