import type { LyricColor, LyricScene, ResolvedLyrics } from './types'
import { swellCurve } from './easing'
import { PACE } from './pace'
import { heartbeatLevel } from './word-effects'

/**
 * 播放器页的全屏特效信号（纯函数，由 MusicStageEffects 每帧调用）：
 * - pulse 背景呼吸：唱到 swell / shake 强调时随起落曲线亮起，强度取 factor
 * - tint 背景染色：唱到带颜色的强调时，背景泛起该颜色，唱完后慢慢淡出
 * - burst 副歌爆发：每段副歌的第一行开唱时迅速亮起，再慢慢回落
 * - push 镜头推近：同样在副歌第一行开唱时触发，约 0.45 秒推近、2.6 秒缓缓回落（由页面换算成背景与歌词区的放大）
 * - 心跳强调（heartbeat）让背景随双拍跳动
 * - scene 粒子场景（含颜色主题）：从标了 scene 的行开始，持续 SCENE_MAX_LINES 行，或到下一个标了 scene 的行为止
 */

export interface StageSignals {
  pulse: number
  burst: number
  push: number
  tint: { color: LyricColor, strength: number } | null
  scene: StageScene | null
}

export interface StageScene {
  name: LyricScene
  // 颜色主题，null 为场景默认色
  color: LyricColor | null
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
// 粒子场景持续的行数（含标注行）
export const SCENE_MAX_LINES = 8

const NO_SIGNALS: StageSignals = { pulse: 0, burst: 0, push: 0, tint: null, scene: null }

export function getStageSignals(lyrics: ResolvedLyrics, timeMs: number): StageSignals {
  if (lyrics.lines.length === 0)
    return NO_SIGNALS
  let pulse = 0
  let burst = 0
  let push = 0
  let tint: StageSignals['tint'] = null
  for (const line of lyrics.lines) {
    if (line.chorusStart) {
      burst = Math.max(burst, burstEnvelope(line.start, timeMs))
      push = Math.max(push, pushEnvelope(line.start, timeMs))
    }
    for (const group of line.emphasis ?? []) {
      if (group.effect === 'swell' || group.effect === 'shake') {
        const duration = Math.max(PULSE_MIN_MS, group.end - group.start) * PACE.envelope[group.pace ?? 'medium']
        pulse = Math.max(pulse, swellCurve((timeMs - group.start) / duration) * group.factor)
      }
      else if (group.effect === 'heartbeat') {
        pulse = Math.max(pulse, heartbeatLevel(group.start, group.end, timeMs, group.pace) * group.factor)
      }
      if (group.color) {
        const strength = tintEnvelope(group.start, group.end, timeMs)
        if (strength > 0 && (!tint || strength > tint.strength))
          tint = { color: group.color, strength }
      }
    }
  }
  return { pulse, burst, push, tint, scene: sceneAt(lyrics, timeMs) }
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
function sceneAt(lyrics: ResolvedLyrics, timeMs: number): StageScene | null {
  let scene: StageScene | null = null
  let sceneIndex = -1
  let current = -1
  lyrics.lines.forEach((line, index) => {
    if (line.isBackground || line.start > timeMs)
      return
    current = index
    if (line.scene) {
      scene = { name: line.scene, color: line.sceneColor ?? null }
      sceneIndex = index
    }
  })
  if (scene == null)
    return null
  // 按主唱行计数，背景人声不占行数
  let lines = 0
  for (let i = sceneIndex; i <= current; i++) {
    if (!lyrics.lines[i].isBackground)
      lines++
  }
  // 超出行数后，最后一行唱完才结束
  if (lines > SCENE_MAX_LINES || (lines === SCENE_MAX_LINES && timeMs > lyrics.lines[current].end))
    return null
  return scene
}
