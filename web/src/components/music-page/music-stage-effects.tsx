'use client'

import type { BeatGraph, BeatState } from '@/lib/lyrics/audio-beat'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useMusic } from '@/contexts/music-context'
import { beatStep, connectBeatAnalyser, lowEnergy } from '@/lib/lyrics/audio-beat'
import { LYRIC_COLORS } from '@/lib/lyrics/colors'
import { getStageSignals } from '@/lib/lyrics/stage-effects'
import { StageParticles } from '@/lib/lyrics/stage-particles'
import { cn } from '@/lib/utils'

// 背景呼吸与染色的最大不透明度
const PULSE_MAX_OPACITY = 0.22
// 副歌爆发更亮
const BURST_MAX_OPACITY = 0.45
const TINT_MAX_OPACITY = 0.38
// 聚光灯：身后暖光与四周压暗的不透明度（柔和版，只压暗一点，不让画面变黑）
const SPOTLIGHT_WARM_OPACITY = 0.22
const SPOTLIGHT_DIM_OPACITY = 0.18
// 跟随鼓点的呼吸：比歌词强调的呼吸更轻
const BEAT_MAX_OPACITY = 0.12
// 小窗（contained）：粒子缩小、数量减少，种类不变
const CONTAINED_PARTICLES = { scale: 0.7, maxParticles: 80 }

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
// 鼓点呼吸只在桌面端启用：移动端（尤其 iOS）在后台可能挂起 AudioContext，导致全站播放器没有声音
const FINE_POINTER_QUERY = '(pointer: fine)'

function subscribeReducedMotion(listener: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY)
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

/**
 * 播放器的全屏特效（叠在动态背景之上、内容之下）：播放器页铺满视口；contained 时铺满最近的定位祖先（悬浮小窗），粒子缩小、数量减少，种类不变。
 * 背景呼吸（唱到 swell / shake 强调时亮起，每段副歌开唱时更强烈地爆发一次）、背景染色（唱到带颜色的强调时泛起该颜色）、粒子场景（歌词标注的 scene）、
 * 聚光灯（唱到全曲最点题的一句时歌词区中央亮起暖光，歌词引擎同时把这一句移到中央放大）。
 * 背景还会跟随鼓点轻轻呼吸（Web Audio 节拍分析，只在桌面端、网易云歌单时于用户手势中接入，见 audio-beat.ts）；
 * 呼吸的颜色取封面主色（--lyric-accent）。播放器页（非 contained）在副歌开唱时还会「镜头推近」：把推近程度写入父元素的 --stage-push（0 ~ 1），
 * 背景、歌词区与本层各按不同倍数放大（越靠前放大越多，有景深感），见 music-player-page.tsx。
 * 关闭歌词特效或系统要求减少动态效果时不渲染；逐帧更新直接写 DOM / canvas，不触发 React 渲染
 */
export function MusicStageEffects({ contained = false }: { contained?: boolean }) {
  const { lyrics, isPlaying, getAudio, showLyricEffects, audioAnalysable, enableAudioAnalysis } = useMusic()
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(REDUCED_MOTION_QUERY).matches, () => true)
  const enabled = showLyricEffects && !reducedMotion
  const pulseRef = useRef<HTMLDivElement>(null)
  const tintRef = useRef<HTMLDivElement>(null)
  const spotlightRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  // 逐帧循环通过 ref 读取，不随渲染重启
  const stateRef = useRef({ lyrics, isPlaying })
  const beatRef = useRef<{ graph: BeatGraph, state: BeatState } | null>(null)

  useEffect(() => {
    stateRef.current = { lyrics, isPlaying }
  }, [isPlaying, lyrics])

  // 节拍分析：在用户手势中接入（AudioContext 需要手势才能运行），之后每次手势顺便恢复被挂起的 AudioContext
  useEffect(() => {
    if (!enabled || !audioAnalysable || !window.matchMedia(FINE_POINTER_QUERY).matches)
      return
    const onGesture = () => {
      const audio = getAudio()
      if (!audio || !enableAudioAnalysis() || audio.crossOrigin !== 'anonymous')
        return
      const graph = connectBeatAnalyser(audio)
      if (graph && beatRef.current?.graph !== graph)
        beatRef.current = { graph, state: { average: 0, level: 0 } }
    }
    window.addEventListener('pointerdown', onGesture)
    window.addEventListener('keydown', onGesture)
    return () => {
      window.removeEventListener('pointerdown', onGesture)
      window.removeEventListener('keydown', onGesture)
    }
  }, [audioAnalysable, enableAudioAnalysis, enabled, getAudio])

  useEffect(() => {
    const canvas = canvasRef.current
    const pulseEl = pulseRef.current
    const tintEl = tintRef.current
    const spotlightEl = spotlightRef.current
    if (!enabled || !canvas || !pulseEl || !tintEl || !spotlightEl)
      return
    const particles = new StageParticles(canvas, contained ? CONTAINED_PARTICLES : undefined)
    const observer = new ResizeObserver(([entry]) => particles.resize(entry.contentRect.width, entry.contentRect.height))
    observer.observe(canvas)

    let frame = 0
    let last = performance.now()
    let pulseOpacity = ''
    let tintOpacity = ''
    let tintColor = ''
    let push = ''
    let spotlight = ''
    // 镜头推近写到页面根元素上（小窗不推近）
    const pushTarget = contained ? null : rootRef.current?.parentElement ?? null
    const tick = (now: number) => {
      // 切到后台再回来时不一次推进太久
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const { lyrics, isPlaying } = stateRef.current
      const time = getAudio()?.currentTime
      const signals = time == null ? null : getStageSignals(lyrics, time * 1000)

      let beat = 0
      const beatSource = beatRef.current
      if (beatSource && isPlaying && beatSource.graph.context.state === 'running') {
        beatSource.state = beatStep(beatSource.state, lowEnergy(beatSource.graph), dt)
        beat = beatSource.state.level
      }
      const nextPulse = Math.max((signals?.pulse ?? 0) * PULSE_MAX_OPACITY, (signals?.burst ?? 0) * BURST_MAX_OPACITY, beat * BEAT_MAX_OPACITY).toFixed(3)
      if (nextPulse !== pulseOpacity) {
        pulseOpacity = nextPulse
        pulseEl.style.opacity = nextPulse
      }
      const tint = signals?.tint
      const nextTintOpacity = ((tint?.strength ?? 0) * TINT_MAX_OPACITY).toFixed(3)
      if (nextTintOpacity !== tintOpacity) {
        tintOpacity = nextTintOpacity
        tintEl.style.opacity = nextTintOpacity
      }
      // 淡出时保留最后的颜色
      if (tint && LYRIC_COLORS[tint.color] !== tintColor) {
        tintColor = LYRIC_COLORS[tint.color]
        tintEl.style.setProperty('--stage-tint', tintColor)
      }
      const nextSpotlight = (signals?.spotlight ?? 0).toFixed(3)
      if (nextSpotlight !== spotlight) {
        spotlight = nextSpotlight
        spotlightEl.style.opacity = nextSpotlight
      }
      const nextPush = (signals?.push ?? 0).toFixed(3)
      if (pushTarget && nextPush !== push) {
        push = nextPush
        pushTarget.style.setProperty('--stage-push', nextPush)
      }
      particles.update(dt, signals?.scene ?? null, isPlaying)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      particles.clear()
      pulseEl.style.opacity = '0'
      tintEl.style.opacity = '0'
      spotlightEl.style.opacity = '0'
      pushTarget?.style.removeProperty('--stage-push')
    }
  }, [contained, enabled, getAudio])

  if (!enabled)
    return null
  return (
    <div ref={rootRef} aria-hidden className={cn('pointer-events-none inset-0 overflow-hidden [scale:calc(1+var(--stage-push,0)*0.08)]', contained ? 'absolute' : 'fixed')}>
      <div
        ref={tintRef}
        className="absolute inset-0 opacity-0 mix-blend-screen"
        style={{ background: 'radial-gradient(ellipse at 65% 45%, var(--stage-tint, transparent), transparent 70%)' }}
      />
      <div
        ref={pulseRef}
        className="absolute inset-0 opacity-0 mix-blend-soft-light"
        style={{ background: 'radial-gradient(ellipse at 50% 50%, var(--lyric-accent, #fff), transparent 75%)' }}
      />
      {/* 聚光灯：歌词区中央一团暖光（播放器页宽屏时歌词在右侧），四周略微压暗 */}
      <div
        ref={spotlightRef}
        className="absolute inset-0 opacity-0 [--spot-x:50%] lg:[--spot-x:62%]"
        style={{ background: `radial-gradient(42% 30% at ${contained ? '50%' : 'var(--spot-x)'} 50%, rgb(255 236 200 / ${SPOTLIGHT_WARM_OPACITY}), transparent 70%), radial-gradient(75% 60% at 50% 50%, transparent 40%, rgb(0 0 0 / ${SPOTLIGHT_DIM_OPACITY}) 100%)` }}
      />
      <canvas ref={canvasRef} className="absolute inset-0 size-full" />
    </div>
  )
}
