'use client'

import { useEffect, useState } from 'react'
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
