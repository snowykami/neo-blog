'use client'

import { ListMusicIcon, SearchIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MUSIC_ICON_BUTTON_CLASSNAME } from '@/components/music-page/music-page-controls'
import { MusicPlaylistItem } from '@/components/music-page/music-playlist-sheet'
import { filterPlaylist } from '@/components/music-page/playlist-filter'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useMusic } from '@/contexts/music-context'
import { cn } from '@/lib/utils'

/**
 * 悬浮播放器的小歌单：从歌单按钮弹出的小浮层（不使用播放器页的侧边抽屉），列表内搜索与播放器页相同（不联网）；
 * 打开时滚动到当前曲目，点击即播放并收起
 */
export function MusicMiniPlaylist() {
  const t = useTranslations('MusicPage')
  const { playlist, currentIndex, isPlaying, playTrack } = useMusic()
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const listRef = useRef<HTMLOListElement>(null)
  const results = useMemo(() => filterPlaylist(playlist, keyword), [keyword, playlist])

  const handleSelect = useCallback((index: number) => {
    playTrack(index)
    setOpen(false)
    setKeyword('')
  }, [playTrack])

  useEffect(() => {
    if (!open)
      return
    const frame = requestAnimationFrame(() => {
      listRef.current?.querySelector(`[data-index="${currentIndex}"]`)?.scrollIntoView({ block: 'center' })
    })
    return () => cancelAnimationFrame(frame)
  }, [open, currentIndex])

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next)
          setKeyword('')
      }}
    >
      <PopoverTrigger aria-label={t('open_playlist')} title={t('open_playlist')} className={cn(MUSIC_ICON_BUTTON_CLASSNAME, open && 'bg-white/10 text-white')}>
        <ListMusicIcon aria-hidden className="size-5" />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        collisionPadding={8}
        // 层级高于悬浮播放器的弹层（z-1000）；弹层渲染在 body 下，单独加 dark
        className="dark z-1001 grid w-72 max-w-[calc(100vw-1rem)] gap-2 rounded-xl border-white/10 bg-neutral-900/95 p-2 text-white shadow-2xl backdrop-blur-xl"
      >
        <div className="flex items-center justify-between px-1.5 pt-0.5 text-xs font-medium text-white/60">
          {t('playlist_title', { count: playlist.length })}
        </div>
        <div className="relative">
          <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-white/50" />
          <Input
            type="search"
            value={keyword}
            onChange={event => setKeyword(event.target.value)}
            placeholder={t('search_placeholder')}
            aria-label={t('search_placeholder')}
            className="h-8 border-white/15 bg-white/10 pl-8 text-xs text-white placeholder:text-white/40 md:text-xs"
          />
        </div>
        {results.length > 0
          ? (
              <ol ref={listRef} className="grid max-h-72 content-start gap-0.5 overflow-y-auto overscroll-contain">
                {results.map(({ track, index }) => (
                  <MusicPlaylistItem
                    key={track.id}
                    track={track}
                    index={index}
                    active={index === currentIndex}
                    playing={index === currentIndex && isPlaying}
                    onSelect={handleSelect}
                    compact
                  />
                ))}
              </ol>
            )
          : <p className="px-2 py-6 text-center text-xs text-white/50">{t(playlist.length > 0 ? 'search_empty' : 'playlist_empty')}</p>}
      </PopoverContent>
    </Popover>
  )
}
