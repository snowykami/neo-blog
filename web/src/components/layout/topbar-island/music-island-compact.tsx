'use client'

import { PlayIcon } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import dynamic from 'next/dynamic'
import { useEffect, useRef } from 'react'
import { MarqueeText } from '@/components/common/marquee-text'
import { AlbumNavIcon, useMiniPlayerHolding } from '@/components/common/music-player-shared'
import { MusicBackground } from '@/components/music-page/music-background'
import { MusicStageEffects } from '@/components/music-page/music-stage-effects'
import { useSongAccent } from '@/components/music-page/use-cover-accent'
import { useMusic } from '@/contexts/music-context'
import { useHdrHighlight } from '@/hooks/use-hdr-highlight'
import { HDR_BRIGHTNESS } from '@/lib/hdr-color'
import { backgroundLevel, rhythmContext } from '@/lib/lyrics/rhythm/effects'
import { rhythmModelFor } from '@/lib/lyrics/rhythm/source'
import { cn } from '@/lib/utils'
import { IslandSlot, IslandText } from './island-parts'

/**
 * 灵动岛音乐胶囊的内容（模糊封面底、舞台特效、单行歌词、律动条）。
 *
 * 这些都依赖播放器那一套重模块（舞台特效、粒子、HDR 画布、节拍模型……），而灵动岛每页都挂着：
 * 单独成文件、由 music-island.tsx 在有曲目时才按需加载，不进首屏 JS
 */

// 单行歌词同样用歌词引擎，延后到真正需要时再加载
const MusicLyricStage = dynamic(() => import('@/components/music-page/music-lyric-stage').then(m => m.MusicLyricStage), { ssr: false })

/**
 * 胶囊里的音乐内容：背景铺满整个胶囊（定位祖先为胶囊内容层）。
 * 播放时中间是歌词引擎的单行条（固定宽度），右侧律动条；paused 时中间是静态的 text、右侧播放键，宽度收到正好放下文字（最多同播放时），
 * 单行条只是藏起来、不卸载（暂停时引擎本来就静止），继续播放时直接露出，不用重新排版；特效淡出并停在此刻
 */
export function MusicCompact({ beat, title, paused = false, text }: { beat: boolean, title: string, paused?: boolean, text?: string }) {
  const { currentTrack, lyricLines, lyrics } = useMusic()
  const accent = useSongAccent(currentTrack?.albumPic)
  const hasLyric = lyricLines.length > 0 || lyrics.instrumental
  // 悬浮播放器（悬浮球或灵动岛的弹层）开着时胶囊不露面（悬浮球的弹层开着时音乐活动待命，灵动岛的面板盖在胶囊上），
  // 由弹层演出歌词与特效，胶囊这边的暂停、停在此刻的画面：两套同时逐帧运行时 iOS 26 的 Safari 会整页崩溃（见 music-player-shared.tsx 的 miniPlayerHolds）。
  // 收起面板时歌词引擎先交还过来，在面板底下跟上此刻的进度，胶囊露面时已是正在唱的那一句
  const effectsPaused = useMiniPlayerHolding('effects')
  const lyricsPaused = useMiniPlayerHolding('lyrics')
  // 随拍染色层：律动条逐帧写入不透明度
  const tintRef = useRef<HTMLSpanElement>(null)
  // HDR 高光：染色层与律动条改由主色的 HDR 素材绘制，随拍时亮过 SDR 白（仍只改不透明度，不改大小）
  const hdr = useHdrHighlight(beat ? accent ?? '#fff' : null, HDR_BRIGHTNESS.islandBeat)
  const hdrStyle = hdr ? { backgroundImage: hdr } : undefined
  return (
    <span className="contents" style={accent ? { '--lyric-accent': accent } as React.CSSProperties : undefined}>
      {/* 标题区域只有一行高，按播放器的模糊半径会糊成一片黑，改用小半径保留封面的颜色 */}
      <MusicBackground cover={currentTrack?.albumPic} contained imageClassName="blur-md" />
      <span className={cn('transition-opacity duration-300', paused && 'opacity-0')}>
        <MusicStageEffects contained paused={effectsPaused || paused} />
      </span>
      {beat && <span ref={tintRef} aria-hidden className="pointer-events-none absolute inset-0 bg-[color:var(--lyric-accent,#fff)] opacity-0" style={hdrStyle} />}
      {/* 封面与歌词标了 data-island-morph：展开时封面放大飞到面板里的封面处，单行歌词带着样式飞到面板歌词区的焦点行（没有歌词时不飞，见 island-morph.ts） */}
      <IslandSlot morph="cover"><AlbumNavIcon /></IslandSlot>
      {/* 歌词与文字离封面、律动条各 10px：单行条自带 10px 内边距，左右各收回 6px。
          字号 16px（胶囊其他活动为 14px），歌词更好地占满胶囊高度；宽度按字号折算成 31.5ch，与 14px 时的 36ch 同宽，胶囊不因此变宽 */}
      <span data-island-morph={hasLyric && !paused ? 'lyrics' : undefined} className={cn('relative flex h-9 min-w-0 shrink items-center text-base', paused ? 'max-w-[31.5ch]' : 'w-[31.5ch] max-w-full')}>
        {hasLyric && <MusicLyricStage strip paused={lyricsPaused} className={cn('-mx-1.5 h-full min-w-0 flex-1', paused && 'hidden')} />}
        {(paused || !hasLyric) && <IslandText className={paused ? undefined : 'flex-1'}><MarqueeText>{(paused && text) || title}</MarqueeText></IslandText>}
      </span>
      {paused
        ? <IslandSlot className="[&>svg]:size-3.5"><PlayIcon aria-hidden className="fill-current" /></IslandSlot>
        : beat && <IslandSlot><BeatBars tintRef={tintRef} paused={effectsPaused} barStyle={hdrStyle} /></IslandSlot>}
    </span>
  )
}

// 律动条：5 根 2px 细条（同 Apple 音乐的波形，中间最高），相对高度与相位错开一点，避免整齐划一
const BARS = [
  { weight: 0.6, lagMs: 90, freq: 6.3 },
  { weight: 0.85, lagMs: 40, freq: 8.1 },
  { weight: 1, lagMs: 0, freq: 9.7 },
  { weight: 0.8, lagMs: 60, freq: 7.4 },
  { weight: 0.65, lagMs: 120, freq: 5.2 },
]
// 跟随节拍时胶囊底色泛起封面主色的最大不透明度
const BEAT_TINT_OPACITY = 0.22

/**
 * 胶囊右侧的律动条：有可信的节拍模型时随拍跳动、随拍变亮，胶囊底色也随拍泛起封面主色（只变颜色，胶囊大小不随拍变化，避免整颗岛一抽一抽）；
 * 没有时（关闭了歌词特效、浏览器开启省流量、分析失败等）以错开的起伏模拟，不染色。逐帧直接写 DOM，不触发 React 渲染；暂停或减少动态效果时静止，
 * paused 时（悬浮播放器开着）停在此刻
 */
function BeatBars({ tintRef, paused, barStyle }: { tintRef: React.RefObject<HTMLSpanElement | null>, paused: boolean, barStyle?: React.CSSProperties }) {
  const { getAudio, isPlaying, currentTrack } = useMusic()
  const reducedMotion = useReducedMotion()
  const rootRef = useRef<HTMLSpanElement>(null)
  const stateRef = useRef({ trackId: currentTrack?.id ?? null })
  useEffect(() => {
    stateRef.current = { trackId: currentTrack?.id ?? null }
  }, [currentTrack?.id])

  // 停止播放、减少动态效果或律动条撤下时撤掉随拍染色（paused 时保留，停在此刻）
  useEffect(() => {
    const tint = tintRef.current
    if (!isPlaying || reducedMotion)
      tint?.style.removeProperty('opacity')
    return () => {
      tint?.style.removeProperty('opacity')
    }
  }, [isPlaying, reducedMotion, tintRef])

  useEffect(() => {
    const root = rootRef.current
    if (!root || !isPlaying || reducedMotion || paused)
      return
    const bars = Array.from(root.children) as HTMLElement[]
    const tint = tintRef.current
    let frame = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      const audio = getAudio()
      if (!audio)
        return
      const timeMs = audio.currentTime * 1000
      const ctx = rhythmContext(rhythmModelFor(stateRef.current.trackId))
      bars.forEach((bar, i) => {
        const { weight, lagMs, freq } = BARS[i]
        const level = ctx.model
          ? backgroundLevel(ctx, timeMs - lagMs)
          : 0.5 + 0.5 * Math.sin(timeMs / 1000 * freq + i)
        bar.style.transform = `scaleY(${(0.3 + 0.7 * weight * level).toFixed(3)})`
        bar.style.opacity = ctx.model ? (0.55 + 0.45 * level).toFixed(3) : ''
      })
      if (tint)
        tint.style.opacity = ctx.model ? (BEAT_TINT_OPACITY * backgroundLevel(ctx, timeMs)).toFixed(3) : ''
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [getAudio, isPlaying, paused, reducedMotion, tintRef])

  return (
    <span ref={rootRef} aria-hidden className="flex h-4 items-center gap-[2px]">
      {BARS.map(bar => (
        <span key={bar.freq} className="block h-full w-[2px] origin-center scale-y-50 rounded-full bg-[color:var(--lyric-accent,#fff)]" style={barStyle} />
      ))}
    </span>
  )
}
