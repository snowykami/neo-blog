'use client'

import { useTranslations } from 'next-intl'
import dynamic from 'next/dynamic'
import { useState } from 'react'
import { AlbumNavIcon, MINI_PLAYER_POPOVER_CLASSNAME, MINI_PLAYER_POPOVER_STYLE } from '@/components/common/music-player-shared'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useMusic } from '@/contexts/music-context'

// 播放器本体很重（歌词引擎、特效），与悬浮球共用同一个按需加载的 chunk（main-floating-widgets 空闲时已加载）
const MiniPlayer = dynamic(() => import('@/components/common/music-player').then(m => m.MiniPlayer), { ssr: false })

/**
 * 后台顶栏的音乐入口：后台不显示悬浮球（见 components/common/music-player.tsx），在顶栏右侧放一个旋转封面按钮，
 * 点按弹出与悬浮球相同的悬浮播放器，不挡保存栏、编辑器状态等内容区的操作。歌单恢复出曲目后才出现
 */
export function ConsoleMusicButton() {
  const t = useTranslations('MusicPlayer')
  const { currentTrack } = useMusic()
  const [open, setOpen] = useState(false)
  if (!currentTrack)
    return null
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label={t('floating_player')} title={t('floating_player')}>
          <AlbumNavIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={8}
        className={MINI_PLAYER_POPOVER_CLASSNAME}
        style={MINI_PLAYER_POPOVER_STYLE}
      >
        <MiniPlayer onOpenPage={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}
