'use client'

import type { MusicSource, MusicTrack } from '@/models/music'
import { Maximize2Icon, MusicIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import React, { useEffect, useRef, useState } from 'react'
import { fetchNcmPlaylist, fetchPlaylist, fetchPlaylistVersion } from '@/api/music'
import { SafeImage } from '@/components/common/safe-image'
import { useIslandPanelPhase } from '@/components/layout/topbar-island/island-panel-phase'
import { MusicBackground } from '@/components/music-page/music-background'
import { MusicLyricMoments } from '@/components/music-page/music-lyric-moments'
import { MUSIC_ICON_BUTTON_CLASSNAME, MusicPageControls } from '@/components/music-page/music-page-controls'
import { readMusicShareParamsFromLocation } from '@/components/music-page/music-share-params'
import { MusicStageEffects } from '@/components/music-page/music-stage-effects'
import { useSongAccent } from '@/components/music-page/use-cover-accent'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useCurrentLyric, useMusic, useMusicClockStore } from '@/contexts/music-context'
import { readPlaylistCache, writePlaylistCache } from '@/lib/music-playlist-cache'
import { cn } from '@/lib/utils'
import { shouldOptimize } from '@/utils/common/image'
import { MarqueeText } from './marquee-text'
import { MusicMiniPlaylist } from './music-mini-playlist'
import { useFloatingBall } from './use-floating-ball'

// 歌词引擎（含歌词字体样式表）比播放器本身重得多，等轻量外壳渲染出来再加载
const MusicLyricStage = dynamic(() => import('@/components/music-page/music-lyric-stage').then(m => m.MusicLyricStage), { ssr: false })

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
  // 仅站内 / 白名单图片经优化器取小图；站外图片直连（依赖对方 CORS，失败时回退默认色）
  return shouldOptimize(src) ? `/_next/image?url=${encodeURIComponent(src)}&w=64&q=75` : src
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
// 专辑封面旋转一圈的时长，使用 CSS 动画代替逐帧 setState
const ALBUM_ROTATE_CLASSNAME = 'animate-spin [animation-duration:30s]'

// 与播放器页一致：主色换成白色，进度条、焦点环等与白色文字协调
const PLAYER_STYLE = { '--primary': 'oklch(0.97 0 0)', '--primary-foreground': 'oklch(0.2 0 0)' } as React.CSSProperties

/**
 * 悬浮播放器弹层的外观：与播放器页一致的深色沉浸界面；弹层渲染在 body 下，单独加 dark。
 * 顶栏灵动岛点按展开的播放器与悬浮球弹出的是同一个（MiniPlayer + 这里的外观），见 components/layout/topbar-island/music-island.tsx
 */
export const MINI_PLAYER_POPOVER_CLASSNAME = 'dark z-1000 w-88 max-w-[calc(100vw-1rem)] overflow-hidden rounded-2xl border-white/10 bg-neutral-950 p-0 text-white shadow-2xl'
export const MINI_PLAYER_POPOVER_STYLE = { ...PLAYER_STYLE, pointerEvents: 'auto' } as React.CSSProperties

/**
 * 顶栏灵动岛里的旋转封面（见 components/layout/topbar-island/music-island.tsx）：与悬浮球一致，只把封面裁成圆形，不加边框；
 * 组件内部自行读取播放状态，暂停时停转，曲目切换时交叉淡入新封面
 */
export function AlbumNavIcon() {
  const { currentTrack, isPlaying } = useMusic()

  // 没有封面时回退为音乐图标，避免导航栏出现占位块
  if (!currentTrack?.albumPic) {
    return <MusicIcon aria-hidden className="size-6!" />
  }

  return (
    <CrossfadeAlbumImage
      src={currentTrack.albumPic}
      alt=""
      sizes="24px"
      style={{ animationPlayState: isPlaying ? 'running' : 'paused' }}
      className={cn('size-6', ALBUM_ROTATE_CLASSNAME)}
      imageClassName="object-cover rounded-full"
    />
  )
}

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
 * 计算刷新后应恢复的曲目索引与进度：
 * - 打开的是带分享参数的播放器页（/music?id=…&start=…）且歌曲在歌单内时，以地址为准
 * - 否则按本地存储：优先按曲目 id 定位（歌单顺序变化也不会错位）；存储的曲目已不在歌单中时从头开始且不恢复进度；
 *   兼容只存了索引的旧数据
 */
function getRestoredPlayback(tracks: MusicTrack[]): { index: number, time?: number } {
  if (tracks.length === 0)
    return { index: 0 }
  const shared = readMusicShareParamsFromLocation()
  const sharedIndex = shared ? tracks.findIndex(track => track.id === shared.id) : -1
  if (shared && sharedIndex >= 0)
    return { index: sharedIndex, time: shared.start ?? 0 }
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

export function MusicPlayer({ source }: { source: MusicSource }) {
  const t = useTranslations('MusicPlayer')
  const {
    currentTrack,
    replacePlaylist,
    sampleTrack,
    currentIndex,
    duration,
    isPlaying,
  } = useMusic()
  const clock = useMusicClockStore()
  // 播放器页（/music）本身就是完整的播放器：不显示悬浮球，但歌单加载与进度保存照常进行
  const onPlayerPage = usePathname() === '/music'
  const themeColor = useAlbumThemeColor(currentTrack?.albumPic)
  const animatedThemeColor = useAnimatedThemeColor(themeColor)
  // 悬浮球可拖动；开始拖动时收起播放器
  const [open, setOpen] = useState(false)
  const ball = useFloatingBall({ onDragStart: () => setOpen(false) })

  // 歌单加载并完成进度恢复后才允许写回存储，避免初始化阶段覆盖已保存的值
  const restoredRef = useRef(false)
  // 刷新后恢复的曲目 id：首次切到该曲目时不清零已保存的进度
  const restoredTrackIdRef = useRef<number | null>(null)
  // 节流写入存储，避免频繁 localStorage 写入
  const lastSavedTimeRef = useRef(0)
  // 后台换上新版本歌单时，用它把当前曲目定位到新歌单里（effect 里的闭包拿不到最新的曲目）
  const currentTrackIdRef = useRef<number | null>(null)
  useEffect(() => {
    currentTrackIdRef.current = currentTrack?.id ?? null
  }, [currentTrack])

  // 拉取歌单后一次性以“存储的曲目 + 进度”初始化，不再先切到第 0 首再切回，避免多余的歌词请求与竞态。
  // 网易云歌单有本地缓存：先用缓存渲染（悬浮球立刻出现、直接恢复上次的曲目），再只校验版本，内容没变就不再下载整份歌单
  useEffect(() => {
    let cancelled = false
    // 首次应用：恢复上次的曲目与进度
    const applyRestored = (tracks: MusicTrack[]) => {
      const { index, time } = getRestoredPlayback(tracks)
      restoredTrackIdRef.current = tracks[index]?.id ?? null
      replacePlaylist(tracks, index, time)
      restoredRef.current = true
    }
    // 后台拿到新版本（站长增删了歌曲）：只换歌单数据，把当前曲目定位到新歌单里继续放，不重置进度
    const applyUpdated = (tracks: MusicTrack[]) => {
      const playingId = currentTrackIdRef.current ?? restoredTrackIdRef.current
      const index = tracks.findIndex(track => track.id === playingId)
      replacePlaylist(tracks, index < 0 ? 0 : index)
    }
    const cached = source.type === 'ncm' ? readPlaylistCache() : null
    if (cached)
      applyRestored(cached.tracks)

    const sync = async () => {
      if (source.type !== 'ncm') {
        const tracks = await fetchPlaylist(source)
        if (!cancelled)
          applyRestored(tracks)
        return
      }
      if (cached) {
        const version = await fetchPlaylistVersion()
        if (cancelled || version === cached.version)
          return
        const fresh = await fetchNcmPlaylist()
        if (cancelled)
          return
        writePlaylistCache(fresh.version, fresh.tracks)
        applyUpdated(fresh.tracks)
        return
      }
      const fresh = await fetchNcmPlaylist()
      if (cancelled)
        return
      writePlaylistCache(fresh.version, fresh.tracks)
      applyRestored(fresh.tracks)
    }

    sync().catch((error) => {
      if (cancelled)
        return
      // 有本地缓存时继续用缓存；没有时用示例曲目兜底，但不开启存储写回，避免覆盖用户已保存的曲目与进度
      if (!cached) {
        replacePlaylist([
          sampleTrack,
        ])
      }
      console.error('Failed to fetch playlist:', error)
    })
    return () => {
      cancelled = true
    }
    // sampleTrack 每次渲染都会重新创建，不放入依赖，只在歌单来源变化时重新拉取
  }, [source, replacePlaylist])

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

  // 定期保存播放进度到 storage（直接订阅播放时钟，不因进度变化重渲染）；元数据就绪前（duration 为空）进度尚未恢复，不写入
  useEffect(() => {
    if (currentTrackId == null || duration == null)
      return
    return clock.subscribe(() => {
      const time = clock.getSnapshot()
      if (!restoredRef.current || !Number.isFinite(time))
        return
      const now = Date.now()
      if (now - lastSavedTimeRef.current < 1000)
        return
      writeStoredNumber(STORAGE_KEY_TIME, Math.floor(time))
      writeStoredNumber(STORAGE_KEY_TRACK_ID, currentTrackId)
      lastSavedTimeRef.current = now
    })
  }, [clock, currentTrackId, duration])

  if (!currentTrack || onPlayerPage) {
    return null
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('floating_player')}
          {...ball.handlers}
          style={{
            ...ball.style,
            // 播放时以专辑主题色发光
            boxShadow: isPlaying ? `0 6px 22px rgb(${animatedThemeColor} / 0.55)` : '0 8px 18px rgb(0 0 0 / 0.18)',
          }}
          className={cn(
            // touch-none：在悬浮球上拖动时不滚动页面；停靠时用过渡吸附到边缘，拖动时跟手
            'fixed z-50 flex touch-none cursor-pointer items-center justify-center rounded-full select-none transition-[transform,box-shadow] duration-300 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            ball.dragging ? 'cursor-grabbing scale-105' : 'motion-safe:transition-[left,top,transform,box-shadow]',
            !ball.ready && 'invisible',
          )}
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
        // 朝屏幕中较宽敞的方向展开，与悬浮球所在的一侧对齐
        side={ball.upperHalf ? 'bottom' : 'top'}
        align={ball.side === 'left' ? 'start' : 'end'}
        sideOffset={12}
        collisionPadding={8}
        className={MINI_PLAYER_POPOVER_CLASSNAME}
        style={MINI_PLAYER_POPOVER_STYLE}
      >
        <MiniPlayer onOpenPage={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}

/**
 * 歌词引擎挂载前的替身：不显示，只标出当前这一句在紧凑模式里的大致落点（字号同焦点行，对齐在歌词区 40% 的高度）。
 * 从顶栏灵动岛展开时，胶囊里带样式的单行歌词按它的位置与字号飞过来，留在这里；歌词引擎挂上来换下替身后，
 * 滑到引擎里同一句（.lyric-main）的位置再淡出（焦点行带音译、翻译时比替身靠上，见 topbar-island/island-morph.ts）
 */
function LyricLineStandIn() {
  const text = useCurrentLyric()
  return (
    <div aria-hidden data-island-morph="lyrics" data-island-morph-standin=".lyric-main" className="invisible absolute inset-x-0 top-[40%] -translate-y-1/2 truncate px-2 text-[1.0625rem] leading-[1.35] font-bold">
      {text}
    </div>
  )
}

/**
 * 正在显示的悬浮播放器（悬浮球与顶栏灵动岛的弹层共用 MiniPlayer），顶栏灵动岛据此让位（见 topbar-island/music-island.tsx）：
 * - floating：悬浮球的弹层开着，灵动岛这时不显示音乐活动
 * - effects：悬浮播放器挂着，舞台特效与律动条由它演出，胶囊的暂停
 * - lyrics：悬浮播放器的歌词引擎在逐帧运行（灵动岛的面板只算展开完毕到开始收起之间），胶囊的暂停
 * 同一首歌的两套歌词引擎、两套特效同时逐帧运行时，iOS 26 的 Safari（JavaScriptCore 优化编译时）会整页崩溃（实测 Sen Trope 的长间奏处必现），
 * 所以同一时刻只让一处运行；暂停的一方停在此刻的画面，恢复时直接跳到此刻的进度
 */
type MiniPlayerHold = 'floating' | 'effects' | 'lyrics'
const miniPlayerHolds: Record<MiniPlayerHold, number> = { floating: 0, effects: 0, lyrics: 0 }
const miniPlayerListeners = new Set<() => void>()

function subscribeMiniPlayerHolds(listener: () => void) {
  miniPlayerListeners.add(listener)
  return () => {
    miniPlayerListeners.delete(listener)
  }
}

function useMiniPlayerHold(hold: MiniPlayerHold, active: boolean) {
  useEffect(() => {
    if (!active)
      return
    const change = (delta: number) => {
      miniPlayerHolds[hold] += delta
      miniPlayerListeners.forEach(listener => listener())
    }
    change(1)
    return () => change(-1)
  }, [active, hold])
}

/** 悬浮播放器此刻是否占着 hold 所指的那部分（见上方 miniPlayerHolds） */
export function useMiniPlayerHolding(hold: MiniPlayerHold) {
  return React.useSyncExternalStore(subscribeMiniPlayerHolds, () => miniPlayerHolds[hold] > 0, () => false)
}

/**
 * 悬浮播放器：播放器页（/music）的缩小版，共用歌词引擎（紧凑模式）、歌词来源标签、控制栏与全部特效（全屏特效为小窗精简版）；
 * 歌单为从歌单按钮弹出的小浮层，歌名与歌手过长时以跑马灯滚动；右上角的按钮进入完整的播放器页（onOpenPage 用于同时收起弹层）。
 * 悬浮球与顶栏灵动岛的弹层共用
 */
export function MiniPlayer({ onOpenPage }: { onOpenPage?: () => void }) {
  const t = useTranslations('MusicPlayer')
  const { currentTrack, isPlaying } = useMusic()
  // 在顶栏灵动岛的面板里时所处的阶段（悬浮球的弹层里为 null）：形变期间歌词区先放当前这一句的替身（落点），
  // 展开完再挂载歌词引擎（排上千个字的开销不卡住展开动画）；开始收起后歌词引擎停在此刻（前景随即淡出），交还给胶囊
  const panelPhase = useIslandPanelPhase()
  const panelReady = panelPhase !== 'opening'
  const lyricsRunning = panelPhase == null || panelPhase === 'open'
  useMiniPlayerHold('floating', panelPhase == null)
  useMiniPlayerHold('effects', true)
  useMiniPlayerHold('lyrics', lyricsRunning)
  // 与播放器页相同：主题色（模型选的颜色或封面主色）作为辉光与呼吸的默认颜色
  const accent = useSongAccent(currentTrack?.albumPic)
  if (!currentTrack)
    return null

  return (
    <div role="region" aria-label={t('floating_player')} className="relative isolate" style={accent ? { '--lyric-accent': accent } as React.CSSProperties : undefined}>
      <MusicBackground cover={currentTrack.albumPic} contained morphBackdrop />
      {/* 全屏特效的小窗版：背景呼吸、副歌爆发、染色、节拍呼吸、粒子场景（粒子缩小、数量减少） */}
      <MusicStageEffects contained />
      {/* data-island-morph-fade：从顶栏灵动岛展开 / 收起时只有前景淡入淡出，模糊封面背景与全屏特效全程显示、随形状伸缩（见 topbar-island/island-morph.ts） */}
      <div data-island-morph-fade className="relative grid gap-3 p-4">
        <div className="flex items-center gap-3">
          {/* 暂停时封面略微缩小，与播放器页一致 */}
          {/* data-island-morph：从顶栏灵动岛展开时封面从胶囊里的小封面放大到这里，歌词区同理（见 topbar-island/island-morph.ts） */}
          <span
            data-island-morph="cover"
            className="relative size-14 shrink-0 overflow-hidden rounded-xl bg-white/10 shadow-lg transition-transform duration-500 ease-out"
            style={{ transform: isPlaying ? 'scale(1)' : 'scale(0.92)' }}
          >
            {currentTrack.albumPic
              ? <SafeImage src={currentTrack.albumPic} alt={currentTrack.album} fill sizes="56px" className="object-cover" />
              : <MusicIcon aria-hidden className="absolute inset-0 m-auto size-6 text-white/40" />}
          </span>
          <div className="grid min-w-0 flex-1 content-center gap-1">
            {/* key：切歌时重新测量并从头滚动 */}
            <MarqueeText key={`name-${currentTrack.id}`} className="text-base leading-snug font-semibold">
              {currentTrack.name}
              {currentTrack.aliases.length > 0 && <span className="ml-1 font-normal text-white/50">{`(${currentTrack.aliases.join(', ')})`}</span>}
            </MarqueeText>
            <MarqueeText key={`artist-${currentTrack.id}`} className="text-sm leading-snug text-white/60">
              {[currentTrack.artists.join(' / '), currentTrack.album].filter(Boolean).join(' · ')}
            </MarqueeText>
          </div>
          <Link
            href="/music"
            onClick={onOpenPage}
            aria-label={t('open_player_page')}
            title={t('open_player_page')}
            className={cn(MUSIC_ICON_BUTTON_CLASSNAME, '-mt-1 -mr-1 self-start')}
          >
            <Maximize2Icon aria-hidden className="size-4" />
          </Link>
        </div>
        {/* 展开时歌词区不跟着平移（胶囊里的歌词飞到替身那里）；挂上歌词引擎后收起时整块平移回胶囊里的歌词处 */}
        <div data-island-morph={panelReady ? 'lyrics' : undefined} className="relative h-44">
          {panelReady
            ? (
                <>
                  <MusicLyricStage compact paused={!lyricsRunning} className="h-full animate-in duration-200 fade-in-0" />
                  <MusicLyricMoments compact className="absolute inset-x-0 bottom-1" />
                </>
              )
            : <LyricLineStandIn />}
        </div>
        <MusicPageControls compact playlistSlot={<MusicMiniPlaylist />} />
      </div>
    </div>
  )
}
