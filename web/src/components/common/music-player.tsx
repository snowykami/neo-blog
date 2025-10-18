'use client'

import type { PlayMode } from '@/contexts/music-context'
import type { MusicTrack } from '@/models/music'
import { useMeasure } from '@uidotdev/usehooks'
import { CircleArrowLeftIcon, CircleArrowRightIcon, ListMusicIcon, PauseIcon, PlayIcon, Repeat1Icon, RepeatIcon, SearchIcon, Shuffle } from 'lucide-react'
import Image from 'next/image'
import React, { useEffect, useRef, useState } from 'react'
import Marquee from 'react-fast-marquee'
import { fetchPlaylist } from '@/api/music'
import { ProgressControl } from '@/components/common/controlled-progress'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useDevice } from '@/contexts/device-context'
import { useMusic } from '@/contexts/music-context'
import { useNav } from '@/contexts/nav-context'
import { useStoredState } from '@/hooks/use-storage-state'
import { cn } from '@/lib/utils'
import { formatDurationMMSS } from '@/utils/common/datetime'
import { Input } from '../ui/input'

const BUTTON_ANIMATION_CLASSNAME = 'hover:scale-115 transition-transform duration-400'

export function MusicPlayer() {
  const {
    currentTrack,
    replacePlaylist,
    sampleTrack,
    rotateDeg,
    currentIndex,
    setCurrentIndex,
    currentTime: ctxCurrentTime,
    seek,
    playlist,
    duration,
    currentLyric,
    isPlaying,
  } = useMusic()
  const { setNavTitle } = useNav()
  const [storedIndex, setStoredIndex, isStoredIndexLoaded] = useStoredState<number | null>('music-current-index', null)
  const [storedTime, setStoredTime, isStoredTimeLoaded] = useStoredState<number | null>('music-current-time', null)

  // 确保只把存储的时间 seek 一次（避免被 audio 的 timeupdate 干扰多次）
  const appliedStoredTimeRef = useRef(false)
  // 节流写入存储，避免频繁 localStorage 写入
  const lastSavedTimeRef = useRef(0)

  useEffect(() => {
    setNavTitle(isPlaying ? `${currentLyric}` : '')
  }, [currentLyric, setNavTitle, isPlaying])

  useEffect(() => {
    fetchPlaylist().then((playlist) => {
      replacePlaylist(playlist)
    }).catch((error) => {
      replacePlaylist([
        sampleTrack,
      ])
      console.error('Failed to fetch playlist:', error)
    })
  }, [])

  // 等待 playlist 加载并且本地索引就绪后再应用（只应用一次，避免被后续 replacePlaylist 覆盖）
  const appliedStoredIndexRef = useRef(false)
  useEffect(() => {
    if (appliedStoredIndexRef.current)
      return
    if (!isStoredIndexLoaded)
      return
    if (storedIndex == null)
      return
    if (!playlist || playlist.length === 0)
      return

    // clamp 到合法范围再应用
    const idx = Math.max(0, Math.min(storedIndex, playlist.length - 1))
    setCurrentIndex(idx)
    appliedStoredIndexRef.current = true
  }, [isStoredIndexLoaded, storedIndex, playlist?.length, setCurrentIndex])

  // 当存储的播放时间加载完成时，seek 到该时间（只执行一次）
  useEffect(() => {
    // guard conditions
    if (
      !isStoredTimeLoaded
      || storedTime == null
      || appliedStoredTimeRef.current
      || !playlist
      || playlist.length === 0
      || !currentTrack
      || typeof duration !== 'number'
      || !Number.isFinite(duration)
      || duration <= 0
    ) {
      return
    }

    if (typeof storedTime === 'number' && Number.isFinite(storedTime)) {
      const t = Math.max(0, Math.min(storedTime, duration))
      try {
        seek(t)
        appliedStoredTimeRef.current = true
      }
      catch (e) {
        // 如果 seek 失败（浏览器限制），不要立即放弃：下次 duration/currentTrack 更新时再试
        console.warn('seek failed when applying storedTime, will retry later', e)
      }
    }
    // 重新尝试的依赖项包含 duration / playlist length / currentTrack，保证在元数据就绪后重试
  }, [isStoredTimeLoaded, storedTime, playlist?.length, currentTrack?.id, duration, seek])

  // 自动保存 currentIndex 到 storage
  useEffect(() => {
    if (typeof currentIndex === 'number') {
      setStoredIndex(currentIndex)
    }
  }, [currentIndex, setStoredIndex])

  // 定期保存currentTime 到 storage
  useEffect(() => {
    // 不要在尚未把已保存时间应用（restore）之前覆盖本地值
    if (!appliedStoredTimeRef.current)
      return
    if (ctxCurrentTime == null || !Number.isFinite(ctxCurrentTime))
      return
    const now = Date.now()
    if (now - lastSavedTimeRef.current < 1000)
      return
    try {
      setStoredTime(Math.floor(ctxCurrentTime))
      lastSavedTimeRef.current = now
    }
    catch { }
  }, [ctxCurrentTime, setStoredTime])

  if (!currentTrack) {
    return null
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <div
          className="fixed right-4 bottom-4 z-50 rounded-full shadow-lg
        flex items-center justify-center cursor-pointer
        hover:scale-105 transition-all duration-800"
        >
          <Image
            src={currentTrack.albumPic}
            alt={currentTrack.album}
            width={60}
            height={60}
            style={{ transform: `rotate(${rotateDeg}deg)` }}
            className="object-cover rounded-full border-4 border-gray-200 dark:border-slate-700 h-12 w-12 lg:h-16 lg:w-16"
          />
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="fixed -right-8 bottom-0 w-80 p-3 z-1000 rounded-xl shadow-lg
       bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm border
        border-gray-200 dark:border-slate-700 overflow-hidden "
        style={{ pointerEvents: 'auto' }}
      >
        <div
          aria-label="Floating music player"
          role="region"
          className="flex flex-col gap-2"
        >
          <TrackInfo />
          {/* <LyricScroll /> */}
          <PlayerControls />
        </div>
      </PopoverContent>
    </Popover>
  )
}

function TrackInfo() {
  const { currentTrack, rotateDeg, isPlaying, currentIndex } = useMusic()
  const { mode } = useDevice()
  if (!currentTrack) {
    return null
  }

  // 使用 useMeasure 测量容器与纯文本内容宽度
  const [nameContainerRef, { width: nameContainerWidth }] = useMeasure()
  const [nameContentRef, { width: nameContentWidth }] = useMeasure()
  const [artistContainerRef, { width: artistContainerWidth }] = useMeasure()
  const [artistContentRef, { width: artistContentWidth }] = useMeasure()

  const [isNameMarqueePlaying, setIsNameMarqueePlaying] = useState(false)
  const [isArtistMarqueePlaying, setIsArtistMarqueePlaying] = useState(false)

  useEffect(() => {
    const needName = (nameContentWidth ?? 0) > (nameContainerWidth ?? 0)
    const needArtist = (artistContentWidth ?? 0) > (artistContainerWidth ?? 0)
    setIsNameMarqueePlaying(Boolean(needName && isPlaying))
    setIsArtistMarqueePlaying(Boolean(needArtist && isPlaying))
  }, [nameContentWidth, nameContainerWidth, artistContentWidth, artistContainerWidth, isPlaying, currentTrack?.name, currentTrack?.artists, currentTrack?.album])

  return (
    <div className="flex relative">
      <Image
        src={currentTrack.albumPic}
        alt={currentTrack.album}
        width={60}
        height={60}
        style={{ transform: `rotate(${rotateDeg}deg)` }}
        className="object-cover rounded-full border-2 border-gray-200 dark:border-slate-700"
      />
      <div className="flex flex-col justify-center px-4 gap-2 font-mono min-w-0">
        <div ref={nameContainerRef as any} className="text-lg font-medium text-gray-900 dark:text-gray-100 overflow-hidden min-w-0">
          <div style={{ display: 'block', width: '100%' }}>
            <Marquee
              key={currentIndex}
              speed={30}
              pauseOnHover={true}
              gradient={isNameMarqueePlaying}
              gradientWidth={10}
              gradientColor={mode === 'dark' ? '' : 'white'}
              play={isNameMarqueePlaying}
            >
              {currentTrack.name}
            </Marquee>
          </div>
        </div>

        <div ref={artistContainerRef as any} className="text-xs text-gray-600 dark:text-gray-400 overflow-hidden min-w-0">
          <div style={{ display: 'block', width: '100%' }}>
            <Marquee
              key={currentIndex}
              speed={30}
              pauseOnHover={true}
              gradient={isArtistMarqueePlaying}
              gradientWidth={10}
              gradientColor={mode === 'dark' ? '' : 'white'}
              play={isArtistMarqueePlaying}
            >
              {currentTrack.artists.join('/')}
              {' '}
              -
              {' '}
              {currentTrack.album}
            </Marquee>
          </div>
        </div>

        {/* 隐藏测量元素：只包含纯文本，用于精确测量文本宽度（与展示样式保持相同字体/字号） */}
        <div aria-hidden style={{ position: 'absolute', visibility: 'hidden', whiteSpace: 'nowrap', pointerEvents: 'none', height: 0, overflow: 'visible' }}>
          <span ref={nameContentRef as any} style={{ display: 'inline-block', whiteSpace: 'nowrap' }}>
            {currentTrack.name}
          </span>
          <span ref={artistContentRef as any} style={{ display: 'inline-block', whiteSpace: 'nowrap', marginLeft: 8 }}>
            {currentTrack.artists.join('/')}
            {' '}
            -
            {currentTrack.album}
          </span>
        </div>
      </div>
    </div>
  )
}

// Memoized individual playlist item component
const PlaylistItem = React.memo(({ track, origIndex, currentIndex, onClick }: {
  track: MusicTrack
  origIndex: number
  currentIndex: number | null
  onClick: () => void
}) => {
  return (
    <div
      data-index={origIndex}
      onClick={onClick}
      className={cn(
        'p-2 border-b last:border-b-0 flex items-center gap-2 cursor-pointer',
        origIndex === currentIndex ? 'bg-slate-100 dark:bg-slate-700' : '',
      )}
    >
      <Image
        src={track.albumPic}
        alt={track.album}
        width={40}
        height={40}
        className="object-cover rounded-full border-2 border-gray-200 dark:border-slate-700 h-10 w-10"
        loading="lazy"
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate overflow-hidden whitespace-nowrap">
          {track.name}
        </div>
        <div className="text-xs text-gray-600 dark:text-gray-400 truncate overflow-hidden whitespace-nowrap">
          {track.artists.join('/')}
          {' '}
          -
          {track.album}
        </div>
      </div>
    </div>
  )
})
PlaylistItem.displayName = 'PlaylistItem'

const Playlist = React.memo(() => {
  const { playlist, playTrack, currentIndex } = useMusic()
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = React.useState(false)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [showSearch, setShowSearch] = useState(false)

  const handleChangeTrack = React.useCallback((index: number) => () => {
    playTrack(index)
    setOpen(false)
  }, [playTrack])

  // filteredPlaylist 保留原始索引
  const filteredPlaylist = React.useMemo(() => {
    const tokens = searchKeyword
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(t => t.toLowerCase())

    // 把每项变成 { track, origIndex }
    const all = playlist.map((track, idx) => ({ track, origIndex: idx }))
    if (tokens.length === 0)
      return all

    return all.filter(({ track }) => {
      const hay = [track.name, track.album, ...(track.artists || [])].join(' ').toLowerCase()
      return tokens.every(tok => hay.includes(tok))
    })
  }, [playlist, searchKeyword])

  // 打开时滚动到当前项：延迟重试以确保内容已渲染（适配 portal / 图片加载等延迟）
  useEffect(() => {
    if (!open) {
      // 关闭时重置搜索状态
      setShowSearch(false)
      setSearchKeyword('')
      return
    }
    let cancelled = false

    const tryScroll = (attempt = 0) => {
      if (cancelled)
        return
      const c = containerRef.current
      if (!c) {
        if (attempt < 6)
          requestAnimationFrame(() => tryScroll(attempt + 1))
        return
      }
      const el = c.querySelector<HTMLElement>(`[data-index="${currentIndex}"]`)
      if (el) {
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' })
        return
      }
      if (attempt < 6) {
        const delay = attempt === 0 ? 0 : 50
        setTimeout(() => requestAnimationFrame(() => tryScroll(attempt + 1)), delay)
      }
    }

    tryScroll()
    return () => {
      cancelled = true
    }
  }, [open, currentIndex, playlist.length])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ListMusicIcon className={cn('w-6 h-6', BUTTON_ANIMATION_CLASSNAME)} />
      </PopoverTrigger>

      <PopoverContent className="fixed -right-16 bottom-4 z-1001 p-1">
        {showSearch
          ? (
              <div className="flex gap-1 border-b border-gray-200 dark:border-slate-700 pb-1">
                <Input
                  type="text"
                  placeholder="Search..."
                  className="flex-1"
                  value={searchKeyword}
                  onChange={e => setSearchKeyword((e.target as HTMLInputElement).value)}
                  autoFocus={true}
                />
                <button
                  type="button"
                  onClick={() => {
                    setShowSearch(false)
                    setSearchKeyword('')
                  }}
                  className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded"
                  aria-label="Close search"
                >
                  ✕
                </button>
              </div>
            )
          : (
              <div className="flex justify-end pb-1">
                <button
                  type="button"
                  onClick={() => setShowSearch(true)}
                  className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded"
                  aria-label="Open search"
                >
                  <SearchIcon className="w-4 h-4" />
                </button>
              </div>
            )}
        <div ref={containerRef} className="max-h-80 overflow-y-auto">
          {playlist.length > 0
            ? (
                filteredPlaylist.length > 0
                  ? filteredPlaylist.map(({ track, origIndex }) => (
                      <PlaylistItem
                        key={track.id}
                        track={track}
                        origIndex={origIndex}
                        currentIndex={currentIndex}
                        onClick={handleChangeTrack(origIndex)}
                      />
                    ))
                  : <div className="p-2 text-sm text-gray-500">No matching tracks</div>
              )
            : <div className="p-2">No tracks available</div>}
        </div>
      </PopoverContent>
    </Popover>
  )
})
Playlist.displayName = 'Playlist'

function PlayerControls() {
  const { currentTrack, currentTime, duration, isPlaying, play, pause, next, prev, seek } = useMusic()
  const [dragPercent, setDragPercent] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const valuePercent = dragPercent != null
    ? dragPercent
    : (duration ? (currentTime || 0) / duration * 100 : 0)

  const handleChange = (v: number) => {
    setDragPercent(v)
  }

  const handleChangeEnd = (v: number) => {
    setDragPercent(null)
    if (duration && Number.isFinite(duration)) {
      const seconds = v / 100 * duration
      seek(seconds)
    }
  }

  if (!currentTrack) {
    return null
  }

  return (
    <div className="">
      <div className="flex justify-between">
        <div className="text-xs text-gray-500 dark:text-gray-400 py-1">
          {currentTime
            ? (isDragging ? formatDurationMMSS(Math.floor((dragPercent || 0) / 100 * (duration || 1))) : formatDurationMMSS(Math.floor(currentTime)))
            : '00:00'}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {duration ? formatDurationMMSS(Math.floor(duration)) : '00:00'}
        </div>
      </div>
      <ProgressControl
        value={valuePercent}
        onChange={handleChange}
        onChangeEnd={handleChangeEnd}
        onIsDraggingChange={setIsDragging}
      />
      <div className="flex items-center justify-center mt-2 gap-4 text-slate-500 ">
        <PlayModeButton />
        <CircleArrowLeftIcon className={cn('w-6 h-6', BUTTON_ANIMATION_CLASSNAME)} onClick={prev} />
        {isPlaying
          ? (
              <PauseIcon
                className={cn('w-8 h-8 cursor-pointer', BUTTON_ANIMATION_CLASSNAME)}
                onClick={pause}
              />
            )
          : (
              <PlayIcon
                className={cn('w-8 h-8 cursor-pointer', BUTTON_ANIMATION_CLASSNAME)}
                onClick={play}
              />
            )}
        <CircleArrowRightIcon className={cn('w-6 h-6', BUTTON_ANIMATION_CLASSNAME)} onClick={next} />
        <Playlist />
      </div>
    </div>
  )
}

function PlayModeButton() {
  const [storedPlayMode, setStoredPlayMode, isStoredPlayModeLoaded] = useStoredState<PlayMode>('music-play-mode', 'repeat-all')
  const { playMode, setPlayMode } = useMusic()

  // 确保在存储加载完成并且值存在时同步到 context
  useEffect(() => {
    if (!isStoredPlayModeLoaded)
      return
    if (storedPlayMode == null)
      return
    setPlayMode(storedPlayMode)
  }, [isStoredPlayModeLoaded, storedPlayMode, setPlayMode])

  const icons: Record<PlayMode, React.ReactNode> = {
    'repeat-all': <RepeatIcon className={cn('w-6 h-6', BUTTON_ANIMATION_CLASSNAME)} />,
    'repeat-one': <Repeat1Icon className={cn('w-6 h-6', BUTTON_ANIMATION_CLASSNAME)} />,
    'shuffle': <Shuffle className={cn('w-6 h-6', BUTTON_ANIMATION_CLASSNAME)} />,
  }

  const handleClick = () => {
    const nextMode: PlayMode = playMode === 'repeat-all'
      ? 'repeat-one'
      : playMode === 'repeat-one'
        ? 'shuffle'
        : 'repeat-all'
    setPlayMode(nextMode)
    setStoredPlayMode(nextMode)
  }

  return (
    <button
      type="button"
      aria-label="切换播放模式"
      onClick={handleClick}
      className="p-1"
    >
      {icons[playMode ?? 'repeat-all']}
    </button>
  )
}
