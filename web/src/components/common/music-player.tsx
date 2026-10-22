'use client'

import type { PlayMode } from '@/contexts/music-context'
import type { MusicTrack } from '@/models/music'
import type { LyricMarqueeWordBox, MusicLyricLine, MusicLyricMode } from '@/utils/music-lyric'
import { useMeasure } from '@uidotdev/usehooks'
import { CaseSensitiveIcon, CircleArrowLeftIcon, CircleArrowRightIcon, CirclePauseIcon, CirclePlayIcon, LanguagesIcon, ListMusicIcon, MessageSquareOffIcon, MusicIcon, Repeat1Icon, RepeatIcon, SearchIcon, Shuffle, Volume2Icon, VolumeXIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Marquee from 'react-fast-marquee'
import { fetchPlaylist } from '@/api/music'
import { ProgressControl } from '@/components/common/controlled-progress'
import { SafeImage } from '@/components/common/safe-image'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useMusic } from '@/contexts/music-context'
import { useNav } from '@/contexts/nav-context'
import { useStoredState } from '@/hooks/use-storage-state'
import { cn } from '@/lib/utils'
import { formatDurationMMSS } from '@/utils/common/datetime'
import { getCurrentLyricIndex, getLyricMarqueeOffset, getWordProgress, isWordTimedLyricLine } from '@/utils/music-lyric'
import { Input } from '../ui/input'
import LyricScroll from './music-lyric-scroll'

const BUTTON_ANIMATION_CLASSNAME = 'hover:scale-115 transition-[color,transform] duration-150 hover:text-primary'
const DEFAULT_MUSIC_THEME_RGB = '59 130 246'
const ALBUM_TRANSITION_DURATION_MS = 500

function normalizeThemeColor(r: number, g: number, b: number) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const contrast = max - min
  const lift = max < 80 ? 48 : 0
  const saturationBoost = contrast < 35 ? 1.35 : 1

  const normalizeChannel = (channel: number) => {
    const centered = channel - min
    return Math.round(Math.max(42, Math.min(232, channel + lift + centered * (saturationBoost - 1))))
  }

  return `${normalizeChannel(r)} ${normalizeChannel(g)} ${normalizeChannel(b)}`
}

function getThemeSampleImageSrc(src: string) {
  try {
    const url = new URL(src, window.location.href)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return `/_next/image?url=${encodeURIComponent(url.href)}&w=64&q=75`
    }
  }
  catch { }

  return src
}

function useAlbumThemeColor(src?: string) {
  const [themeColor, setThemeColor] = useState(DEFAULT_MUSIC_THEME_RGB)

  useEffect(() => {
    if (!src) {
      setThemeColor(DEFAULT_MUSIC_THEME_RGB)
      return
    }

    let cancelled = false
    const image = new window.Image()
    image.crossOrigin = 'anonymous'
    image.decoding = 'async'

    image.onload = () => {
      if (cancelled)
        return

      try {
        const canvas = document.createElement('canvas')
        const size = 24
        canvas.width = size
        canvas.height = size
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context)
          return

        context.drawImage(image, 0, 0, size, size)
        const data = context.getImageData(0, 0, size, size).data
        let r = 0
        let g = 0
        let b = 0
        let weightSum = 0

        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3] / 255
          if (alpha < 0.4)
            continue

          const red = data[i]
          const green = data[i + 1]
          const blue = data[i + 2]
          const max = Math.max(red, green, blue)
          const min = Math.min(red, green, blue)
          const saturation = max === 0 ? 0 : (max - min) / max
          const brightness = (red + green + blue) / 3
          const weight = alpha * (0.65 + saturation) * (brightness > 245 || brightness < 18 ? 0.25 : 1)

          r += red * weight
          g += green * weight
          b += blue * weight
          weightSum += weight
        }

        if (weightSum > 0) {
          setThemeColor(normalizeThemeColor(r / weightSum, g / weightSum, b / weightSum))
        }
      }
      catch {
        setThemeColor(DEFAULT_MUSIC_THEME_RGB)
      }
    }

    image.onerror = () => {
      if (!cancelled)
        setThemeColor(DEFAULT_MUSIC_THEME_RGB)
    }
    image.src = getThemeSampleImageSrc(src)

    return () => {
      cancelled = true
    }
  }, [src])

  return themeColor
}

function parseThemeColor(themeColor: string) {
  const [r, g, b] = themeColor.split(/\s+/).map(value => Number.parseFloat(value))
  if ([r, g, b].every(value => Number.isFinite(value))) {
    return [r, g, b] as const
  }

  return [59, 130, 246] as const
}

function useAnimatedThemeColor(targetThemeColor: string) {
  const [animatedThemeColor, setAnimatedThemeColor] = useState(targetThemeColor)
  const currentColorRef = useRef(parseThemeColor(targetThemeColor))

  useEffect(() => {
    const from = currentColorRef.current
    const to = parseThemeColor(targetThemeColor)

    if (from.every((channel, index) => channel === to[index])) {
      setAnimatedThemeColor(targetThemeColor)
      return
    }

    let rafId = 0
    let startTime = 0

    const tick = (time: number) => {
      if (!startTime)
        startTime = time

      const progress = Math.min(1, (time - startTime) / ALBUM_TRANSITION_DURATION_MS)
      const easedProgress = 1 - (1 - progress) ** 3
      const nextColor = from.map((channel, index) =>
        Math.round(channel + (to[index] - channel) * easedProgress),
      ) as [number, number, number]

      currentColorRef.current = nextColor
      setAnimatedThemeColor(nextColor.join(' '))

      if (progress < 1) {
        rafId = requestAnimationFrame(tick)
      }
      else {
        currentColorRef.current = to
        setAnimatedThemeColor(targetThemeColor)
      }
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [targetThemeColor])

  return animatedThemeColor
}

function CrossfadeAlbumImage({
  alt,
  className,
  imageClassName,
  priority,
  sizes,
  src,
  style,
}: {
  alt: string
  className?: string
  imageClassName?: string
  priority?: boolean
  sizes?: string
  src: string
  style?: React.CSSProperties
}) {
  const [visibleSrc, setVisibleSrc] = useState(src)
  const [previousSrc, setPreviousSrc] = useState<string | null>(null)
  const [isIncomingVisible, setIsIncomingVisible] = useState(true)
  const [isPreviousHidden, setIsPreviousHidden] = useState(false)
  const visibleSrcRef = useRef(src)

  useEffect(() => {
    if (src === visibleSrcRef.current)
      return

    setPreviousSrc(visibleSrcRef.current)
    visibleSrcRef.current = src
    setVisibleSrc(src)
    setIsIncomingVisible(false)
    setIsPreviousHidden(false)

    const rafId = requestAnimationFrame(() => {
      setIsIncomingVisible(true)
      setIsPreviousHidden(true)
    })
    const timeoutId = window.setTimeout(() => {
      setPreviousSrc(null)
      setIsPreviousHidden(false)
    }, ALBUM_TRANSITION_DURATION_MS)

    return () => {
      cancelAnimationFrame(rafId)
      window.clearTimeout(timeoutId)
    }
  }, [src])

  return (
    <div className={cn('relative overflow-hidden', className)} style={style}>
      {previousSrc && (
        <SafeImage
          key={previousSrc}
          src={previousSrc}
          alt=""
          fill
          // 淡出中的旧封面失效时直接不显示
          fallback={null}
          sizes={sizes}
          className={cn(
            imageClassName,
            'transition-opacity duration-500 ease-out',
            isPreviousHidden ? 'opacity-0' : 'opacity-100',
          )}
        />
      )}
      <SafeImage
        key={visibleSrc}
        src={visibleSrc}
        alt={alt}
        fill
        priority={priority}
        sizes={sizes}
        className={cn(
          imageClassName,
          'transition-opacity duration-500 ease-out',
          isIncomingVisible ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  )
}

// 本地存储键：当前曲目索引、曲目 id 与播放进度（秒）
const STORAGE_KEY_INDEX = 'music-current-index'
const STORAGE_KEY_TRACK_ID = 'music-current-track-id'
const STORAGE_KEY_TIME = 'music-current-time'
const STORAGE_KEY_PLAY_MODE = 'music-play-mode'
const PLAY_MODES: PlayMode[] = ['repeat-all', 'repeat-one', 'shuffle']
// 专辑封面旋转一圈的时长，使用 CSS 动画代替逐帧 setState
const ALBUM_ROTATE_CLASSNAME = 'animate-spin [animation-duration:30s]'

function readStoredNumber(key: string): number | null {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null)
      return null
    const value = Number(JSON.parse(raw))
    return Number.isFinite(value) ? value : null
  }
  catch {
    return null
  }
}

function writeStoredNumber(key: string, value: number) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  }
  catch { }
}

/**
 * 根据本地存储计算刷新后应恢复的曲目索引与进度：
 * 优先按曲目 id 定位（歌单顺序变化也不会错位）；存储的曲目已不在歌单中时从头开始且不恢复进度；
 * 兼容只存了索引的旧数据
 */
function getRestoredPlayback(tracks: MusicTrack[]): { index: number, time?: number } {
  if (tracks.length === 0)
    return { index: 0 }
  const storedTrackId = readStoredNumber(STORAGE_KEY_TRACK_ID)
  const storedIndex = readStoredNumber(STORAGE_KEY_INDEX)
  const storedTime = readStoredNumber(STORAGE_KEY_TIME) ?? undefined

  if (storedTrackId != null) {
    const index = tracks.findIndex(track => track.id === storedTrackId)
    return index >= 0 ? { index, time: storedTime } : { index: 0 }
  }
  if (storedIndex != null)
    return { index: Math.max(0, Math.min(Math.floor(storedIndex), tracks.length - 1)), time: storedTime }
  return { index: 0 }
}

const reducedMotionQuery = '(prefers-reduced-motion: reduce)'

function subscribeReducedMotion(callback: () => void) {
  const media = window.matchMedia(reducedMotionQuery)
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(reducedMotionQuery).matches,
    () => false,
  )
}

export function MusicPlayer({ playlistUrl }: { playlistUrl: string }) {
  const t = useTranslations('MusicPlayer')
  const {
    currentTrack,
    replacePlaylist,
    sampleTrack,
    currentIndex,
    currentTime: ctxCurrentTime,
    duration,
    isPlaying,
    setPlayMode,
  } = useMusic()
  const { setNavTitle, setNavIcon, resetNavIcon } = useNav()
  const themeColor = useAlbumThemeColor(currentTrack?.albumPic)
  const animatedThemeColor = useAnimatedThemeColor(themeColor)
  const [storedPlayMode, , isStoredPlayModeLoaded] = useStoredState<PlayMode>(STORAGE_KEY_PLAY_MODE, 'repeat-all')
  const themeStyle = { '--music-theme': animatedThemeColor } as React.CSSProperties

  // 歌单加载并完成进度恢复后才允许写回存储，避免初始化阶段覆盖已保存的值
  const restoredRef = useRef(false)
  // 刷新后恢复的曲目 id：首次切到该曲目时不清零已保存的进度
  const restoredTrackIdRef = useRef<number | null>(null)
  // 节流写入存储，避免频繁 localStorage 写入
  const lastSavedTimeRef = useRef(0)

  useEffect(() => {
    setNavTitle(isPlaying
      ? <NavLyricTitle />
      : '')
    if (isPlaying) {
      setNavIcon(
        <MusicIcon
          className="size-6!"
        />,
      )
    }
    else {
      resetNavIcon()
    }
  }, [isPlaying, resetNavIcon, setNavIcon, setNavTitle])

  // 播放模式在播放器挂载时恢复（而不是等播放器弹层打开）
  useEffect(() => {
    if (!isStoredPlayModeLoaded)
      return
    if (PLAY_MODES.includes(storedPlayMode))
      setPlayMode(storedPlayMode)
  }, [isStoredPlayModeLoaded, storedPlayMode, setPlayMode])

  // 拉取歌单后一次性以“存储的曲目 + 进度”初始化，不再先切到第 0 首再切回，避免多余的歌词请求与竞态
  useEffect(() => {
    let cancelled = false
    fetchPlaylist(playlistUrl).then((playlist) => {
      if (cancelled)
        return
      const { index, time } = getRestoredPlayback(playlist)
      restoredTrackIdRef.current = playlist[index]?.id ?? null
      replacePlaylist(playlist, index, time)
      restoredRef.current = true
    }).catch((error) => {
      if (cancelled)
        return
      // 拉取失败时使用示例曲目兜底，但不开启存储写回，避免覆盖用户已保存的曲目与进度
      replacePlaylist([
        sampleTrack,
      ])
      console.error('Failed to fetch playlist:', error)
    })
    return () => {
      cancelled = true
    }
    // sampleTrack 每次渲染都会重新创建，不放入依赖，只在歌单地址变化时重新拉取
  }, [playlistUrl, replacePlaylist])

  // 曲目变化时保存索引与曲目 id；切到新曲目时进度清零，保证进度始终属于已保存的曲目
  const currentTrackId = currentTrack?.id ?? null
  useEffect(() => {
    if (!restoredRef.current || currentTrackId == null || currentIndex == null)
      return
    writeStoredNumber(STORAGE_KEY_INDEX, currentIndex)
    writeStoredNumber(STORAGE_KEY_TRACK_ID, currentTrackId)
    if (restoredTrackIdRef.current === currentTrackId)
      return
    restoredTrackIdRef.current = null
    writeStoredNumber(STORAGE_KEY_TIME, 0)
    lastSavedTimeRef.current = 0
  }, [currentIndex, currentTrackId])

  // 定期保存 currentTime 到 storage；元数据就绪前（duration 为空）进度尚未恢复，不写入
  useEffect(() => {
    if (!restoredRef.current || currentTrackId == null || duration == null)
      return
    if (ctxCurrentTime == null || !Number.isFinite(ctxCurrentTime))
      return
    const now = Date.now()
    if (now - lastSavedTimeRef.current < 1000)
      return
    writeStoredNumber(STORAGE_KEY_TIME, Math.floor(ctxCurrentTime))
    writeStoredNumber(STORAGE_KEY_TRACK_ID, currentTrackId)
    lastSavedTimeRef.current = now
  }, [ctxCurrentTime, currentTrackId, duration])

  if (!currentTrack) {
    return null
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('floating_player')}
          className="fixed right-4 bottom-4 z-50 flex cursor-pointer items-center justify-center rounded-full shadow-lg transition-transform duration-300 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CrossfadeAlbumImage
            src={currentTrack.albumPic}
            alt={currentTrack.album}
            priority
            sizes="(min-width: 1024px) 64px, 48px"
            style={{ animationPlayState: isPlaying ? 'running' : 'paused' }}
            className={cn('rounded-full h-12 w-12 lg:h-16 lg:w-16', ALBUM_ROTATE_CLASSNAME)}
            imageClassName="object-cover rounded-full border-4 border-card"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="fixed -right-8 bottom-0 z-1000 w-80 overflow-hidden rounded-xl border bg-popover p-3 shadow-lg"
        style={{ ...themeStyle, pointerEvents: 'auto' }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: 'linear-gradient(135deg, rgb(var(--music-theme) / 0.24), rgb(var(--music-theme) / 0.08) 52%, transparent)',
          }}
        />
        <div
          aria-label={t('floating_player')}
          role="region"
          className="relative flex flex-col gap-2"
        >
          <TrackInfo />
          <LyricScroll />
          <PlayerControls />
        </div>
      </PopoverContent>
    </Popover>
  )
}

// 导航栏歌词两侧渐隐遮罩：仅在内容溢出时启用，滚动到头/尾时去掉对应一侧
const NAV_LYRIC_FADE = '1.25em'
function getNavLyricMask(fadeStart: boolean, fadeEnd: boolean) {
  if (!fadeStart && !fadeEnd)
    return ''
  return `linear-gradient(to right, ${fadeStart ? 'transparent' : 'black'}, black ${NAV_LYRIC_FADE}, black calc(100% - ${NAV_LYRIC_FADE}), ${fadeEnd ? 'transparent' : 'black'})`
}

interface NavLyricLayout {
  lineKey: string
  containerWidth: number
  contentWidth: number
  wordBoxes: LyricMarqueeWordBox[]
  fills: HTMLElement[]
}

/**
 * 导航栏歌词：当前行超出容器宽度时水平滚动
 * - 逐行歌词：先停留约 10%，再匀速滚动，在约 88% 行时长处露出结尾
 * - 逐字歌词：跟随当前演唱位置滚动，使其保持在可视区域约 65% 处
 * 偏移量、逐字高亮均在 requestAnimationFrame 中直接写 DOM，不触发逐帧 React 渲染
 */
function NavLyricTitle() {
  const t = useTranslations('MusicPlayer')
  const { parsedLyricLines, lyricLines, currentLyricIndex, getAudio } = useMusic()
  const prefersReducedMotion = usePrefersReducedMotion()
  const containerRef = useRef<HTMLSpanElement>(null)
  const contentRef = useRef<HTMLSpanElement>(null)
  const layoutRef = useRef<NavLyricLayout | null>(null)
  // rAF 中计算出的行索引，与所属歌词数组绑定，避免切歌后沿用旧索引
  const [rafActive, setRafActive] = useState<{ lines: MusicLyricLine[], index: number | null } | null>(null)
  const activeLyricIndex = rafActive?.lines === parsedLyricLines ? rafActive.index : currentLyricIndex
  const line = activeLyricIndex == null ? undefined : parsedLyricLines[activeLyricIndex]
  const text = activeLyricIndex == null ? '' : lyricLines[activeLyricIndex]?.text
  const isWordLyric = Boolean(line && isWordTimedLyricLine(line))
  const lineKey = line ? `${activeLyricIndex}-${line.startTime}` : ''

  // 容器或内容尺寸变化（窗口缩放、字体加载）时使布局缓存失效，下一帧重新测量
  useEffect(() => {
    const container = containerRef.current
    const content = contentRef.current
    if (!container || !content || typeof ResizeObserver === 'undefined')
      return
    const observer = new ResizeObserver(() => {
      layoutRef.current = null
    })
    observer.observe(container)
    observer.observe(content)
    return () => observer.disconnect()
  }, [lineKey])

  useEffect(() => {
    if (parsedLyricLines.length === 0)
      return
    let rafId = 0
    let lastIndex: number | null | undefined
    let lastTransform = ''
    let lastMask: string | null = null
    const fillProgress = new WeakMap<HTMLElement, number>()

    const measure = (content: HTMLElement, container: HTMLElement, key: string): NavLyricLayout => {
      const words = Array.from(content.querySelectorAll<HTMLElement>('[data-word-index]'))
      return {
        lineKey: key,
        containerWidth: container.clientWidth,
        contentWidth: content.scrollWidth,
        // offsetLeft 不受 transform 影响，内容元素为 relative 定位，作为各字的 offsetParent
        wordBoxes: words.map(word => ({ left: word.offsetLeft, width: word.offsetWidth })),
        fills: words.map(word => word.querySelector<HTMLElement>('[data-word-fill]')).filter((fill): fill is HTMLElement => Boolean(fill)),
      }
    }

    const tick = () => {
      rafId = requestAnimationFrame(tick)
      const audio = getAudio()
      if (!audio)
        return
      const timeMs = audio.currentTime * 1000
      const index = getCurrentLyricIndex(parsedLyricLines, timeMs, null)
      if (index !== lastIndex) {
        lastIndex = index
        setRafActive({ lines: parsedLyricLines, index })
      }

      const container = containerRef.current
      const content = contentRef.current
      const current = index == null ? undefined : parsedLyricLines[index]
      if (!container || !content || !current)
        return
      // React 尚未渲染出新行时跳过，避免把旧行的测量结果用于新行
      const key = `${index}-${current.startTime}`
      if (content.dataset.lineKey !== key)
        return

      let layout = layoutRef.current
      if (!layout || layout.lineKey !== key) {
        layout = measure(content, container, key)
        layoutRef.current = layout
        lastTransform = ''
        lastMask = null
      }

      // 逐字高亮
      if (isWordTimedLyricLine(current)) {
        current.items.forEach((item, wordIndex) => {
          const fill = layout.fills[wordIndex]
          if (!fill)
            return
          const progress = getWordProgress(item, timeMs)
          if (fillProgress.get(fill) === progress)
            return
          fillProgress.set(fill, progress)
          fill.style.clipPath = `inset(0 ${(1 - progress) * 100}% 0 0)`
        })
      }

      // 减少动态效果时不滚动，仅显示开头并以省略号截断
      if (prefersReducedMotion)
        return

      const overflow = layout.contentWidth - layout.containerWidth
      const offset = getLyricMarqueeOffset({
        line: current,
        nextLineStartTime: index == null ? undefined : parsedLyricLines[index + 1]?.startTime,
        currentTimeMs: timeMs,
        containerWidth: layout.containerWidth,
        contentWidth: layout.contentWidth,
        wordBoxes: isWordTimedLyricLine(current) ? layout.wordBoxes : undefined,
      })
      const transform = offset > 0 ? `translate3d(${-offset.toFixed(2)}px, 0, 0)` : ''
      if (transform !== lastTransform) {
        lastTransform = transform
        content.style.transform = transform
      }
      const mask = overflow > 0 ? getNavLyricMask(offset > 0.5, offset < overflow - 0.5) : ''
      if (mask !== lastMask) {
        lastMask = mask
        container.style.maskImage = mask
        container.style.webkitMaskImage = mask
      }
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [getAudio, parsedLyricLines, prefersReducedMotion])

  // 切换减少动态效果时清理已写入的位移与遮罩
  useEffect(() => {
    layoutRef.current = null
    if (!prefersReducedMotion)
      return
    if (contentRef.current)
      contentRef.current.style.transform = ''
    if (containerRef.current) {
      containerRef.current.style.maskImage = ''
      containerRef.current.style.webkitMaskImage = ''
    }
  }, [prefersReducedMotion])

  if (!line)
    return ''

  if (lyricLines.length === 1 && (text === 'pure_music_without_lyric' || text === 'no_lyric')) {
    return t(text)
  }

  return (
    <span
      ref={containerRef}
      className={cn('block max-w-full overflow-hidden whitespace-pre', prefersReducedMotion && 'text-ellipsis')}
    >
      <span
        // key 保证换行时重新挂载，旧行的位移与高亮不会残留到新行
        key={lineKey}
        ref={contentRef}
        data-line-key={lineKey}
        className={cn('relative text-primary', prefersReducedMotion ? 'inline' : 'inline-block')}
      >
        {isWordLyric
          ? line.items.map((word, index) => (
              <span
                key={`${word.startTime}-${word.duration}-${index}`}
                data-word-index={index}
                className="relative inline-block align-baseline"
              >
                <span className="select-none text-primary/45">{word.text}</span>
                <span
                  data-word-fill
                  aria-hidden
                  className="pointer-events-none absolute inset-0 select-none text-primary"
                  style={{ clipPath: 'inset(0 100% 0 0)' }}
                >
                  {word.text}
                </span>
              </span>
            ))
          : line.originalText}
      </span>
    </span>
  )
}

function TrackInfo() {
  const { currentTrack, isPlaying, currentIndex } = useMusic()

  // 使用 useMeasure 测量容器与纯文本内容宽度
  const [nameContainerRef, { width: nameContainerWidth }] = useMeasure<HTMLDivElement>()
  const [nameContentRef, { width: nameContentWidth }] = useMeasure<HTMLDivElement>()
  const [artistContainerRef, { width: artistContainerWidth }] = useMeasure<HTMLDivElement>()
  const [artistContentRef, { width: artistContentWidth }] = useMeasure<HTMLDivElement>()

  const [isNameMarqueePlaying, setIsNameMarqueePlaying] = useState(false)
  const [isArtistMarqueePlaying, setIsArtistMarqueePlaying] = useState(false)

  useEffect(() => {
    const needName = (nameContentWidth ?? 0) > (nameContainerWidth ?? 0)
    const needArtist = (artistContentWidth ?? 0) > (artistContainerWidth ?? 0)
    setIsNameMarqueePlaying(Boolean(needName && isPlaying))
    setIsArtistMarqueePlaying(Boolean(needArtist && isPlaying))
  }, [nameContentWidth, nameContainerWidth, artistContentWidth, artistContainerWidth, isPlaying, currentTrack?.name, currentTrack?.artists, currentTrack?.album])

  // hooks 必须在提前返回之前调用，保证调用顺序稳定
  if (!currentTrack) {
    return null
  }

  return (
    <div className="flex relative">
      <CrossfadeAlbumImage
        src={currentTrack.albumPic}
        alt={currentTrack.album}
        priority
        sizes="60px"
        style={{ animationPlayState: isPlaying ? 'running' : 'paused' }}
        className={cn('rounded-full w-15 h-15 shrink-0', ALBUM_ROTATE_CLASSNAME)}
        imageClassName="object-cover rounded-full border-2 border-border"
      />
      <div className="flex flex-col justify-center px-4 gap-2 min-w-0">
        <div ref={nameContainerRef as any} className="text-lg font-medium text-foreground/90 overflow-hidden min-w-0">
          <div style={{ display: 'block', width: '100%' }}>
            <Marquee
              key={currentIndex}
              speed={30}
              pauseOnHover={true}
              play={isNameMarqueePlaying || currentTrack.aliases.length > 0} // 有别名的时候一般也会超出宽度，强制跑马灯
            >
              {currentTrack.name}
              <span className="text-muted-foreground ml-1">
                {currentTrack.aliases.length > 0 && ` (${currentTrack.aliases.join(', ')})`}
              </span>
              <span className="mr-20"></span>
            </Marquee>
          </div>
        </div>

        <div ref={artistContainerRef as any} className="text-xs text-foreground/50 overflow-hidden min-w-0">
          <div style={{ display: 'block', width: '100%' }}>
            <Marquee
              key={currentIndex}
              speed={30}
              pauseOnHover={true}
              play={isArtistMarqueePlaying}
            >
              {currentTrack.artists.join('/')}
              <span className="mx-1">-</span>
              {currentTrack.album}
              <span className="mr-10"></span>
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

function PlayerControls() {
  const t = useTranslations('MusicPlayer')
  const { currentTrack, currentTime, duration, isPlaying, play, pause, next, prev, seek } = useMusic()
  const [dragPercent, setDragPercent] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  // 限制在 0~100，避免时长未就绪或 currentTime 略超 duration 时进度条溢出
  const valuePercent = Math.max(0, Math.min(100, dragPercent ?? (duration ? (currentTime || 0) / duration * 100 : 0)))

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
        <div className="text-xs text-foreground/50 py-1">
          {isDragging && dragPercent != null && duration
            ? formatDurationMMSS(Math.floor(dragPercent / 100 * duration))
            : currentTime
              ? formatDurationMMSS(Math.floor(currentTime))
              : '00:00'}
        </div>
        <div className="text-xs text-foreground/50">
          {duration ? formatDurationMMSS(Math.floor(duration)) : '00:00'}
        </div>
      </div>
      <ProgressControl
        value={valuePercent}
        onChange={handleChange}
        onChangeEnd={handleChangeEnd}
        onIsDraggingChange={setIsDragging}
      />
      <div className="mt-2 flex items-center justify-center gap-4 text-foreground/50">
        <MuteButton />
        <PlayModeButton />
        {/* 图标放进带无障碍标签的按钮里，保证键盘可操作、读屏可识别 */}
        <button type="button" aria-label={t('previous')} title={t('previous')} onClick={prev} className="rounded-full">
          <CircleArrowLeftIcon aria-hidden className={cn('w-6 h-6', BUTTON_ANIMATION_CLASSNAME)} />
        </button>
        <button
          type="button"
          aria-label={isPlaying ? t('pause') : t('play')}
          title={isPlaying ? t('pause') : t('play')}
          onClick={isPlaying ? pause : play}
          className="rounded-full text-primary"
        >
          {isPlaying
            ? <CirclePauseIcon aria-hidden className={cn('w-8 h-8', BUTTON_ANIMATION_CLASSNAME)} />
            : <CirclePlayIcon aria-hidden className={cn('w-8 h-8', BUTTON_ANIMATION_CLASSNAME)} />}
        </button>
        <button type="button" aria-label={t('next')} title={t('next')} onClick={next} className="rounded-full">
          <CircleArrowRightIcon aria-hidden className={cn('w-6 h-6', BUTTON_ANIMATION_CLASSNAME)} />
        </button>
        <Playlist />
        <LyricModeButton />
      </div>
    </div>
  )
}

function MuteButton() {
  const t = useTranslations('MusicPlayer')
  const { isMuted, toggleMuted } = useMusic()
  const iconClassName = cn('w-5 h-5', BUTTON_ANIMATION_CLASSNAME)

  return (
    <button
      type="button"
      aria-label={isMuted ? t('unmute') : t('mute')}
      title={isMuted ? t('unmute') : t('mute')}
      aria-pressed={isMuted}
      onClick={toggleMuted}
      className={cn('p-1', isMuted ? 'text-primary' : '')}
    >
      {isMuted
        ? <VolumeXIcon className={iconClassName} />
        : <Volume2Icon className={iconClassName} />}
    </button>
  )
}

function LyricModeButton() {
  const {
    lyricMode,
    setLyricMode,
    hasRomajiLyric,
    hasTranslationLyric,
  } = useMusic()
  const t = useTranslations('MusicPlayer')
  const hasExtraLyric = hasRomajiLyric || hasTranslationLyric
  const iconClassName = cn('w-5 h-5', hasExtraLyric ? BUTTON_ANIMATION_CLASSNAME : '')

  const getNextMode = (mode: MusicLyricMode): MusicLyricMode => {
    if (mode === 'none')
      return 'romaji'
    if (mode === 'romaji')
      return 'translation'
    return 'none'
  }

  const iconMap: Record<MusicLyricMode, React.ReactNode> = {
    none: <MessageSquareOffIcon className={iconClassName} />,
    romaji: <CaseSensitiveIcon className={iconClassName} />,
    translation: <LanguagesIcon className={iconClassName} />,
  }

  return (
    <button
      type="button"
      aria-label={t('toggle_lyric_mode')}
      aria-disabled={!hasExtraLyric}
      title={!hasExtraLyric ? t('no_extra_lyric') : lyricMode === 'none' ? t('lyric_mode_none') : lyricMode === 'romaji' ? t('lyric_mode_romaji') : t('lyric_mode_translation')}
      onClick={() => setLyricMode(getNextMode(lyricMode))}
      disabled={!hasExtraLyric}
      className={cn(
        'p-1',
        !hasExtraLyric ? 'cursor-not-allowed text-foreground/20 hover:scale-100 hover:text-foreground/20' : '',
        hasExtraLyric && lyricMode !== 'none' ? 'text-primary' : '',
      )}
    >
      {iconMap[lyricMode]}
    </button>
  )
}

function PlayModeButton() {
  // 存储值的恢复在 MusicPlayer 挂载时完成，这里只负责写入
  const [, setStoredPlayMode] = useStoredState<PlayMode>(STORAGE_KEY_PLAY_MODE, 'repeat-all')
  const t = useTranslations('MusicPlayer')
  const { playMode, setPlayMode } = useMusic()
  const playModeSize = 'w-5 h-5'

  const icons: Record<PlayMode, React.ReactNode> = {
    'repeat-all': <RepeatIcon className={cn(playModeSize, BUTTON_ANIMATION_CLASSNAME)} />,
    'repeat-one': <Repeat1Icon className={cn(playModeSize, BUTTON_ANIMATION_CLASSNAME)} />,
    'shuffle': <Shuffle className={cn(playModeSize, BUTTON_ANIMATION_CLASSNAME)} />,
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
      aria-label={t('toggle_play_mode')}
      title={t(`play_mode_${playMode ?? 'repeat-all'}`)}
      onClick={handleClick}
      className="p-1"
    >
      {icons[playMode ?? 'repeat-all']}
    </button>
  )
}

// Memoized playlist item component to prevent unnecessary re-renders
const PlaylistItem = React.memo(({ track, origIndex, currentIndex, onClick }: {
  track: MusicTrack
  origIndex: number
  currentIndex: number | null
  onClick: () => void
}) => {
  const isActive = origIndex === currentIndex

  return (
    <div
      key={track.id}
      data-index={origIndex}
      onClick={onClick}
      className={cn(
        'p-2 border-b last:border-b-0 flex items-center gap-2 cursor-pointer hover:bg-accent transition-colors',
        isActive ? 'bg-primary/15' : '',
      )}
    >
      <div className="flex-1 min-w-0">
        <div className={cn(
          'text-sm font-medium text-foreground/90 truncate overflow-hidden whitespace-nowrap',
          isActive ? 'text-primary' : '',
        )}
        >
          {track.name}
          <span className="text-muted-foreground mr-1">
            {track.aliases.length > 0 && ` (${track.aliases.join(', ')})`}
          </span>
        </div>
        <div className={cn(
          'text-xs text-foreground/50 truncate overflow-hidden whitespace-nowrap',
          isActive ? 'text-primary/80' : '',
        )}
        >
          {track.artists.join('/')}
          {' '}
          -
          {' '}
          {track.album}
        </div>
      </div>
    </div>
  )
})

function Playlist() {
  const t = useTranslations('MusicPlayer')
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
        <button type="button" aria-label={t('playlist')} title={t('playlist')} className="rounded-full">
          <ListMusicIcon aria-hidden className={cn('w-5 h-5', BUTTON_ANIMATION_CLASSNAME)} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="fixed -right-16 bottom-4 z-1001 p-1">
        {showSearch
          ? (
              <div className="flex gap-1 border-b border-border pb-1">
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
                  className="p-2 rounded hover:bg-accent"
                  aria-label={t('close_search')}
                >
                  ✕
                </button>
              </div>
            )
          : (
              <div className="flex pb-1 justify-between items-center">
                <div className="px-2 pb-1 text-sm text-foreground/50">
                  {t('playlist')}
                  {' '}
                  (
                  {playlist.length}
                  )
                </div>
                <button
                  type="button"
                  onClick={() => setShowSearch(true)}
                  className="p-2 rounded hover:bg-accent"
                  aria-label={t('open_search')}
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
                  : <div className="p-2 text-sm text-foreground/50">{t('no_matching_tracks')}</div>
              )
            : <div className="p-2 text-sm text-foreground/50">{t('no_tracks')}</div>}
        </div>
      </PopoverContent>
    </Popover>
  )
}
