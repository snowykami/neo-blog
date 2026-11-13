'use client'

import type { Lane } from './charts'
import type { DebugEffect, FormulaSection } from './formulas'
import type { FixedLyricPace } from '@/lib/lyrics/pace'
import type { RhythmParams } from '@/lib/lyrics/rhythm/params'
import type { LyricEffect, LyricEmphasis, ResolvedLyrics } from '@/lib/lyrics/types'
import katex from 'katex'
import { ChevronDownIcon, RotateCcwIcon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useMusic, useMusicClockStore } from '@/contexts/music-context'
import { FIXED_LYRIC_PACES, PACE } from '@/lib/lyrics/pace'
import { periodOf, pulsesIn, rhythmContext } from '@/lib/lyrics/rhythm/effects'
import { basePeriodOf, getRhythmParams, PULSE_OCTAVES, resetRhythmParams, setRhythmParams, subscribeRhythmParams } from '@/lib/lyrics/rhythm/params'
import { getRhythmState, subscribeRhythm } from '@/lib/lyrics/rhythm/source'
import { buildTimeline } from '@/lib/lyrics/timeline'
import { drawInput, drawKernels, drawLanes, drawTempo, WINDOW_MS } from './charts'
import { formulasFor, octaveOf } from './formulas'
import { backgroundTrace, emphasisTrace, interludeTrace, kernelCurves } from './levels'
import 'katex/dist/katex.min.css'

/**
 * 播放器页的韵律调试面板（所有人可见）：节拍分析的状态、输入 x(t) / 输出 y(t) / 系统 h(t) / 拍速四张图（随播放实时滚动），
 * 当前位置演出的动效与它的公式（简单版，展开为代入当前参数的完整版），以及专业模式下临时调整参数（只在当前页面生效）。
 * 波形图与实时数值在逐帧循环中直接绘制，不触发 React 渲染；当前动效随播放时钟（约每秒 4 次）更新
 */

const RHYTHM_EFFECTS = new Set<LyricEffect>(['heartbeat', 'swell', 'glow', 'wave', 'shake', 'shimmer'])
const SECTIONS: FormulaSection[] = ['period', 'input', 'output', 'system', 'mapping']
const KERNEL_ORDER: DebugEffect[] = ['heartbeat', 'swell', 'glow', 'wave', 'shake', 'shimmer', 'interlude', 'background']
const COLORS: Record<DebugEffect, string> = {
  heartbeat: '#f87171',
  swell: '#fbbf24',
  glow: '#facc15',
  wave: '#2dd4bf',
  shake: '#fb923c',
  shimmer: '#a78bfa',
  interlude: '#60a5fa',
  background: '#22d3ee',
}

interface Focus {
  key: string
  effect: DebugEffect
  // 歌词标注里的特效（可能不跟随节拍，如消散），没有强调时为 null
  lyricEffect: LyricEffect | null
  group: LyricEmphasis | null
  text: string
  count: number
  lineEnd: number
  interlude: { start: number, end: number } | null
}

const BACKGROUND_FOCUS: Focus = { key: 'background', effect: 'background', lyricEffect: null, group: null, text: '', count: 0, lineEnd: 0, interlude: null }

/** 当前位置的动效：正在演出（开唱前 0.3 秒到唱完后 0.6 秒）的强调中最近开始的一组；没有时为间奏或背景呼吸 */
function findFocus(lyrics: ResolvedLyrics, interludes: { start: number, end: number }[], timeMs: number): Focus {
  let best: { group: LyricEmphasis, line: ResolvedLyrics['lines'][number] } | null = null
  for (const line of lyrics.lines) {
    if (line.start - 300 > timeMs)
      break
    for (const group of line.emphasis ?? []) {
      if (group.start - 300 <= timeMs && timeMs <= Math.max(group.end, line.end) + 600 && (!best || group.start > best.group.start))
        best = { group, line }
    }
  }
  if (best) {
    const text = best.line.words.slice(best.group.from, best.group.to).map(word => word.text).join('')
    const rhythmic = RHYTHM_EFFECTS.has(best.group.effect)
    return {
      key: `${best.group.start}-${best.group.effect}`,
      effect: rhythmic ? best.group.effect as DebugEffect : 'background',
      lyricEffect: best.group.effect,
      group: best.group,
      text,
      count: Math.max(1, [...text].length),
      lineEnd: best.line.end,
      interlude: null,
    }
  }
  const interlude = interludes.find(item => timeMs >= item.start && timeMs < item.end)
  if (interlude)
    return { ...BACKGROUND_FOCUS, key: `interlude-${interlude.start}`, effect: 'interlude', interlude }
  return BACKGROUND_FOCUS
}

function Tex({ tex }: { tex: string }) {
  // 公式由本面板生成（不含用户输入），KaTeX 输出的 HTML 可以直接插入；
  // 面板较窄，按顶层的「,\quad」「;\quad」分成多行并左对齐，单行仍放不下时横向滚动
  const html = useMemo(() => tex
    .split(/[,;]\s*\\q?quad\s*/)
    .filter(part => part.trim().length > 0)
    .map(part => katex.renderToString(part, { displayMode: true, fleqn: true, throwOnError: false, strict: 'ignore', output: 'html' }))
    .join(''), [tex])
  return <div className="overflow-x-auto overflow-y-hidden py-1 text-[0.9em] [&_.katex-display]:my-0.5" dangerouslySetInnerHTML={{ __html: html }} />
}

interface ParamDef {
  key: string
  label: string
  min: number
  max: number
  step: number
  value: number
  format: (value: number) => string
  apply: (value: number) => Partial<RhythmParams>
}

function ParamSlider({ def }: { def: ParamDef }) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-white/70">{def.label}</span>
        <span className="font-mono text-white/90 tabular-nums">{def.format(def.value)}</span>
      </div>
      <Slider value={[def.value]} min={def.min} max={def.max} step={def.step} onValueChange={([value]) => setRhythmParams(def.apply(value))} aria-label={def.label} />
    </div>
  )
}

const msFormat = (value: number) => `${Math.round(value)} ms`
const fixed = (digits: number) => (value: number) => value.toFixed(digits)

/** 基准脉冲八度的短标签（×1 为分析得到的 τ_F 本身）与它对应的拍速 */
const PULSE_FACTOR: Record<number, string> = { [-2]: '×¼', [-1]: '×½', 0: '×1', 1: '×2', 2: '×4' }
const bpmText = (periodMs: number) => String(Number((60000 / periodMs).toFixed(1)))

export default function RhythmDebugPanel({ onClose }: { onClose: () => void }) {
  const t = useTranslations('RhythmDebug')
  const { lyrics, currentTrack, getAudio } = useMusic()
  const clock = useMusicClockStore()
  const trackId = currentTrack?.id ?? null
  const rhythmState = useSyncExternalStore(subscribeRhythm, () => getRhythmState(trackId), () => null)
  const params = useSyncExternalStore(subscribeRhythmParams, getRhythmParams, getRhythmParams)
  const model = rhythmState?.status === 'ready' ? rhythmState.model : null
  const interludes = useMemo(() => buildTimeline(lyrics.lines).flatMap(item => (item.kind === 'interlude' ? [{ start: item.start, end: item.end }] : [])), [lyrics.lines])
  const [focus, setFocus] = useState<Focus>(BACKGROUND_FOCUS)
  const [expanded, setExpanded] = useState(false)
  const [pro, setPro] = useState(false)
  const inputRef = useRef<HTMLCanvasElement>(null)
  const lanesRef = useRef<HTMLCanvasElement>(null)
  const kernelsRef = useRef<HTMLCanvasElement>(null)
  const tempoRef = useRef<HTMLCanvasElement>(null)
  const liveRef = useRef<HTMLSpanElement>(null)

  // 当前动效随播放时钟更新（同一组时不重新渲染）
  useEffect(() => {
    const update = () => {
      const timeMs = (getAudio()?.currentTime ?? 0) * 1000
      const next = findFocus(lyrics, interludes, timeMs)
      setFocus(previous => (previous.key === next.key ? previous : next))
    }
    update()
    return clock.subscribe(update)
  }, [clock, getAudio, interludes, lyrics])

  // 动效快慢只有节拍一个来源：标注不再指定节奏，focus 与全曲用同一个上下文
  const songContext = rhythmContext(model, params)
  const focusContext = songContext
  const formulas = formulasFor(focus.effect, focusContext)
  const effectName = (effect: LyricEffect | DebugEffect) => t(`effects.${effect}`)
  // 输出栏：当前动效（或间奏）与背景呼吸；逐帧循环通过 ref 读取最新的组合
  const laneOf = useRef<(timeMs: number) => Lane[]>(() => [])
  const focusLabel = focus.group && focus.effect !== 'background' ? `${effectName(focus.effect)} ${focus.text}` : ''
  const interludeLabel = effectName('interlude')
  const backgroundLabel = effectName('background')
  useEffect(() => {
    laneOf.current = (timeMs: number) => {
      const lanes: Lane[] = []
      const add = (label: string, color: string, trace: ReturnType<typeof backgroundTrace>) => lanes.push({ label, color, min: trace.min, max: trace.max, value: trace.value, stems: trace.stems(timeMs - WINDOW_MS, timeMs + WINDOW_MS) })
      if (focus.group && focus.effect !== 'background')
        add(focusLabel, COLORS[focus.effect], emphasisTrace(focus.effect, focusContext, focus.group, focus.count, focus.lineEnd))
      if (focus.interlude)
        add(interludeLabel, COLORS.interlude, interludeTrace(songContext, focus.interlude.start, focus.interlude.end))
      add(backgroundLabel, COLORS.background, backgroundTrace(songContext))
      return lanes
    }
  })

  // 输入与输出随播放绘制：限制在约 30fps，图表不需要跟满屏幕刷新率，减轻与歌词动画抢主线程
  useEffect(() => {
    let frame = 0
    let lastDraw = 0
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      if (now - lastDraw < 32)
        return
      lastDraw = now
      const timeMs = (getAudio()?.currentTime ?? 0) * 1000
      const ctx = rhythmContext(model)
      if (inputRef.current)
        drawInput(inputRef.current, timeMs, model, pulsesIn(ctx, 0, 0, timeMs - WINDOW_MS, timeMs + WINDOW_MS))
      const lanes = laneOf.current(timeMs)
      if (lanesRef.current)
        drawLanes(lanesRef.current, timeMs, lanes)
      if (liveRef.current) {
        const value = lanes[0]?.value(timeMs) ?? 0
        const text = `y(t) = ${value.toFixed(3)}`
        if (liveRef.current.textContent !== text)
          liveRef.current.textContent = text
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [getAudio, model])

  // 冲激响应与拍速图只在参数、档位或分析结果变化时重画
  const kernelTitles = KERNEL_ORDER.map(effect => effectName(effect)).join('|')
  useEffect(() => {
    const canvas = kernelsRef.current
    if (!canvas)
      return
    const curves = kernelCurves(focusContext)
    const draw = () => drawKernels(canvas, KERNEL_ORDER.map((effect, i) => ({
      title: kernelTitles.split('|')[i],
      note: `n=${octaveOf(effect, focusContext)} · Tₑ=${(curves[effect].Te / 1000).toFixed(2)}s`,
      color: COLORS[effect],
      min: curves[effect].min,
      max: curves[effect].max,
      curves: curves[effect].curves,
    })))
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [focusContext, kernelTitles])

  const tierLabels = `${t('paces.slow')}|${t('paces.medium')}|${t('paces.fast')}`
  useEffect(() => {
    const canvas = tempoRef.current
    if (!canvas || !model)
      return
    const [slow, medium, fast] = tierLabels.split('|')
    const pulse = PULSE_OCTAVES.map(octave => ({ bpm: 60000 / (model.analysis.basePeriodMs * 2 ** octave), selected: octave === params.pulseOctave }))
    const draw = () => drawTempo(canvas, model.analysis, [{ label: slow, periodMs: PACE.basePeriod.slow }, { label: medium, periodMs: PACE.basePeriod.medium }, { label: fast, periodMs: PACE.basePeriod.fast }], pulse)
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [model, tierLabels, params.pulseOctave])

  // 分析状态
  let status = t('status_idle')
  if (rhythmState?.status === 'loading') {
    status = t('status_loading', { progress: Math.round(rhythmState.progress * 100) })
  }
  else if (rhythmState?.status === 'ready') {
    const analysis = rhythmState.model.analysis
    status = rhythmState.model.reliable
      ? t('status_ready', { bpm: analysis.bpm.toFixed(1), pulse: (60000 / basePeriodOf(analysis.basePeriodMs, params)).toFixed(1), confidence: analysis.confidence.toFixed(2), seconds: (rhythmState.elapsedMs / 1000).toFixed(1) })
      : t('status_unreliable', { confidence: analysis.confidence.toFixed(2), min: params.minConfidence.toFixed(2) })
  }
  else if (rhythmState?.status === 'unavailable') {
    status = t('status_unavailable', { reason: t(`reasons.${rhythmState.reason}`) })
  }
  const fellBack = params.preview === null && focusContext.pace !== 'beat'
  // 拍速的八度歧义：以 τ_F 为 ×1 列出可选的基准脉冲（T_b = 2^n·τ_F），选中即改写整曲的拍点层级与动效周期。
  // 试听档位不吃分析结果，此时不展示
  const beatAnalysis = model?.analysis
  const pulseChoices = beatAnalysis && params.preview === null
    ? PULSE_OCTAVES.map(octave => ({ octave, periodMs: beatAnalysis.basePeriodMs * 2 ** octave }))
    : []

  // 专业模式：通用参数 + 当前动效的参数
  const octaveDef = (group: 'heartbeat' | 'swell' | 'glow' | 'wave' | 'shake' | 'shimmer' | 'background', value: number): ParamDef => ({
    key: `${group}.octave`,
    label: t('params.octave'),
    min: -2,
    max: 2,
    step: 1,
    value,
    format: v => String(v),
    apply: v => ({ [group]: { ...params[group], octave: v } }),
  })
  const effectDefs: Record<DebugEffect, ParamDef[]> = {
    heartbeat: [
      octaveDef('heartbeat', params.heartbeat.octave),
      { key: 'hb.attack', label: t('params.attack'), min: 20, max: 160, step: 5, value: params.heartbeat.attackMs, format: msFormat, apply: v => ({ heartbeat: { ...params.heartbeat, attackMs: v } }) },
      { key: 'hb.beta', label: t('params.beta'), min: 0, max: 1, step: 0.05, value: params.heartbeat.beta, format: fixed(2), apply: v => ({ heartbeat: { ...params.heartbeat, beta: v } }) },
      { key: 'hb.delay', label: t('params.delay_ratio'), min: 0.1, max: 0.6, step: 0.02, value: params.heartbeat.delayRatio, format: fixed(2), apply: v => ({ heartbeat: { ...params.heartbeat, delayRatio: v } }) },
    ],
    swell: [
      octaveDef('swell', params.swell.octave),
      { key: 'sw.tau', label: t('params.tau'), min: 20, max: 200, step: 5, value: params.swell.tauMs, format: msFormat, apply: v => ({ swell: { ...params.swell, tauMs: v } }) },
      { key: 'sw.gain', label: t('params.gain'), min: 0, max: 2, step: 0.05, value: params.swell.gain, format: fixed(2), apply: v => ({ swell: { ...params.swell, gain: v } }) },
    ],
    glow: [octaveDef('glow', params.glow.octave)],
    wave: [
      octaveDef('wave', params.wave.octave),
      { key: 'wv.width', label: t('params.width'), min: 0.2, max: 1, step: 0.05, value: params.wave.widthRatio, format: fixed(2), apply: v => ({ wave: { ...params.wave, widthRatio: v } }) },
    ],
    shake: [
      octaveDef('shake', params.shake.octave),
      { key: 'sk.decay', label: t('params.decay'), min: 40, max: 400, step: 10, value: params.shake.decayMs, format: msFormat, apply: v => ({ shake: { ...params.shake, decayMs: v } }) },
      { key: 'sk.carrier', label: t('params.carrier'), min: 4, max: 32, step: 1, value: params.shake.carrierDivisor, format: fixed(0), apply: v => ({ shake: { ...params.shake, carrierDivisor: v } }) },
    ],
    shimmer: [
      octaveDef('shimmer', params.shimmer.octave),
      { key: 'sm.sweeps', label: t('params.sweeps'), min: 1, max: 4, step: 1, value: params.shimmer.sweeps, format: fixed(0), apply: v => ({ shimmer: { ...params.shimmer, sweeps: v } }) },
    ],
    background: [
      octaveDef('background', params.background.octave),
      { key: 'bg.attack', label: t('params.attack'), min: 5, max: 100, step: 5, value: params.background.attackMs, format: msFormat, apply: v => ({ background: { ...params.background, attackMs: v } }) },
      { key: 'bg.decay', label: t('params.decay'), min: 50, max: 500, step: 10, value: params.background.decayMs, format: msFormat, apply: v => ({ background: { ...params.background, decayMs: v } }) },
    ],
    interlude: [
      { key: 'il.target', label: t('params.target'), min: 500, max: 4000, step: 100, value: params.interlude.targetMs, format: msFormat, apply: v => ({ interlude: { ...params.interlude, targetMs: v } }) },
      { key: 'il.inhale', label: t('params.inhale'), min: 1, max: 1.5, step: 0.05, value: params.interlude.inhale, format: fixed(2), apply: v => ({ interlude: { ...params.interlude, inhale: v } }) },
      { key: 'il.exhale', label: t('params.exhale'), min: 0.6, max: 1, step: 0.05, value: params.interlude.exhale, format: fixed(2), apply: v => ({ interlude: { ...params.interlude, exhale: v } }) },
    ],
  }
  const globalDefs: ParamDef[] = [
    { key: 'lead', label: t('params.lead'), min: -60, max: 120, step: 5, value: params.leadMs, format: msFormat, apply: v => ({ leadMs: v }) },
    { key: 'accent', label: t('params.accent_min'), min: 0, max: 1, step: 0.05, value: params.accentMin, format: fixed(2), apply: v => ({ accentMin: v }) },
    { key: 'confidence', label: t('params.min_confidence'), min: 0, max: 0.5, step: 0.01, value: params.minConfidence, format: fixed(2), apply: v => ({ minConfidence: v }) },
  ]

  return (
    <aside
      aria-label={t('title')}
      // 不用背景模糊：面板后面的歌词每帧都在动，模糊需要每帧重新计算
      className="fixed inset-x-3 top-16 bottom-3 z-30 flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-neutral-950/90 text-white shadow-2xl sm:inset-x-auto sm:right-4 sm:w-[30rem]"
    >
      <header className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="grid gap-0.5">
          <h2 className="text-sm font-semibold">{t('title')}</h2>
          <p className="text-xs text-white/60">{t('subtitle')}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={t('close')} className="rounded-full p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white">
          <XIcon aria-hidden className="size-4" />
        </button>
      </header>

      <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-4 py-3">
        <section className="grid gap-2 text-xs">
          <p className="text-white/80">{status}</p>
          <p className="text-white/60">
            {t('effective', { pace: t(`paces.${focusContext.pace}`) })}
            {fellBack && t('fallback_note')}
            {' · '}
            {`T_b = ${(focusContext.base / 1000).toFixed(3)} s · T_e = ${(periodOf(focusContext, octaveOf(focus.effect, focusContext)) / 1000).toFixed(3)} s`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-xs text-white/60">{t('preview')}</Label>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={params.preview ?? 'auto'}
              onValueChange={value => value && setRhythmParams({ preview: value === 'auto' ? null : value as FixedLyricPace })}
            >
              <ToggleGroupItem value="auto" className="px-2.5 text-xs">{t('preview_auto')}</ToggleGroupItem>
              {FIXED_LYRIC_PACES.map(pace => <ToggleGroupItem key={pace} value={pace} className="px-2.5 text-xs">{t(`paces.${pace}`)}</ToggleGroupItem>)}
            </ToggleGroup>
          </div>
          {pulseChoices.length > 0 && (
            <div className="grid gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Label className="text-xs text-white/60">{t('pulse')}</Label>
                <ToggleGroup
                  type="single"
                  size="sm"
                  variant="outline"
                  value={String(params.pulseOctave)}
                  onValueChange={value => value && setRhythmParams({ pulseOctave: Number(value) })}
                >
                  {pulseChoices.map(choice => (
                    <ToggleGroupItem key={choice.octave} value={String(choice.octave)} className="px-2.5 text-xs tabular-nums">
                      {`${PULSE_FACTOR[choice.octave]} · ${bpmText(choice.periodMs)}`}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
              {params.pulseOctave < 0 && <p className="text-white/50">{t('pulse_note')}</p>}
            </div>
          )}
        </section>

        <section className="grid gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-xs font-semibold text-white/80">{t('current')}</h3>
            <span ref={liveRef} className="font-mono text-xs text-white/70 tabular-nums" />
          </div>
          <p className="text-sm">
            {focus.lyricEffect && !RHYTHM_EFFECTS.has(focus.lyricEffect)
              ? t('not_rhythmic', { effect: effectName(focus.lyricEffect) })
              : focus.group
                ? (
                    <>
                      <span style={{ color: COLORS[focus.effect] }}>{effectName(focus.effect)}</span>
                      <span className="text-white/70">{`「${focus.text}」`}</span>
                    </>
                  )
                : focus.interlude ? t('current_interlude') : t('current_background')}
          </p>
          <div className="rounded-lg bg-white/5 px-2">
            <Tex tex={formulas.simple} />
          </div>
          <Collapsible open={expanded} onOpenChange={setExpanded}>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-white/70 hover:text-white">
              <ChevronDownIcon aria-hidden className={`size-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
              {expanded ? t('formula_collapse') : t('formula_expand')}
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 grid gap-2">
              {SECTIONS.map((section) => {
                const item = formulas.full.find(entry => entry.section === section)
                return item && (
                  <div key={section} className="grid gap-0.5">
                    <span className="text-[11px] text-white/50">{t(`sections.${section}`)}</span>
                    <div className="rounded-lg bg-white/5 px-2"><Tex tex={item.tex} /></div>
                  </div>
                )
              })}
            </CollapsibleContent>
          </Collapsible>
        </section>

        <section className="grid gap-1">
          <h3 className="text-xs font-semibold text-white/80">{t('chart_input')}</h3>
          <canvas ref={inputRef} className="h-20 w-full rounded-lg bg-white/5" />
          <p className="text-[11px] text-white/50">{t('chart_input_hint')}</p>
        </section>
        <section className="grid gap-1">
          <h3 className="text-xs font-semibold text-white/80">{t('chart_output')}</h3>
          <canvas ref={lanesRef} className="h-32 w-full rounded-lg bg-white/5" />
        </section>
        <section className="grid gap-1">
          <h3 className="text-xs font-semibold text-white/80">{t('chart_kernels')}</h3>
          <canvas ref={kernelsRef} className="h-56 w-full rounded-lg bg-white/5" />
          <p className="text-[11px] text-white/50">{t('chart_kernels_hint')}</p>
        </section>
        {model && (
          <section className="grid gap-1">
            <h3 className="text-xs font-semibold text-white/80">{t('chart_tempo')}</h3>
            <canvas ref={tempoRef} className="h-28 w-full rounded-lg bg-white/5" />
            <p className="text-[11px] text-white/50">{t('chart_tempo_hint')}</p>
          </section>
        )}

        <section className="grid gap-3 border-t border-white/10 pt-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="rhythm-pro" className="text-xs font-semibold text-white/80">{t('pro')}</Label>
            <Switch id="rhythm-pro" checked={pro} onCheckedChange={setPro} />
          </div>
          {pro && (
            <>
              <p className="text-[11px] text-white/50">{t('pro_hint')}</p>
              {[...globalDefs, ...effectDefs[focus.effect]].map(def => <ParamSlider key={def.key} def={def} />)}
              <div className="grid gap-1.5">
                <span className="text-xs text-white/70">{t('params.fallback')}</span>
                <ToggleGroup type="single" size="sm" variant="outline" value={params.fallback} onValueChange={value => value && setRhythmParams({ fallback: value as RhythmParams['fallback'] })}>
                  {(['slow', 'medium', 'fast'] as const).map(pace => <ToggleGroupItem key={pace} value={pace} className="px-3 text-xs">{t(`paces.${pace}`)}</ToggleGroupItem>)}
                </ToggleGroup>
              </div>
              <button type="button" onClick={resetRhythmParams} className="inline-flex items-center gap-1.5 justify-self-start rounded-full bg-white/10 px-3 py-1.5 text-xs transition-colors hover:bg-white/20">
                <RotateCcwIcon aria-hidden className="size-3.5" />
                {t('reset')}
              </button>
            </>
          )}
        </section>
      </div>
    </aside>
  )
}
