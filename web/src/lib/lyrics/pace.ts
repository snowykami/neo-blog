/**
 * 特效节奏（见 spec 8.2）：歌词标注为全曲（pace）与个别短语（phrase.pace）指定 slow / medium / fast，按歌词的轻快程度选择；
 * 规则强调（没有标注的词）沿用全曲节奏。节奏只改变动效的快慢，不改变幅度；各特效的取值按其含义分别给出
 */
export type LyricPace = 'slow' | 'medium' | 'fast'

export const LYRIC_PACES: readonly LyricPace[] = ['slow', 'medium', 'fast']

export const PACE = {
  // 起落曲线（swell / glow / wave / focus）的时长倍数：慢的余韵更长，快的更利落
  envelope: { slow: 1.35, medium: 1, fast: 0.75 },
  // shake 的抖动周期（毫秒，越小越快）
  shakePeriod: { slow: 70, medium: 45, fast: 30 },
  // 长音颤音的频率（Hz，声乐的颤音约 5～7 Hz）与开始颤之前的延迟（占音长的比例）
  vibratoHz: { slow: 4.8, medium: 5.5, fast: 6.5 },
  vibratoDelay: { slow: 0.28, medium: 0.2, fast: 0.14 },
  // 心跳的拍长、流光每遍的时长、消散的淡出时长（毫秒）
  heartbeatBeat: { slow: 1000, medium: 750, fast: 520 },
  shimmerSweep: { slow: 1400, medium: 950, fast: 650 },
  dissolveFade: { slow: 1000, medium: 600, fast: 350 },
} satisfies Record<string, Record<LyricPace, number>>

export function isLyricPace(value: unknown): value is LyricPace {
  return typeof value === 'string' && (LYRIC_PACES as readonly string[]).includes(value)
}
