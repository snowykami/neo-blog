'use client'

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useMusic } from '@/contexts/music-context'
import { LYRIC_COLORS } from '@/lib/lyrics/colors'
import { getStageSignals } from '@/lib/lyrics/stage-effects'
import { StageParticles } from '@/lib/lyrics/stage-particles'

// 背景呼吸与染色的最大不透明度
const PULSE_MAX_OPACITY = 0.22
// 副歌爆发更亮
const BURST_MAX_OPACITY = 0.45
const TINT_MAX_OPACITY = 0.38

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeReducedMotion(listener: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY)
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

/**
 * 播放器页的全屏特效（只在 /music 演出，叠在动态背景之上、内容之下）：
 * 背景呼吸（唱到 swell / shake 强调时亮起，每段副歌开唱时更强烈地爆发一次）、背景染色（唱到带颜色的强调时泛起该颜色）、粒子场景（歌词标注的 scene）。
 * 关闭歌词特效或系统要求减少动态效果时不渲染；逐帧更新直接写 DOM / canvas，不触发 React 渲染
 */
export function MusicStageEffects() {
  const { lyrics, isPlaying, getAudio, showLyricEffects } = useMusic()
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(REDUCED_MOTION_QUERY).matches, () => true)
  const enabled = showLyricEffects && !reducedMotion
  const pulseRef = useRef<HTMLDivElement>(null)
  const tintRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // 逐帧循环通过 ref 读取，不随渲染重启
  const stateRef = useRef({ lyrics, isPlaying })

  useEffect(() => {
    stateRef.current = { lyrics, isPlaying }
  }, [isPlaying, lyrics])

  useEffect(() => {
    const canvas = canvasRef.current
    const pulseEl = pulseRef.current
    const tintEl = tintRef.current
    if (!enabled || !canvas || !pulseEl || !tintEl)
      return
    const particles = new StageParticles(canvas)
    const observer = new ResizeObserver(([entry]) => particles.resize(entry.contentRect.width, entry.contentRect.height))
    observer.observe(canvas)

    let frame = 0
    let last = performance.now()
    let pulseOpacity = ''
    let tintOpacity = ''
    let tintColor = ''
    const tick = (now: number) => {
      // 切到后台再回来时不一次推进太久
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const { lyrics, isPlaying } = stateRef.current
      const time = getAudio()?.currentTime
      const signals = time == null ? null : getStageSignals(lyrics, time * 1000)

      const nextPulse = Math.max((signals?.pulse ?? 0) * PULSE_MAX_OPACITY, (signals?.burst ?? 0) * BURST_MAX_OPACITY).toFixed(3)
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
    }
  }, [enabled, getAudio])

  if (!enabled)
    return null
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <div
        ref={tintRef}
        className="absolute inset-0 opacity-0 mix-blend-screen"
        style={{ background: 'radial-gradient(ellipse at 65% 45%, var(--stage-tint, transparent), transparent 70%)' }}
      />
      <div
        ref={pulseRef}
        className="absolute inset-0 opacity-0 mix-blend-soft-light"
        style={{ background: 'radial-gradient(ellipse at 50% 50%, #fff, transparent 75%)' }}
      />
      <canvas ref={canvasRef} className="absolute inset-0 size-full" />
    </div>
  )
}
