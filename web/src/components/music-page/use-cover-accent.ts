'use client'

import { useEffect, useState } from 'react'
import { useMusic } from '@/contexts/music-context'
import { loadCoverAccent } from '@/lib/lyrics/cover-color'

/** 封面主色（见 lib/lyrics/cover-color.ts）；切歌时先清空，读取失败时为 null */
export function useCoverAccent(cover?: string): string | null {
  const [accent, setAccent] = useState<{ cover: string, color: string | null } | null>(null)
  useEffect(() => {
    if (!cover)
      return
    let cancelled = false
    loadCoverAccent(cover).then((color) => {
      if (!cancelled)
        setAccent({ cover, color })
    }, () => {})
    return () => {
      cancelled = true
    }
  }, [cover])
  return accent && accent.cover === cover ? accent.color : null
}

/** 当前歌曲的主题色：歌词标注里模型选的颜色优先（不受封面限制），没有时用封面主色 */
export function useSongAccent(cover?: string): string | null {
  const { lyrics } = useMusic()
  const coverAccent = useCoverAccent(cover)
  return lyrics.accent ?? coverAccent
}
