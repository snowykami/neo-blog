/**
 * 消散与破碎两种强调特效的时间曲线（纯函数，播放器、导航栏与全屏舞台共用，见 spec 8.2）；心跳与流光由节拍驱动，见 rhythm/effects.ts：
 * - dissolve 消散：每个字唱完后化成颗粒淡出，保持消散（这一行通常早已滚出视野），之后再慢慢恢复；
 *   拖动进度（或中途打开页面）后，落点之前就该消散的字直接显示，看到的是完整歌词。淡出时长随节奏（0.8·T_b，见 dissolveFadeMs）
 * - shatter 破碎：整个词唱完的一瞬间一起碎掉（不像消散那样逐字飘散）：碎之前约 0.14 秒字先细微地颤（裂开的前兆），
 *   碎时字立刻隐去、由碎片层画出带字形的碎片迸开坠落，背景同时闪一下；之后同消散保持隐去、再慢慢恢复，跳转规则也相同。
 *   破碎总是一瞬间，不随特效节奏变化
 */

// 字唱完后多久开始消散、保持消散的时长、恢复时长；字间再错开（像被风从左往右吹）
const DISSOLVE_DELAY_MS = 150
const DISSOLVE_HOLD_MS = 12000
const DISSOLVE_RESTORE_MS = 1500
// 中档的淡出时长
const DISSOLVE_FADE_MS = 600

// 词唱完后多久碎、碎之前颤的时长、碎时背景闪光的衰减时间常数
const SHATTER_DELAY_MS = 60
const SHATTER_CRACK_MS = 140
const SHATTER_FLASH_DECAY_MS = 220

/**
 * 第 i 个字（共 count 个）的消散：at 为开始消散的时刻，amount 为消散程度（0 正常 ~ 1 完全消散）；
 * seekAt 为最近一次跳转（拖动进度、打开页面）的落点，在它之前就该消散的字不消散；fadeMs 为淡出时长
 */
export function dissolveState(start: number, end: number, i: number, count: number, timeMs: number, seekAt = Number.NEGATIVE_INFINITY, fadeMs = DISSOLVE_FADE_MS): { at: number, amount: number } {
  const charEnd = start + (end - start) * (i + 1) / Math.max(1, count)
  const at = charEnd + DISSOLVE_DELAY_MS
  if (at < seekAt)
    return { at, amount: 0 }
  const out = Math.min(1, Math.max(0, (timeMs - at) / fadeMs))
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
