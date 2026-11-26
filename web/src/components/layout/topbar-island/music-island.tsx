'use client'

import type { IslandSettings } from '@/utils/common/siteinfo'
import dynamic from 'next/dynamic'
import { useState } from 'react'
import { useMusicPlayback } from '@/contexts/music-context'

const MusicIslandActive = dynamic(
  () => import('./music-island-active').then(m => m.MusicIslandActive),
  { ssr: false },
)

/**
 * 音乐灵动岛轻量门卫外壳：
 * 未播放且本次会话未听过歌时不拉取歌词时间轴、副歌检测与辉光计算模块，降低每一页的首屏未用 JS；
 * 一旦开始播放（或当前会话已播放过）即挂载完整音乐活动状态机。
 *
 * 【双端同步维护约定】见 `./music-island-active.tsx` 与 `macos-island/Sources/NeoBlogIsland/`。
 */
export function MusicIsland({ settings }: { settings: IslandSettings }) {
  const { isPlaying, hasPlayed: sessionHasPlayed } = useMusicPlayback()
  const [localHasPlayed, setLocalHasPlayed] = useState(false)
  if (isPlaying && !localHasPlayed)
    setLocalHasPlayed(true)
  if (!isPlaying && !sessionHasPlayed && !localHasPlayed)
    return null
  return <MusicIslandActive settings={settings} />
}
