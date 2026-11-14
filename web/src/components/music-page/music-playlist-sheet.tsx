'use client'

import type { MusicTrack } from '@/models/music'
import { AudioLinesIcon, Music2Icon, SearchIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SafeImage } from '@/components/common/safe-image'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { useMusicActions, useMusicPlayback, useMusicPreferences } from '@/contexts/music-context'
import { useCachedSongMetaTranslation } from '@/contexts/song-meta-translations'
import { useIsMobile } from '@/hooks/use-mobile'
import { formatDisplayArtists, formatTitleAliases } from '@/lib/lyrics/song-meta-format'
import { cn } from '@/lib/utils'
import { filterPlaylist } from './playlist-filter'

const INITIAL_CHUNK = 50
const CHUNK_STEP = 50

/** 歌单中的一首歌（深色界面）；compact 为悬浮播放器的小歌单使用的紧凑尺寸 */
export const MusicPlaylistItem = memo(({ track, index, active, playing, onSelect, compact = false }: {
  track: MusicTrack
  index: number
  active: boolean
  playing: boolean
  onSelect: (index: number) => void
  compact?: boolean
}) => {
  const { showTranslation } = useMusicPreferences()
  const meta = useCachedSongMetaTranslation(track.id)
  const titleExtra = formatTitleAliases(track.name, track.aliases, meta?.title, showTranslation)
  const displayArtists = formatDisplayArtists(track.artists, meta?.artists, showTranslation)

  return (
    <li className={cn('[content-visibility:auto]', compact ? '[contain-intrinsic-size:auto_40px]' : '[contain-intrinsic-size:auto_56px]')}>
      <button
        type="button"
        data-index={index}
        aria-current={active || undefined}
        onClick={() => onSelect(index)}
        className={cn(
          'flex w-full items-center text-left transition-colors hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none',
          compact ? 'gap-2.5 rounded-lg px-1.5 py-1.5' : 'gap-3 rounded-xl px-2 py-2',
          active && 'bg-white/10',
        )}
      >
        <span className={cn('relative shrink-0 overflow-hidden bg-white/10', compact ? 'size-9 rounded-md' : 'size-11 rounded-lg')}>
          {track.albumPic
            ? <SafeImage src={track.albumPic} alt="" fill sizes={compact ? '36px' : '44px'} className="object-cover" fallback={null} />
            : <Music2Icon aria-hidden className="absolute inset-0 m-auto size-5 text-white/50" />}
        </span>
        <span className="grid min-w-0 flex-1">
          <span className={cn('truncate font-medium', compact ? 'text-[13px]' : 'text-sm', active ? 'text-white' : 'text-white/85')}>
            {track.name}
            {titleExtra && <span className="ml-1 font-normal text-white/45">{`(${titleExtra})`}</span>}
          </span>
          <span className="truncate text-xs text-white/50">{[displayArtists.join(' / '), track.album].filter(Boolean).join(' · ')}</span>
        </span>
        {active && <AudioLinesIcon aria-hidden className={cn('size-4 shrink-0 text-white/80', playing && 'motion-safe:animate-pulse')} />}
      </button>
    </li>
  )
})

/**
 * 歌单还没取全时的列表区（抽屉与悬浮播放器的小歌单共用）：恢复播放时可能只取了一首，不能把这一首当成整个歌单
 * （先显示「1 首」再突然变成上千首）。补全中显示骨架；补全失败（没在补全又没取全）时说明并可重试
 */
export function PlaylistPendingState({ compact = false }: { compact?: boolean }) {
  const t = useTranslations('MusicPage')
  const { playlistLoading } = useMusicPlayback()
  const { ensurePlaylist } = useMusicActions()
  if (!playlistLoading) {
    return (
      <div className={cn('grid justify-items-center gap-2 text-center text-white/50', compact ? 'px-2 py-6 text-xs' : 'px-4 py-10 text-sm')}>
        <p>{t('failed_title')}</p>
        <button
          type="button"
          onClick={() => void ensurePlaylist()}
          className="rounded-full bg-white/10 px-4 py-1.5 font-medium text-white transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
        >
          {t('retry')}
        </button>
      </div>
    )
  }
  return (
    <div role="status" aria-busy className={cn('grid content-start gap-0.5 overflow-hidden', compact ? 'max-h-72' : 'min-h-0 flex-1 px-2 pb-4')}>
      <span className="sr-only">{t('loading')}</span>
      {Array.from({ length: compact ? 5 : 8 }, (_, i) => (
        <div key={i} aria-hidden className={cn('flex items-center', compact ? 'gap-2.5 px-1.5 py-1.5' : 'gap-3 px-2 py-2')}>
          <Skeleton className={cn('shrink-0 bg-white/10', compact ? 'size-9 rounded-md' : 'size-11 rounded-lg')} />
          <div className="grid flex-1 gap-1.5">
            <Skeleton className="h-3.5 w-3/5 bg-white/10" />
            <Skeleton className="h-3 w-2/5 bg-white/10" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** 歌单面板：桌面端从右侧滑出，移动端从底部滑出；打开时滚动到当前曲目，点击即播放 */
export function MusicPlaylistSheet({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
  const t = useTranslations('MusicPage')
  const { playlist, playlistComplete, currentIndex, isPlaying } = useMusicPlayback()
  const { playTrack, ensurePlaylist } = useMusicActions()
  const isMobile = useIsMobile(1024)
  const [keyword, setKeyword] = useState('')
  const listRef = useRef<HTMLOListElement>(null)
  const results = useMemo(() => filterPlaylist(playlist, keyword), [playlist, keyword])
  const targetResultIndex = useMemo(() => {
    return results.findIndex(item => item.index === currentIndex)
  }, [results, currentIndex])

  // 分批渐进式加载，确保当前播放曲目在初始窗口内
  const [visibleCount, setVisibleCount] = useState(() => Math.max(INITIAL_CHUNK, targetResultIndex + 20))

  useEffect(() => {
    setVisibleCount(prev => Math.max(prev, INITIAL_CHUNK, targetResultIndex + 20))
  }, [targetResultIndex, keyword])

  const handleScroll = useCallback((event: React.UIEvent<HTMLOListElement>) => {
    const target = event.currentTarget
    if (target.scrollTop + target.clientHeight >= target.scrollHeight - 300) {
      setVisibleCount(prev => (prev < results.length ? Math.min(prev + CHUNK_STEP, results.length) : prev))
    }
  }, [results.length])

  const visibleResults = useMemo(() => results.slice(0, visibleCount), [results, visibleCount])

  // 稳定的回调，保证列表项的 memo 生效
  const handleSelect = useCallback((index: number) => {
    playTrack(index)
    onOpenChange(false)
    setKeyword('')
  }, [onOpenChange, playTrack])

  // 打开时补全歌单（上次补全失败时借此重试）
  useEffect(() => {
    if (open)
      void ensurePlaylist()
  }, [open, ensurePlaylist])

  // 打开时滚动到当前曲目（等弹层内容挂载后）
  useEffect(() => {
    if (!open)
      return
    const frame = requestAnimationFrame(() => {
      listRef.current?.querySelector(`[data-index="${currentIndex}"]`)?.scrollIntoView({ block: 'center' })
    })
    return () => cancelAnimationFrame(frame)
  }, [open, currentIndex])

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next)
          setKeyword('')
      }}
    >
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        // 播放器页固定使用深色界面；弹层渲染在 body 下，单独加 dark
        className={cn(
          'dark gap-0 border-white/10 bg-neutral-950/85 text-white backdrop-blur-2xl',
          isMobile ? 'max-h-[85dvh] rounded-t-2xl' : 'w-full sm:max-w-md',
        )}
      >
        <SheetHeader className="gap-3 pb-2">
          {/* 没取全时不显示数量（只有恢复的那一首） */}
          <SheetTitle className="text-white">{playlistComplete ? t('playlist_title', { count: playlist.length }) : t('open_playlist')}</SheetTitle>
          <SheetDescription className="sr-only">{t('playlist_description')}</SheetDescription>
          <div className="relative">
            <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-white/50" />
            <Input
              type="search"
              value={keyword}
              onChange={event => setKeyword(event.target.value)}
              placeholder={t('search_placeholder')}
              aria-label={t('search_placeholder')}
              disabled={!playlistComplete}
              className="border-white/15 bg-white/10 pl-9 text-white placeholder:text-white/40"
            />
          </div>
        </SheetHeader>
        {!playlistComplete
          ? <PlaylistPendingState />
          : results.length > 0
            ? (
                <ol ref={listRef} onScroll={handleScroll} className="grid min-h-0 flex-1 content-start gap-0.5 overflow-y-auto px-2 pb-4 transform-gpu will-change-transform">
                  {visibleResults.map(({ track, index }) => (
                    <MusicPlaylistItem
                      key={track.id}
                      track={track}
                      index={index}
                      active={index === currentIndex}
                      playing={index === currentIndex && isPlaying}
                      onSelect={handleSelect}
                    />
                  ))}
                </ol>
              )
            : <p className="px-4 py-10 text-center text-sm text-white/50">{t(playlist.length > 0 ? 'search_empty' : 'playlist_empty')}</p>}
      </SheetContent>
    </Sheet>
  )
}
