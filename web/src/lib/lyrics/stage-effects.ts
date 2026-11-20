import type { RhythmModel } from './rhythm/model'
import type { LyricAlign, LyricColor, LyricLine, LyricSceneName, LyricSprite, ResolvedLyrics } from './types'
import { LYRIC_SCENES } from './annotation-options'
import { swellCurve } from './easing'
import { getLyricLineAlign } from './line-utils'
import { envelopeScale, heartbeatLevel, rhythmContext } from './rhythm/effects'
import { shatterFlash } from './word-effects'

const KNOWN_LYRIC_SCENES = new Set<string>(LYRIC_SCENES)

/**
 * 播放器页的全屏特效信号（纯函数，由 MusicStageEffects 每帧调用）：
 * - pulse 背景呼吸：唱到 swell / shake 强调时随起落曲线亮起，强度取 factor
 * - tint 背景染色：唱到带颜色的强调时，背景泛起该颜色，唱完后慢慢淡出
 * - burst 副歌爆发：每段副歌的第一行开唱时迅速亮起，再慢慢回落
 * - push 镜头推近：同样在副歌第一行开唱时触发，约 0.45 秒推近、2.6 秒缓缓回落（由页面换算成背景与歌词区的放大）
 * - 心跳强调（heartbeat）让背景随双拍跳动；破碎（shatter）碎的一瞬间背景闪一下
 * - scene 粒子场景（含颜色主题）：从标了 scene 的行开始，持续这一行的 sceneLines 行（模型按意象的段落给出，旧标注没有时为 SCENE_MAX_LINES），
 *   或到下一个标了 scene 的行为止；最后一行唱完后结束
 * - spotlight 聚光灯：唱到全曲最点题的句子（1～3 句，每次出现）时身后亮起暖光、四周略微压暗（与歌词引擎的聚光灯共用 spotlightAt）
 */

export interface StageVocalBias {
  align: LyricAlign
  color: LyricColor
  strength: number
}

export interface StageSignals {
  pulse: number
  burst: number
  push: number
  spotlight: number
  tint: { color: LyricColor, strength: number } | null
  vocal: StageVocalBias | null
  scene: StageScene | null
}

export interface StageScene {
  name: LyricSceneName
  // 颜色主题，null 为场景默认色
  color: LyricColor | null
  // 自定义粒子（name 为 custom:<name> 时）
  sprite?: LyricSprite
}

// 演出时长下限（与歌词引擎的强调一致）、染色淡入与淡出时长
const PULSE_MIN_MS = 1000
const TINT_ATTACK_MS = 300
const TINT_RELEASE_MS = 1500
// 副歌爆发的亮起与回落时长
const BURST_ATTACK_MS = 200
const BURST_RELEASE_MS = 1800
// 镜头推近的推近与回落时长
const PUSH_ATTACK_MS = 450
const PUSH_RELEASE_MS = 2600
// 聚光灯：提前于开唱亮起的时长、亮起时长、唱完后回落的时长
const SPOTLIGHT_LEAD_MS = 200
const SPOTLIGHT_ATTACK_MS = 500
const SPOTLIGHT_RELEASE_MS = 600
// 粒子场景持续的行数（含标注行）
export const SCENE_MAX_LINES = 8
// 多声部方向性洗光相对于短语级染色的柔和系数（有更强短语染色时让位）
export const VOCAL_TINT_FACTOR = 0.42

const NO_SIGNALS: StageSignals = { pulse: 0, burst: 0, push: 0, spotlight: 0, tint: null, vocal: null, scene: null }
const CHORUS_EFFECT_WINDOW = Math.max(BURST_ATTACK_MS + BURST_RELEASE_MS, PUSH_ATTACK_MS + PUSH_RELEASE_MS)
const SHATTER_WINDOW_END_MS = 60 + 220 * 5

interface IndexedPulse {
  start: number
  end: number
  maxEnd: number
  effect: 'swell' | 'shake' | 'heartbeat' | 'shatter'
  factor: number
}
interface IndexedTint {
  start: number
  end: number
  color: LyricColor
}
interface IndexedVocal {
  line: LyricLine
  align: LyricAlign
  color: LyricColor
}
interface IndexedMainLine {
  line: LyricLine
  scene: StageScene | null
  sceneLines: number
}
interface StageIndex {
  chorusStarts: number[]
  pulses: IndexedPulse[]
  tints: IndexedTint[]
  vocals: IndexedVocal[]
  mainLines: IndexedMainLine[]
}

const stageIndexCache = new WeakMap<ResolvedLyrics, StageIndex>()

function getStageIndex(lyrics: ResolvedLyrics): StageIndex {
  const cached = stageIndexCache.get(lyrics)
  if (cached)
    return cached
  const chorusStarts: number[] = []
  const pulses: IndexedPulse[] = []
  const tints: IndexedTint[] = []
  const vocals: IndexedVocal[] = []
  const mainLines: IndexedMainLine[] = []
  const agents = lyrics.agents
  for (const line of lyrics.lines) {
    if (line.chorusStart)
      chorusStarts.push(line.start)
    for (const group of line.emphasis ?? []) {
      if (group.effect === 'swell' || group.effect === 'shake') {
        const baseDur = Math.max(PULSE_MIN_MS, group.end - group.start)
        pulses.push({ start: group.start, end: group.end, maxEnd: group.start + baseDur * 2.5, effect: group.effect, factor: group.factor })
      }
      else if (group.effect === 'heartbeat') {
        pulses.push({ start: group.start, end: group.end, maxEnd: group.end + 50, effect: 'heartbeat', factor: group.factor })
      }
      else if (group.effect === 'shatter') {
        pulses.push({ start: group.end, end: group.end, maxEnd: group.end + SHATTER_WINDOW_END_MS, effect: 'shatter', factor: group.factor })
      }
      if (group.color)
        tints.push({ start: group.start, end: group.end, color: group.color })
    }
    if (!line.isBackground) {
      if (agents && line.agent && agents[line.agent])
        vocals.push({ line, align: getLyricLineAlign(line), color: agents[line.agent].color })
      let scene: StageScene | null = null
      if (line.scene) {
        // 自定义粒子找不到或已下线的旧内置场景均当作没有场景
        const isCustom = line.scene.startsWith('custom:')
        const sprite = isCustom ? lyrics.sprites?.[line.scene.slice('custom:'.length)] : undefined
        if (isCustom ? Boolean(sprite) : KNOWN_LYRIC_SCENES.has(line.scene))
          scene = { name: line.scene, color: line.sceneColor ?? null, ...(sprite && { sprite }) }
      }
      mainLines.push({ line, scene, sceneLines: line.sceneLines && line.sceneLines > 0 ? line.sceneLines : SCENE_MAX_LINES })
    }
  }
  const index: StageIndex = { chorusStarts, pulses, tints, vocals, mainLines }
  stageIndexCache.set(lyrics, index)
  return index
}

/** rhythm 为这首歌的节拍模型（没有时回退到固定快慢，见 rhythm/effects.ts） */
export function getStageSignals(lyrics: ResolvedLyrics, timeMs: number, rhythm: RhythmModel | null = null): StageSignals {
  if (lyrics.lines.length === 0)
    return NO_SIGNALS
  const idx = getStageIndex(lyrics)
  let pulse = 0
  let burst = 0
  let push = 0
  let tint: StageSignals['tint'] = null
  for (let i = 0; i < idx.chorusStarts.length; i++) {
    const start = idx.chorusStarts[i]
    if (timeMs < start || timeMs > start + CHORUS_EFFECT_WINDOW)
      continue
    burst = Math.max(burst, burstEnvelope(start, timeMs))
    push = Math.max(push, pushEnvelope(start, timeMs))
  }
  const rCtx = idx.pulses.length > 0 ? rhythmContext(rhythm) : null
  for (let i = 0; i < idx.pulses.length; i++) {
    const p = idx.pulses[i]
    if (timeMs < p.start || timeMs > p.maxEnd)
      continue
    if (p.effect === 'swell' || p.effect === 'shake') {
      const duration = Math.max(PULSE_MIN_MS, p.end - p.start) * envelopeScale(rCtx!)
      pulse = Math.max(pulse, swellCurve((timeMs - p.start) / duration) * p.factor)
    }
    else if (p.effect === 'heartbeat') {
      pulse = Math.max(pulse, heartbeatLevel(rCtx!, p.start, p.end, timeMs) * p.factor)
    }
    else {
      pulse = Math.max(pulse, shatterFlash(p.end, timeMs) * p.factor)
    }
  }
  for (let i = 0; i < idx.tints.length; i++) {
    const t = idx.tints[i]
    if (timeMs < t.start || timeMs > t.end + TINT_RELEASE_MS)
      continue
    const strength = tintEnvelope(t.start, t.end, timeMs)
    if (strength > 0 && (!tint || strength > tint.strength))
      tint = { color: t.color, strength }
  }
  let bestVocal: { align: LyricAlign, color: LyricColor, strength: number, start: number } | null = null
  for (let i = 0; i < idx.vocals.length; i++) {
    const v = idx.vocals[i]
    if (timeMs < v.line.start || timeMs > v.line.end + TINT_RELEASE_MS)
      continue
    const strength = tintEnvelope(v.line.start, v.line.end, timeMs) * VOCAL_TINT_FACTOR
    if (strength > 0 && (!bestVocal || strength > bestVocal.strength || (strength === bestVocal.strength && v.line.start > bestVocal.start)))
      bestVocal = { align: v.align, color: v.color, strength, start: v.line.start }
  }
  const vocal = bestVocal ? { align: bestVocal.align, color: bestVocal.color, strength: bestVocal.strength } : null
  return { pulse, burst, push, spotlight: spotlightLevel(lyrics, timeMs), tint, vocal, scene: sceneAtIndexed(idx.mainLines, timeMs) }
}

/**
 * 一次聚光灯的强度（0 ~ 1）：在点题句开唱前 SPOTLIGHT_LEAD_MS 开始、SPOTLIGHT_ATTACK_MS 内缓入亮满，
 * 保持到这一句唱完，再在 SPOTLIGHT_RELEASE_MS 内缓出回落
 */
function spotlightEnvelope(line: LyricLine, timeMs: number): number {
  const t = timeMs - (line.start - SPOTLIGHT_LEAD_MS)
  if (t < 0 || timeMs >= line.end + SPOTLIGHT_RELEASE_MS)
    return 0
  const level = timeMs <= line.end ? Math.min(1, t / SPOTLIGHT_ATTACK_MS) : 1 - (timeMs - line.end) / SPOTLIGHT_RELEASE_MS
  return level * level * (3 - 2 * level)
}

/**
 * 当前的聚光灯：点题句可以有多句、每句可能重复出现，取此刻强度最高的那一次（line 为行号）；都不在演出时为 null。
 * 相邻两次聚光灯（如连续重复的副歌句）前一句回落、后一句亮起有重叠，取较强者，不会中途熄灭
 */
export function spotlightAt(lyrics: ResolvedLyrics, timeMs: number): { line: number, level: number } | null {
  let best: { line: number, level: number } | null = null
  for (const index of lyrics.spotlights ?? []) {
    const line = lyrics.lines[index]
    const level = line ? spotlightEnvelope(line, timeMs) : 0
    if (level > 0 && (!best || level > best.level))
      best = { line: index, level }
  }
  return best
}

/** 聚光灯强度（0 ~ 1），见 spotlightAt；没有点题句时为 0 */
export function spotlightLevel(lyrics: ResolvedLyrics, timeMs: number): number {
  return spotlightAt(lyrics, timeMs)?.level ?? 0
}

/** 副歌爆发包络：开唱后 BURST_ATTACK_MS 内升满，再按缓出曲线在 BURST_RELEASE_MS 内回落 */
function burstEnvelope(start: number, timeMs: number) {
  const t = timeMs - start
  if (t < 0 || t > BURST_ATTACK_MS + BURST_RELEASE_MS)
    return 0
  if (t <= BURST_ATTACK_MS)
    return t / BURST_ATTACK_MS
  return (1 - (t - BURST_ATTACK_MS) / BURST_RELEASE_MS) ** 2
}

/** 镜头推近包络：开唱后 PUSH_ATTACK_MS 内缓出地推近，再在 PUSH_RELEASE_MS 内缓缓回落 */
function pushEnvelope(start: number, timeMs: number) {
  const t = timeMs - start
  if (t < 0 || t > PUSH_ATTACK_MS + PUSH_RELEASE_MS)
    return 0
  if (t <= PUSH_ATTACK_MS)
    return 1 - (1 - t / PUSH_ATTACK_MS) ** 3
  const back = (t - PUSH_ATTACK_MS) / PUSH_RELEASE_MS
  return 1 - back * back * (3 - 2 * back)
}

/** 染色包络：开始后 TINT_ATTACK_MS 内升满，保持到结束，之后 TINT_RELEASE_MS 内淡出 */
function tintEnvelope(start: number, end: number, timeMs: number) {
  if (timeMs < start)
    return 0
  if (timeMs <= end)
    return Math.min(1, (timeMs - start) / TINT_ATTACK_MS)
  return Math.max(0, 1 - (timeMs - end) / TINT_RELEASE_MS)
}

/** 当前的粒子场景：最近一个已开始的场景行，且当前行距它不超过 SCENE_MAX_LINES 行 */
function sceneAtIndexed(mainLines: IndexedMainLine[], timeMs: number): StageScene | null {
  let current = -1
  for (let i = 0; i < mainLines.length; i++) {
    if (mainLines[i].line.start <= timeMs)
      current = i
  }
  if (current < 0)
    return null
  let sceneIndex = -1
  for (let i = current; i >= 0; i--) {
    if (mainLines[i].scene) {
      sceneIndex = i
      break
    }
  }
  if (sceneIndex < 0)
    return null
  const entry = mainLines[sceneIndex]
  const count = current - sceneIndex + 1
  // 超出行数后，最后一行唱完才结束
  if (count > entry.sceneLines || (count === entry.sceneLines && timeMs > mainLines[current].line.end))
    return null
  return entry.scene
}
