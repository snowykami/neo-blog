import type { RhythmAnalysis } from '@/lib/lyrics/rhythm/analysis'
import type { RhythmModel, RhythmPulse } from '@/lib/lyrics/rhythm/model'

/**
 * 调试面板的波形图（canvas 2D，深色界面）：输入 x(t)、各动效的输出 y(t)、冲激响应 h(t) 与拍速图。
 * 时间轴以当前播放位置为中心、前后各 WINDOW_MS，播放线在中间
 */

export const WINDOW_MS = 3000

const COLORS = {
  text: 'rgb(255 255 255 / 0.85)',
  muted: 'rgb(255 255 255 / 0.5)',
  grid: 'rgb(255 255 255 / 0.09)',
  onset: '#7dd3fc',
  beat: 'rgb(255 255 255 / 0.45)',
  synth: 'rgb(255 255 255 / 0.22)',
  pulse: '#f472b6',
  playhead: 'rgb(255 255 255 / 0.75)',
  tempo: '#a78bfa',
  base: '#fbbf24',
}

const FONT = '11px ui-sans-serif, system-ui, sans-serif'
const TAU = Math.PI * 2

function prepare(canvas: HTMLCanvasElement) {
  const ratio = Math.min(2, window.devicePixelRatio || 1)
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (w === 0 || h === 0)
    return null
  if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
    canvas.width = Math.round(w * ratio)
    canvas.height = Math.round(h * ratio)
  }
  const ctx = canvas.getContext('2d')
  if (!ctx)
    return null
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, w, h)
  ctx.font = FONT
  return { ctx, w, h }
}

function secondGrid(ctx: CanvasRenderingContext2D, x: (t: number) => number, t0: number, t1: number, top: number, bottom: number) {
  ctx.strokeStyle = COLORS.grid
  ctx.lineWidth = 1
  for (let t = Math.ceil(t0 / 1000) * 1000; t <= t1; t += 1000) {
    ctx.beginPath()
    ctx.moveTo(x(t), top)
    ctx.lineTo(x(t), bottom)
    ctx.stroke()
  }
}

function playhead(ctx: CanvasRenderingContext2D, x: number, top: number, bottom: number) {
  ctx.strokeStyle = COLORS.playhead
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x, top)
  ctx.lineTo(x, bottom)
  ctx.stroke()
}

/** 输入：起音强度（有分析结果时）、检测到的拍点（灰，补拍为虚线）与基准脉冲（彩色棒棒糖，高度为 a_k） */
export function drawInput(canvas: HTMLCanvasElement, timeMs: number, model: RhythmModel | null, pulses: RhythmPulse[]) {
  const view = prepare(canvas)
  if (!view)
    return
  const { ctx, w, h } = view
  const t0 = timeMs - WINDOW_MS
  const t1 = timeMs + WINDOW_MS
  const x = (t: number) => (t - t0) / (t1 - t0) * w
  secondGrid(ctx, x, t0, t1, 0, h)
  const analysis = model?.analysis
  if (analysis && analysis.onset.length > 0) {
    ctx.strokeStyle = COLORS.onset
    ctx.lineWidth = 1.2
    ctx.beginPath()
    for (let px = 0; px <= w; px++) {
      const t = t0 + px / w * (t1 - t0)
      const m = Math.round((t - analysis.frameOffsetMs) / analysis.frameMs)
      const v = m >= 0 && m < analysis.onset.length ? analysis.onset[m] : 0
      const y = h - 6 - Math.min(1, v / 5) * h * 0.55
      if (px === 0)
        ctx.moveTo(px, y)
      else ctx.lineTo(px, y)
    }
    ctx.stroke()
    for (const beat of model!.trains.get(0) ?? []) {
      if (beat.t < t0 || beat.t > t1)
        continue
      ctx.strokeStyle = beat.synth ? COLORS.synth : COLORS.beat
      ctx.setLineDash(beat.synth ? [3, 3] : [])
      ctx.beginPath()
      ctx.moveTo(x(beat.t), h * 0.1)
      ctx.lineTo(x(beat.t), h - 4)
      ctx.stroke()
    }
    ctx.setLineDash([])
  }
  ctx.strokeStyle = COLORS.pulse
  ctx.fillStyle = COLORS.pulse
  ctx.lineWidth = 2.5
  for (const pulse of pulses) {
    const top = h - 4 - pulse.a * h * 0.78
    ctx.globalAlpha = pulse.synth ? 0.5 : 1
    ctx.beginPath()
    ctx.moveTo(x(pulse.t), h - 4)
    ctx.lineTo(x(pulse.t), top)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(x(pulse.t), top, 3.2, 0, TAU)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  playhead(ctx, x(timeMs), 0, h)
}

export interface Lane {
  label: string
  color: string
  min: number
  max: number
  value: (t: number) => number
  // 这一栏实际使用的脉冲（底部的短竖线）
  stems: RhythmPulse[]
}

/** 输出：每栏一个动效的 y(t)，底部短竖线为它使用的脉冲 */
export function drawLanes(canvas: HTMLCanvasElement, timeMs: number, lanes: Lane[]) {
  const view = prepare(canvas)
  if (!view || lanes.length === 0)
    return
  const { ctx, w, h } = view
  const t0 = timeMs - WINDOW_MS
  const t1 = timeMs + WINDOW_MS
  const left = 96
  const x = (t: number) => left + (t - t0) / (t1 - t0) * (w - left - 4)
  const laneH = (h - 4) / lanes.length
  secondGrid(ctx, x, t0, t1, 0, h)
  lanes.forEach((lane, index) => {
    const top = 2 + index * laneH
    const bottom = top + laneH - 6
    const y = (v: number) => bottom - (Math.min(lane.max, Math.max(lane.min, v)) - lane.min) / (lane.max - lane.min) * (laneH - 14)
    ctx.fillStyle = COLORS.muted
    ctx.fillText(lane.label.length > 14 ? `${lane.label.slice(0, 13)}…` : lane.label, 6, top + laneH / 2 + 3, left - 10)
    ctx.strokeStyle = COLORS.grid
    ctx.beginPath()
    ctx.moveTo(left, y(0))
    ctx.lineTo(w, y(0))
    ctx.stroke()
    ctx.strokeStyle = lane.color
    ctx.globalAlpha = 0.5
    for (const pulse of lane.stems) {
      if (pulse.t < t0 || pulse.t > t1)
        continue
      ctx.beginPath()
      ctx.moveTo(x(pulse.t), bottom)
      ctx.lineTo(x(pulse.t), bottom - 6 - 6 * pulse.a)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    ctx.lineWidth = 1.8
    ctx.beginPath()
    for (let px = left; px <= w; px += 2) {
      const t = t0 + (px - left) / (w - left - 4) * (t1 - t0)
      const v = lane.value(t)
      if (px === left)
        ctx.moveTo(px, y(v))
      else ctx.lineTo(px, y(v))
    }
    ctx.stroke()
    ctx.lineWidth = 1
  })
  playhead(ctx, x(timeMs), 0, h)
}

export interface KernelPanel {
  title: string
  note: string
  color: string
  min: number
  max: number
  // 多条曲线（如波浪的首字、中间、末字），按顺序逐渐变淡
  curves: ((t: number) => number)[]
}

/** 冲激响应 h(t)：小多图，横轴 −0.6 ~ 1.8 秒，t = 0 为拍点 */
export function drawKernels(canvas: HTMLCanvasElement, panels: KernelPanel[]) {
  const view = prepare(canvas)
  if (!view)
    return
  const { ctx, w, h } = view
  const cols = w > 560 ? 4 : 2
  const rows = Math.ceil(panels.length / cols)
  const pw = w / cols
  const ph = h / rows
  const T0 = -600
  const T1 = 1800
  panels.forEach((panel, index) => {
    const ox = (index % cols) * pw
    const oy = Math.floor(index / cols) * ph
    const x = (t: number) => ox + 6 + (t - T0) / (T1 - T0) * (pw - 12)
    const y = (v: number) => oy + ph - 10 - (v - panel.min) / (panel.max - panel.min) * (ph - 40)
    ctx.fillStyle = COLORS.text
    ctx.fillText(panel.title, ox + 6, oy + 13, pw - 12)
    ctx.fillStyle = COLORS.muted
    ctx.fillText(panel.note, ox + 6, oy + 26, pw - 12)
    ctx.strokeStyle = COLORS.grid
    ctx.beginPath()
    ctx.moveTo(x(T0), y(0))
    ctx.lineTo(x(T1), y(0))
    ctx.moveTo(x(0), oy + 30)
    ctx.lineTo(x(0), oy + ph - 6)
    ctx.stroke()
    ctx.strokeStyle = panel.color
    ctx.lineWidth = 1.8
    panel.curves.forEach((curve, k) => {
      ctx.globalAlpha = 1 - k * 0.3
      ctx.beginPath()
      for (let i = 0; i <= 200; i++) {
        const t = T0 + i / 200 * (T1 - T0)
        if (i === 0)
          ctx.moveTo(x(t), y(curve(t)))
        else ctx.lineTo(x(t), y(curve(t)))
      }
      ctx.stroke()
    })
    ctx.globalAlpha = 1
    ctx.lineWidth = 1
  })
}

/** 拍速：起音强度的自相关 R(τ)（灰）与乘以先验后的 R（紫），粗线为选中的拍速，金色虚线为基准周期 τ_F；顶部标出固定三档 */
export function drawTempo(canvas: HTMLCanvasElement, analysis: RhythmAnalysis, tiers: { label: string, periodMs: number }[]) {
  const view = prepare(canvas)
  if (!view)
    return
  const { ctx, w, h } = view
  const bpmX = (bpm: number) => 8 + Math.log(bpm / 40) / Math.log(240 / 40) * (w - 16)
  const lagBpm = (lag: number) => 60000 / (lag * analysis.frameMs)
  const minLag = Math.floor(250 / analysis.frameMs)
  const maxLag = Math.min(analysis.autocorr.length - 1, Math.ceil(1500 / analysis.frameMs))
  const prior = (lag: number) => Math.exp(-0.5 * Math.log2(lag * analysis.frameMs / 500) ** 2)
  let maxR = 1e-9
  for (let lag = minLag; lag <= maxLag; lag++)
    maxR = Math.max(maxR, analysis.autocorr[lag])
  const y = (v: number) => h - 16 - v / maxR * (h - 30)
  ctx.strokeStyle = COLORS.grid
  ctx.fillStyle = COLORS.muted
  for (const bpm of [40, 60, 80, 100, 120, 160, 200, 240]) {
    ctx.beginPath()
    ctx.moveTo(bpmX(bpm), 14)
    ctx.lineTo(bpmX(bpm), h - 14)
    ctx.stroke()
    ctx.fillText(String(bpm), bpmX(bpm) - 8, h - 3)
  }
  for (const [color, weight] of [[COLORS.muted, () => 1], [COLORS.tempo, prior]] as const) {
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.beginPath()
    for (let lag = minLag; lag <= maxLag; lag++) {
      const px = bpmX(lagBpm(lag))
      const py = y(analysis.autocorr[lag] * weight(lag))
      if (lag === minLag)
        ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.stroke()
  }
  ctx.strokeStyle = COLORS.pulse
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.moveTo(bpmX(analysis.bpm), 14)
  ctx.lineTo(bpmX(analysis.bpm), h - 14)
  ctx.stroke()
  ctx.strokeStyle = COLORS.base
  ctx.lineWidth = 2
  ctx.setLineDash([4, 3])
  const baseBpm = 60000 / analysis.basePeriodMs
  ctx.beginPath()
  ctx.moveTo(bpmX(baseBpm), 14)
  ctx.lineTo(bpmX(baseBpm), h - 14)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.lineWidth = 1
  ctx.fillStyle = COLORS.text
  for (const tier of tiers)
    ctx.fillText(tier.label, bpmX(60000 / tier.periodMs) - 6, 11)
}
