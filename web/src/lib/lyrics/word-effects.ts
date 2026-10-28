/**
 * 消散、流光、心跳三种强调特效的时间曲线（纯函数，播放器、导航栏与全屏舞台共用，见 spec 8.2）：
 * - heartbeat 心跳：「扑通-扑通」双拍，第二拍稍弱、相隔约 22% 拍长；拍数按唱的时长分（约 0.75 秒一拍，至少 2 拍）
 * - shimmer 流光：唱到时一道光带从左到右扫过整个词，扫两遍
 * - dissolve 消散：每个字唱完后化成颗粒淡出；过一会儿再慢慢恢复，回看歌词时文字仍可读
 */

const HEARTBEAT_BEAT_MS = 750
const HEARTBEAT_SECOND_DELAY = 0.22
const HEARTBEAT_SECOND_LEVEL = 0.7
// 每一拍的起落：约 45ms 升满，再按 90ms 时间常数衰减
const HEARTBEAT_ATTACK_MS = 45
const HEARTBEAT_DECAY_MS = 90

const SHIMMER_SWEEP_MS = 950
const SHIMMER_SWEEPS = 2

// 字唱完后多久开始消散、淡出时长、保持消散的时长、恢复时长；字间再错开（像被风从左往右吹）
const DISSOLVE_DELAY_MS = 150
const DISSOLVE_FADE_MS = 600
const DISSOLVE_HOLD_MS = 2600
const DISSOLVE_RESTORE_MS = 1000

function beatPulse(ms: number) {
  if (ms < 0)
    return 0
  return Math.exp(-ms / HEARTBEAT_DECAY_MS) * Math.min(1, ms / HEARTBEAT_ATTACK_MS)
}

/** 心跳强度（0 ~ 1）：只在 [start, end + 一拍的余韵) 内跳动 */
export function heartbeatLevel(start: number, end: number, timeMs: number): number {
  const duration = Math.max(1, end - start)
  const local = timeMs - start
  if (local < 0 || local > duration + 300)
    return 0
  const beats = Math.max(2, Math.round(duration / HEARTBEAT_BEAT_MS))
  const period = duration / beats
  const phase = local % period
  return Math.max(beatPulse(phase), HEARTBEAT_SECOND_LEVEL * beatPulse(phase - HEARTBEAT_SECOND_DELAY * period))
}

/** 流光光带中心在词上的位置（以字为单位，从 -1 扫到 count + 1）；不在扫动时为 null */
export function shimmerCenter(start: number, timeMs: number, count: number): number | null {
  const sweep = (timeMs - start) / SHIMMER_SWEEP_MS
  if (sweep < 0 || sweep >= SHIMMER_SWEEPS)
    return null
  return (sweep % 1) * (count + 2) - 1
}

/** 第 i 个字（共 count 个）的消散：at 为开始消散的时刻，amount 为消散程度（0 正常 ~ 1 完全消散） */
export function dissolveState(start: number, end: number, i: number, count: number, timeMs: number): { at: number, amount: number } {
  const charEnd = start + (end - start) * (i + 1) / Math.max(1, count)
  const at = charEnd + DISSOLVE_DELAY_MS
  const out = Math.min(1, Math.max(0, (timeMs - at) / DISSOLVE_FADE_MS))
  const back = Math.min(1, Math.max(0, (timeMs - at - DISSOLVE_HOLD_MS) / DISSOLVE_RESTORE_MS))
  return { at, amount: out * (1 - back) }
}
