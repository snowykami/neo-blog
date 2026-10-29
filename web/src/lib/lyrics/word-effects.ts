/**
 * 消散、破碎、流光、心跳四种强调特效的时间曲线（纯函数，播放器、导航栏与全屏舞台共用，见 spec 8.2）：
 * - heartbeat 心跳：「扑通-扑通」双拍，第二拍稍弱、相隔约 22% 拍长；拍数按唱的时长分（约 0.75 秒一拍，至少 2 拍）
 * - shimmer 流光：唱到时一道光带从左到右扫过整个词，扫两遍
 * - dissolve 消散：每个字唱完后化成颗粒淡出，保持消散（这一行通常早已滚出视野），之后再慢慢恢复；
 *   拖动进度（或中途打开页面）后，落点之前就该消散的字直接显示，看到的是完整歌词
 * - shatter 破碎：整个词唱完的一瞬间一起碎掉（不像消散那样逐字飘散）：碎之前约 0.14 秒字先细微地颤（裂开的前兆），
 *   碎时字立刻隐去、由碎片层画出带字形的碎片迸开坠落，背景同时闪一下；之后同消散保持隐去、再慢慢恢复，跳转规则也相同。
 *   破碎总是一瞬间，不随特效节奏变化
 * 拍长、扫动与淡出的快慢随特效节奏变化（见 pace.ts）
 */

import type { LyricPace } from './pace'
import { PACE } from './pace'

const HEARTBEAT_SECOND_DELAY = 0.22
const HEARTBEAT_SECOND_LEVEL = 0.7
// 每一拍的起落：约 45ms 升满，再按 90ms 时间常数衰减
const HEARTBEAT_ATTACK_MS = 45
const HEARTBEAT_DECAY_MS = 90

const SHIMMER_SWEEPS = 2

// 字唱完后多久开始消散、淡出时长、保持消散的时长、恢复时长；字间再错开（像被风从左往右吹）
const DISSOLVE_DELAY_MS = 150
const DISSOLVE_HOLD_MS = 12000
const DISSOLVE_RESTORE_MS = 1500

// 词唱完后多久碎、碎之前颤的时长、碎时背景闪光的衰减时间常数
const SHATTER_DELAY_MS = 60
const SHATTER_CRACK_MS = 140
const SHATTER_FLASH_DECAY_MS = 220

function beatPulse(ms: number) {
  if (ms < 0)
    return 0
  return Math.exp(-ms / HEARTBEAT_DECAY_MS) * Math.min(1, ms / HEARTBEAT_ATTACK_MS)
}

/** 心跳强度（0 ~ 1）：只在 [start, end + 一拍的余韵) 内跳动 */
export function heartbeatLevel(start: number, end: number, timeMs: number, pace: LyricPace = 'medium'): number {
  const duration = Math.max(1, end - start)
  const local = timeMs - start
  if (local < 0 || local > duration + 300)
    return 0
  const beats = Math.max(2, Math.round(duration / PACE.heartbeatBeat[pace]))
  const period = duration / beats
  const phase = local % period
  return Math.max(beatPulse(phase), HEARTBEAT_SECOND_LEVEL * beatPulse(phase - HEARTBEAT_SECOND_DELAY * period))
}

/** 流光光带中心在词上的位置（以字为单位，从 -1 扫到 count + 1）；不在扫动时为 null */
export function shimmerCenter(start: number, timeMs: number, count: number, pace: LyricPace = 'medium'): number | null {
  const sweep = (timeMs - start) / PACE.shimmerSweep[pace]
  if (sweep < 0 || sweep >= SHIMMER_SWEEPS)
    return null
  return (sweep % 1) * (count + 2) - 1
}

/**
 * 第 i 个字（共 count 个）的消散：at 为开始消散的时刻，amount 为消散程度（0 正常 ~ 1 完全消散）；
 * seekAt 为最近一次跳转（拖动进度、打开页面）的落点，在它之前就该消散的字不消散
 */
export function dissolveState(start: number, end: number, i: number, count: number, timeMs: number, seekAt = Number.NEGATIVE_INFINITY, pace: LyricPace = 'medium'): { at: number, amount: number } {
  const charEnd = start + (end - start) * (i + 1) / Math.max(1, count)
  const at = charEnd + DISSOLVE_DELAY_MS
  if (at < seekAt)
    return { at, amount: 0 }
  const out = Math.min(1, Math.max(0, (timeMs - at) / PACE.dissolveFade[pace]))
  const back = Math.min(1, Math.max(0, (timeMs - at - DISSOLVE_HOLD_MS) / DISSOLVE_RESTORE_MS))
  return { at, amount: out * (1 - back) }
}

/**
 * 破碎（整个词一起）：at 为碎的时刻（词唱完后 SHATTER_DELAY_MS）；crack 为碎之前的颤动程度（0 ~ 1，碎前 SHATTER_CRACK_MS 内渐强）；
 * amount 为隐去程度（碎时立刻为 1，保持后慢慢恢复）。seekAt 之前就该碎的词不碎
 */
export function shatterState(end: number, timeMs: number, seekAt = Number.NEGATIVE_INFINITY): { at: number, crack: number, amount: number } {
  const at = end + SHATTER_DELAY_MS
  if (at < seekAt)
    return { at, crack: 0, amount: 0 }
  if (timeMs < at)
    return { at, crack: Math.min(1, Math.max(0, (timeMs - at + SHATTER_CRACK_MS) / SHATTER_CRACK_MS)), amount: 0 }
  const back = Math.min(1, Math.max(0, (timeMs - at - DISSOLVE_HOLD_MS) / DISSOLVE_RESTORE_MS))
  return { at, crack: 0, amount: 1 - back }
}

/** 破碎时背景的闪光（0 ~ 1）：碎的一瞬间亮满，再按 SHATTER_FLASH_DECAY_MS 衰减 */
export function shatterFlash(end: number, timeMs: number): number {
  const t = timeMs - end - SHATTER_DELAY_MS
  return t < 0 || t > SHATTER_FLASH_DECAY_MS * 5 ? 0 : Math.exp(-t / SHATTER_FLASH_DECAY_MS)
}
