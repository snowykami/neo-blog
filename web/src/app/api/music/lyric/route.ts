import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

const lyricCache = new Map<string, string>()

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const songId = searchParams.get('song_id')

  if (!songId) {
    return NextResponse.json({ error: 'Song ID is required' }, { status: 400 })
  }

  if (lyricCache.has(songId)) {
    return NextResponse.json({ lyrics: lyricCache.get(songId) }, { status: 200 })
  }

  // 这个接口响应的Content-Type为text/html，但实际上是JSON格式
  const lyricsJsonText = await fetch(`https://music.163.com/api/song/media?id=${songId}`)
    .then((res) => {
      if (!res.ok) {
        throw new Error('Failed to fetch lyrics')
      }
      return res.text()
    })

  let lyrics = ''
  try {
    const lyricsJson = JSON.parse(lyricsJsonText)
    lyrics = lyricsJson?.lyric ?? (lyricsJson?.nolyric ? 'pure_music' : 'no_lyric')
  }
  catch (error) {
    console.error('Failed to parse lyrics JSON:', error)
  }
  lyricCache.set(songId, lyrics)

  return NextResponse.json({ lyrics }, { status: 200 })
}
