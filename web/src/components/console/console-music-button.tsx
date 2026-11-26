'use client'

import { useTranslations } from 'next-intl'
import dynamic from 'next/dynamic'
import { useState } from 'react'
import { AlbumNavIcon, MINI_PLAYER_POPOVER_CLASSNAME, MINI_PLAYER_POPOVER_STYLE } from '@/components/common/music-player-shared'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { activateMusicRuntime, preloadMusicRuntime, useMusicPlayback } from '@/contexts/music-context'
import { useSiteInfo } from '@/contexts/site-info-context'

// 播放器本体很重（歌词引擎、特效），点击展开时再按需加载
const MiniPlayer = dynamic(() => import('@/components/common/mini-player').then(m => m.MiniPlayer), { ssr: false })
function preloadConsoleMusicChunks() {
  preloadMusicRuntime()
  void import('@/components/common/music-player')
  void import('@/components/common/mini-player')
}

function handleHoverOrTouch() {
  preloadConsoleMusicChunks()
  activateMusicRuntime()
}

/**
 * 后台顶栏的音乐入口：后台不显示悬浮球（见 components/common/music-player.tsx），在顶栏右侧放一个旋转封面按钮，
 * 点按弹出与悬浮球相同的悬浮播放器，不挡保存栏、编辑器状态等内容区的操作。后台开启音乐或已有播放曲目时展示，悬停激活控制器、点击拉取歌单
 */
export function ConsoleMusicButton() {
  const t = useTranslations('MusicPlayer')
  const { siteInfo } = useSiteInfo()
  const { currentTrack } = useMusicPlayback()
  const [open, setOpen] = useState(false)
  if (!siteInfo.musicEnabled && !currentTrack)
    return null
  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          preloadConsoleMusicChunks()
          activateMusicRuntime({ syncPlaylist: true })
        }
        setOpen(nextOpen)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={t('floating_player')}
          title={t('floating_player')}
          onPointerEnter={(e) => {
            if (e.pointerType === 'mouse')
              handleHoverOrTouch()
          }}
          onTouchStart={handleHoverOrTouch}
          onFocus={preloadConsoleMusicChunks}
        >
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
        {open && <MiniPlayer onOpenPage={() => setOpen(false)} />}
      </PopoverContent>
    </Popover>
  )
}
