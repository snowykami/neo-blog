'use client'

import type { HdrCanvasPresenter } from '@/lib/hdr-canvas'
import type { StageParticleRhythm } from '@/lib/lyrics/stage-particles'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useMusic } from '@/contexts/music-context'
import { useHdrEnabled } from '@/hooks/use-hdr-highlight'
import { createHdrCanvasPresenter } from '@/lib/hdr-canvas'
import { HDR_BRIGHTNESS } from '@/lib/hdr-color'
import { LYRIC_COLORS } from '@/lib/lyrics/colors'
import { backgroundLevel, particleHeartLevel, particlePulses, periodOf, rhythmContext } from '@/lib/lyrics/rhythm/effects'
import { rhythmModelFor } from '@/lib/lyrics/rhythm/source'
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
// 跟随节拍的呼吸：比歌词强调的呼吸更轻
const BEAT_MAX_OPACITY = 0.12
// 两帧之间的进度跳变超过它时视为拖动了进度，不补生成这段时间里的拍
const BEAT_SEEK_GAP_MS = 500
// 小窗（contained）：粒子缩小、数量减少，种类不变
const CONTAINED_PARTICLES = { scale: 0.7, maxParticles: 80 }
// HDR 粒子画布（float16 + WebGPU 输出）的分辨率比例：半分辨率、由 CSS 拉伸，像素数降到 1/4；粒子本身柔和，看不出差别
const HDR_PARTICLE_RESOLUTION = 0.5

// 镜头推近的层：data-stage-push 为推近到底时多放大的比例（背景、歌词区与本层，越靠前越大）
const STAGE_PUSH_SELECTOR = '[data-stage-push]'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeReducedMotion(listener: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY)
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

/**
 * 播放器的全屏特效（叠在动态背景之上、内容之下）：播放器页铺满视口；contained 时铺满最近的定位祖先（悬浮小窗），粒子缩小、数量减少，种类不变。
 * 背景呼吸（唱到 swell / shake 强调时亮起，每段副歌开唱时更强烈地爆发一次）、背景染色（唱到带颜色的强调时泛起该颜色）、粒子场景（歌词标注的 scene）、
 * 聚光灯（唱到全曲最点题的一句时歌词区中央亮起暖光，歌词引擎同时把这一句移到中央放大）。
 * 背景还会跟随节拍轻轻呼吸、离散事件类粒子在拍点成簇出现（节拍预先分析，见 rhythm/；不跟随节拍时背景不呼吸、粒子均匀生成）；
 * 呼吸的颜色取封面主色（--lyric-accent）。播放器页（非 contained）在副歌开唱时还会「镜头推近」：推近程度（0 ~ 1）乘以各层 data-stage-push 的比例后
 * 直接写入这些层的 scale（背景、歌词区与本层，越靠前放大越多，有景深感），见 music-player-page.tsx。
 * 不写成父元素上的 CSS 变量：变量会被整页继承，每帧都要重算整页样式（实测副歌推近期间约 9 ms / 帧）。
 * HDR 高光生效时（只在播放器页），粒子画在不显示的 float16 画布上、亮过 SDR 白，逐帧拷到页面上的 WebGPU canvas 以 HDR 显示（见 lib/hdr-canvas.ts）；
 * 浏览器不支持或 GPU 设备丢失时退回普通 2D canvas。
 * 关闭歌词特效或系统要求减少动态效果时不渲染；逐帧更新直接写 DOM / canvas，不触发 React 渲染。
 * paused 时停在此刻的画面、不再逐帧运行（如顶栏灵动岛的胶囊藏在悬浮播放器后面时），恢复后接着演出
 */
export function MusicStageEffects({ contained = false, paused = false }: { contained?: boolean, paused?: boolean }) {
  const { lyrics, isPlaying, getAudio, showLyricEffects, currentTrack } = useMusic()
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(REDUCED_MOTION_QUERY).matches, () => true)
  const enabled = showLyricEffects && !reducedMotion
  // 不支持 WebGPU 的 HDR 输出或设备丢失后，本次会话退回 2D
  const [gpuFailed, setGpuFailed] = useState(false)
  const hdr = useHdrEnabled() && !contained && !gpuFailed
  const pulseRef = useRef<HTMLDivElement>(null)
  const tintRef = useRef<HTMLDivElement>(null)
  const spotlightRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  // 逐帧循环通过 ref 读取，不随渲染重启
  const stateRef = useRef({ lyrics, isPlaying, trackId: currentTrack?.id ?? null })
  const pausedRef = useRef(paused)
  // 恢复逐帧循环（由下面的循环在启动时写入）
  const resumeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    stateRef.current = { lyrics, isPlaying, trackId: currentTrack?.id ?? null }
  }, [currentTrack?.id, isPlaying, lyrics])

  useEffect(() => {
    pausedRef.current = paused
    if (!paused)
      resumeRef.current?.()
  }, [paused])

  useEffect(() => {
    const canvas = canvasRef.current
    const pulseEl = pulseRef.current
    const tintEl = tintRef.current
    const spotlightEl = spotlightRef.current
    if (!enabled || !canvas || !pulseEl || !tintEl || !spotlightEl)
      return
    // HDR：粒子画在不显示的画布上，WebGPU 输出就绪后逐帧拷到页面上的 canvas；就绪前不显示粒子
    const drawCanvas = hdr ? document.createElement('canvas') : canvas
    let presenter: HdrCanvasPresenter | null = null
    const abort = new AbortController()
    const particles = new StageParticles(drawCanvas, {
      ...(contained ? CONTAINED_PARTICLES : {}),
      ...(hdr ? { hdrGain: HDR_BRIGHTNESS.particles, resolution: HDR_PARTICLE_RESOLUTION } : {}),
    })
    // 粒子画布空闲释放时 HDR 输出一并释放，恢复时重新配置（见 StageParticles.suspended）
    let outputSuspended = false
    const syncOutput = () => {
      if (!presenter || particles.suspended === outputSuspended)
        return
      outputSuspended = particles.suspended
      presenter.setSuspended(outputSuspended)
      if (!outputSuspended)
        presenter.resize(drawCanvas.width, drawCanvas.height)
    }
    if (hdr) {
      void createHdrCanvasPresenter(canvas, () => setGpuFailed(true), abort.signal).then((created) => {
        if (abort.signal.aborted)
          return
        if (!created) {
          setGpuFailed(true)
          return
        }
        presenter = created
        presenter.resize(drawCanvas.width, drawCanvas.height)
      })
    }
    const observer = new ResizeObserver(([entry]) => {
      particles.resize(entry.contentRect.width, entry.contentRect.height)
      if (!outputSuspended)
        presenter?.resize(drawCanvas.width, drawCanvas.height)
    })
    observer.observe(canvas)

    let frame = 0
    let last = performance.now()
    let lastTimeMs: number | null = null
    let pulseOpacity = ''
    let tintOpacity = ''
    let tintColor = ''
    let push = 0
    let spotlight = ''
    // 镜头推近作用于页面中标了 data-stage-push 的层（小窗不推近）；每次推近开始时重新查找，推近期间复用
    const pushRoot = contained ? null : rootRef.current?.parentElement ?? null
    let pushTargets: HTMLElement[] = []
    const writePush = (value: number) => {
      if (push === 0)
        pushTargets = pushRoot ? Array.from(pushRoot.querySelectorAll<HTMLElement>(STAGE_PUSH_SELECTOR)) : []
      push = value
      for (const el of pushTargets)
        el.style.scale = value > 0 ? (1 + value * (Number(el.dataset.stagePush) || 0)).toFixed(4) : ''
    }
    const tick = (now: number) => {
      frame = 0
      if (pausedRef.current)
        return
      // 切到后台再回来时不一次推进太久
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const { lyrics, isPlaying, trackId } = stateRef.current
      const time = getAudio()?.currentTime
      const timeMs = time == null ? null : time * 1000
      const model = rhythmModelFor(trackId)
      const signals = timeMs == null ? null : getStageSignals(lyrics, timeMs, model)

      // 跟随节拍：背景随拍呼吸；粒子取上一帧到这一帧之间经过的拍（拖动进度时不补）
      const rhythm = rhythmContext(lyrics.pace, model)
      const beat = timeMs == null ? 0 : backgroundLevel(rhythm, timeMs)
      const since = lastTimeMs
      lastTimeMs = timeMs
      const particleRhythm: StageParticleRhythm | null = timeMs == null || since == null || timeMs <= since || timeMs - since > BEAT_SEEK_GAP_MS
        ? null
        : {
            pulses: (octave) => {
              const pulses = particlePulses(rhythm, octave, since, timeMs)
              return pulses && { pulses, periodMs: periodOf(rhythm, rhythm.params.particles.octave + octave) }
            },
            heart: particleHeartLevel(rhythm, timeMs),
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
      const nextPush = Math.round((signals?.push ?? 0) * 1000) / 1000
      if (pushRoot && nextPush !== push)
        writePush(nextPush)
      const drew = particles.update(dt, signals?.scene ?? null, isPlaying, particleRhythm)
      syncOutput()
      if (drew)
        presenter?.present(drawCanvas)
      frame = requestAnimationFrame(tick)
    }
    const resume = () => {
      if (frame)
        return
      last = performance.now()
      frame = requestAnimationFrame(tick)
    }
    resumeRef.current = resume
    resume()
    return () => {
      resumeRef.current = null
      cancelAnimationFrame(frame)
      observer.disconnect()
      particles.clear()
      abort.abort()
      presenter?.dispose()
      pulseEl.style.opacity = '0'
      tintEl.style.opacity = '0'
      spotlightEl.style.opacity = '0'
      pushTargets.forEach(el => el.style.removeProperty('scale'))
    }
  }, [contained, enabled, getAudio, hdr])

  if (!enabled)
    return null
  return (
    <div
      ref={rootRef}
      aria-hidden
      data-stage-push={contained ? undefined : 0.08}
      className={cn('pointer-events-none inset-0 overflow-hidden', contained ? 'absolute' : 'fixed will-change-[scale]')}
    >
      {/* 三层的透明度逐帧变化：各自提升为合成层，只改合成参数，不必每帧重新光栅化整屏渐变 */}
      <div
        ref={tintRef}
        className="absolute inset-0 opacity-0 mix-blend-screen will-change-[opacity]"
        style={{ background: 'radial-gradient(ellipse at 65% 45%, var(--stage-tint, transparent), transparent 70%)' }}
      />
      <div
        ref={pulseRef}
        className="absolute inset-0 opacity-0 mix-blend-soft-light will-change-[opacity]"
        style={{ background: 'radial-gradient(ellipse at 50% 50%, var(--lyric-accent, #fff), transparent 75%)' }}
      />
      {/* 聚光灯：歌词区中央一团暖光（播放器页宽屏时歌词在右侧），四周略微压暗 */}
      <div
        ref={spotlightRef}
        className="absolute inset-0 opacity-0 will-change-[opacity] [--spot-x:50%] lg:[--spot-x:62%]"
        style={{ background: `radial-gradient(42% 30% at ${contained ? '50%' : 'var(--spot-x)'} 50%, rgb(255 236 200 / ${SPOTLIGHT_WARM_OPACITY}), transparent 70%), radial-gradient(75% 60% at 50% 50%, transparent 40%, rgb(0 0 0 / ${SPOTLIGHT_DIM_OPACITY}) 100%)` }}
      />
      {/* key：HDR 与 2D 是不同的上下文，同一个 canvas 元素取过一种就不能再换，切换时换一个新元素 */}
      <canvas key={hdr ? 'hdr' : '2d'} ref={canvasRef} className="absolute inset-0 size-full" />
    </div>
  )
}
