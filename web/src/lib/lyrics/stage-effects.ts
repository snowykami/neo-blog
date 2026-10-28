import type { LyricColor, LyricScene, ResolvedLyrics } from './types'
import { swellCurve } from './easing'

/**
 * 播放器页的全屏特效信号（纯函数，由 MusicStageEffects 每帧调用）：
 * - pulse 背景呼吸：唱到 swell / shake 强调时随起落曲线亮起，强度取 factor
 * - tint 背景染色：唱到带颜色的强调时，背景泛起该颜色，唱完后慢慢淡出
 * - scene 粒子场景：从标了 scene 的行开始，持续 SCENE_MAX_LINES 行，或到下一个标了 scene 的行为止
 */

export interface StageSignals {
  pulse: number
  tint: { color: LyricColor, strength: number } | null
  scene: LyricScene | null
}

// 演出时长下限（与歌词引擎的强调一致）、染色淡入与淡出时长
const PULSE_MIN_MS = 1000
const TINT_ATTACK_MS = 300
const TINT_RELEASE_MS = 1500
// 粒子场景持续的行数（含标注行）
export const SCENE_MAX_LINES = 8

const NO_SIGNALS: StageSignals = { pulse: 0, tint: null, scene: null }

export function getStageSignals(lyrics: ResolvedLyrics, timeMs: number): StageSignals {
  if (lyrics.lines.length === 0)
    return NO_SIGNALS
  let pulse = 0
  let tint: StageSignals['tint'] = null
  for (const line of lyrics.lines) {
    for (const group of line.emphasis ?? []) {
      if (group.effect === 'swell' || group.effect === 'shake') {
        const duration = Math.max(PULSE_MIN_MS, group.end - group.start)
        pulse = Math.max(pulse, swellCurve((timeMs - group.start) / duration) * group.factor)
      }
      if (group.color) {
        const strength = tintEnvelope(group.start, group.end, timeMs)
        if (strength > 0 && (!tint || strength > tint.strength))
          tint = { color: group.color, strength }
      }
    }
  }
  return { pulse, tint, scene: sceneAt(lyrics, timeMs) }
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
function sceneAt(lyrics: ResolvedLyrics, timeMs: number): LyricScene | null {
  let scene: LyricScene | null = null
  let sceneIndex = -1
  let current = -1
  lyrics.lines.forEach((line, index) => {
    if (line.isBackground || line.start > timeMs)
      return
    current = index
    if (line.scene) {
      scene = line.scene
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
