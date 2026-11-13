'use client'

import { MusicIcon } from 'lucide-react'
import React, { useEffect, useRef, useState } from 'react'
import { SafeImage } from '@/components/common/safe-image'
import { useMusicPlayback } from '@/contexts/music-context'
import { cn } from '@/lib/utils'

/**
 * 播放器里与顶栏灵动岛共用的轻量部分（外观常量、旋转封面、悬浮播放器的占用状态）。
 *
 * 顶栏每页都在，灵动岛又一直挂着：这些放在 music-player.tsx 里时，岛对它的静态引用会把整个播放器
 * （歌词引擎、舞台特效、取色……）拉进每一页的首屏 JS，main-floating-widgets 的按需加载形同虚设。
 * 所以单独成文件，只依赖首屏本来就有的东西；播放器本体由 music-player.tsx 按需加载
 */

// 封面交叉淡入、主题色过渡的时长
export const ALBUM_TRANSITION_DURATION_MS = 500
// 专辑封面旋转一圈的时长，使用 CSS 动画代替逐帧 setState
export const ALBUM_ROTATE_CLASSNAME = 'animate-spin [animation-duration:30s]'

// 与播放器页一致：主色换成白色，进度条、焦点环等与白色文字协调
export const PLAYER_STYLE = { '--primary': 'oklch(0.97 0 0)', '--primary-foreground': 'oklch(0.2 0 0)' } as React.CSSProperties

/**
 * 悬浮播放器弹层的外观：与播放器页一致的深色沉浸界面；弹层渲染在 body 下，单独加 dark。
 * 顶栏灵动岛点按展开的播放器与悬浮球弹出的是同一个（MiniPlayer + 这里的外观），见 components/layout/topbar-island/music-island.tsx
 */
export const MINI_PLAYER_POPOVER_CLASSNAME = 'dark z-1000 w-88 max-w-[calc(100vw-1rem)] overflow-hidden rounded-2xl border-white/10 bg-neutral-950 p-0 text-white shadow-2xl'
export const MINI_PLAYER_POPOVER_STYLE = { ...PLAYER_STYLE, pointerEvents: 'auto' } as React.CSSProperties

export function CrossfadeAlbumImage({
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

/**
 * 顶栏灵动岛里的旋转封面（见 components/layout/topbar-island/music-island.tsx）：与悬浮球一致，只把封面裁成圆形，不加边框；
 * 组件内部自行读取播放状态，暂停时停转，曲目切换时交叉淡入新封面
 */
export function AlbumNavIcon() {
  const { currentTrack, isPlaying } = useMusicPlayback()

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

/** 悬浮播放器挂着时占住 hold 所指的那部分（只由 MiniPlayer 调用） */
export function useMiniPlayerHold(hold: MiniPlayerHold, active: boolean) {
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
