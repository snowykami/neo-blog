'use client'

import { MusicIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useImageOptimizeHosts } from '@/contexts/image-optimize-context'
import {
  activateMusicRuntime,
  preloadMusicRuntime,
  useMusicPlayback,
} from '@/contexts/music-context'
import { useDesktopIslandPrefs, useDesktopIslandRuntime } from '@/hooks/use-desktop-island-pref'
import { usePathname } from '@/i18n/navigation'
import { isConsolePath } from '@/i18n/routing'
import { cn } from '@/lib/utils'
import { formatMusicCoverUrl, shouldOptimize } from '@/utils/common/image'
import { isConsolePreviewPath } from '@/utils/common/route'
import {
  ALBUM_ROTATE_CLASSNAME,
  CrossfadeAlbumImage,
  MINI_PLAYER_POPOVER_CLASSNAME,
  MINI_PLAYER_POPOVER_STYLE,
} from './music-player-shared'
import { useFloatingBall } from './use-floating-ball'

const DEFAULT_MUSIC_THEME_RGB = '59 130 246'

let musicPlayerPromise: Promise<typeof import('@/components/common/music-player')> | null = null
let miniPlayerPromise: Promise<typeof import('@/components/common/mini-player')> | null = null

export function loadMusicPlayerModule() {
  musicPlayerPromise ??= import('@/components/common/music-player').catch((err) => {
    musicPlayerPromise = null
    throw err
  })
  return musicPlayerPromise
}

function loadMiniPlayer() {
  miniPlayerPromise ??= import('@/components/common/mini-player').catch((err) => {
    miniPlayerPromise = null
    throw err
  })
  return miniPlayerPromise
}

const MiniPlayer = dynamic(() => loadMiniPlayer().then(m => m.MiniPlayer), { ssr: false })

function preloadMusicChunks() {
  preloadMusicRuntime()
  void loadMusicPlayerModule().catch(() => {})
  void loadMiniPlayer().catch(() => {})
}

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

function getThemeSampleImageSrc(src: string, optimizeHosts: readonly string[]) {
  const formatted = formatMusicCoverUrl(src, 48)
  if (formatted !== src)
    return formatted
  return shouldOptimize(src, optimizeHosts) ? `/_next/image?url=${encodeURIComponent(src)}&w=64&q=45` : src
}

function useAlbumThemeColor(src?: string) {
  const optimizeHosts = useImageOptimizeHosts()
  const [themeColor, setThemeColor] = useState(DEFAULT_MUSIC_THEME_RGB)

  useEffect(() => {
    if (!src) {
      setThemeColor(DEFAULT_MUSIC_THEME_RGB)
      return
    }

    let cancelled = false
    const image = new Image()
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

        if (weightSum > 0)
          setThemeColor(normalizeThemeColor(r / weightSum, g / weightSum, b / weightSum))
      }
      catch {
        setThemeColor(DEFAULT_MUSIC_THEME_RGB)
      }
    }

    image.onerror = () => {
      if (!cancelled)
        setThemeColor(DEFAULT_MUSIC_THEME_RGB)
    }
    image.src = getThemeSampleImageSrc(src, optimizeHosts)

    return () => {
      cancelled = true
    }
  }, [src, optimizeHosts])

  return themeColor
}

/**
 * 持久化单实例悬浮球外壳：
 * - 全生命周期保持同一 `<Popover>` 与 `<button>` 实例不卸载，彻底杜绝悬停/点击瞬间换节点引发的 W3C click 丢失、
 *   拖拽 pointerCapture 中断、Tab 键盘焦点丢失及 `--floating-ball-reserve` 高度抖动；
 * - 未开启音乐且无断点会话时仅展示轻量图标，不拉取歌单、不创建 `<audio>`；
 * - 鼠标悬停 / 触摸按下时挂载 `MusicRuntimeController` 并预加载弹层 chunk；点击展开弹层时再按需拉取初始曲目。
 */
export function FloatingMusicBall() {
  const t = useTranslations('MusicPlayer')
  const pathname = usePathname()
  const { currentTrack, isPlaying, playlistState } = useMusicPlayback()
  const desktopPrefs = useDesktopIslandPrefs()
  const { status: desktopStatus } = useDesktopIslandRuntime()

  const onPlayerPage = pathname === '/music'
  const inConsole = isConsolePath(pathname) && !isConsolePreviewPath(pathname)
  const hiddenByDesktopIsland = desktopPrefs.enabled && desktopPrefs.hideFloatingBallWhenConnected && desktopStatus === 'connected'
  const showBall = (Boolean(currentTrack) || playlistState === 'pending') && !onPlayerPage && !inConsole && !hiddenByDesktopIsland

  const [open, setOpen] = useState(false)
  const ball = useFloatingBall({ onDragStart: () => setOpen(false) })
  const themeColor = useAlbumThemeColor(showBall && isPlaying ? currentTrack?.albumPic : undefined)

  const reserve = showBall && ball.ready ? ball.reserve : 0
  useEffect(() => {
    if (!reserve)
      return
    const root = document.documentElement
    root.style.setProperty('--floating-ball-reserve', `${reserve}px`)
    return () => {
      root.style.removeProperty('--floating-ball-reserve')
    }
  }, [reserve])

  if (!showBall)
    return null

  const handleHoverOrTouch = () => {
    preloadMusicChunks()
    activateMusicRuntime()
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          preloadMusicChunks()
          activateMusicRuntime({ syncPlaylist: true })
        }
        setOpen(nextOpen)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('floating_player')}
          onPointerEnter={(e) => {
            if (e.pointerType !== 'touch' && !ball.dragging)
              handleHoverOrTouch()
          }}
          onTouchStart={handleHoverOrTouch}
          onFocus={preloadMusicChunks}
          {...ball.handlers}
          style={{
            ...ball.style,
            boxShadow: isPlaying ? `0 6px 22px rgb(${themeColor} / 0.55)` : '0 8px 18px rgb(0 0 0 / 0.18)',
          }}
          className={cn(
            'fixed z-50 flex touch-none cursor-pointer items-center justify-center rounded-full select-none transition-[transform,box-shadow] duration-300 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            ball.dragging ? 'cursor-grabbing scale-105' : 'motion-safe:transition-[left,top,transform,box-shadow]',
            !ball.ready && 'invisible',
          )}
        >
          {currentTrack?.albumPic
            ? (
                <CrossfadeAlbumImage
                  src={formatMusicCoverUrl(currentTrack.albumPic, 128)}
                  alt={currentTrack.album}
                  sizes="(min-width: 1024px) 64px, 48px"
                  style={{ animationPlayState: isPlaying ? 'running' : 'paused' }}
                  className={cn('h-12 w-12 rounded-full lg:h-16 lg:w-16', ALBUM_ROTATE_CLASSNAME)}
                  imageClassName="rounded-full border-4 border-card object-cover"
                />
              )
            : (
                <span className="flex h-12 w-12 items-center justify-center rounded-full border-4 border-card bg-neutral-900 text-white/85 lg:h-16 lg:w-16">
                  <MusicIcon aria-hidden className="size-5 lg:size-6" />
                </span>
              )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={ball.upperHalf ? 'bottom' : 'top'}
        align={ball.side === 'left' ? 'start' : 'end'}
        sideOffset={12}
        collisionPadding={8}
        className={MINI_PLAYER_POPOVER_CLASSNAME}
        style={MINI_PLAYER_POPOVER_STYLE}
      >
        {open && <MiniPlayer onOpenPage={() => setOpen(false)} />}
      </PopoverContent>
    </Popover>
  )
}
