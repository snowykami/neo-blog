/**
 * 特效节奏（见 spec 8.2）：歌词标注为全曲（pace）与个别短语（phrase.pace）指定动效的快慢。
 * beat 跟随音乐节拍（默认，推荐）：前端分析音频得到拍点，动效由拍点驱动（见 rhythm/）；
 * slow / medium / fast 为固定快慢，也是跟随节拍不可用（拿不到音频、分析未完成或节拍不可信）时的回退。
 * 规则强调（没有标注的词）沿用全曲节奏。节奏只改变动效的快慢，不改变幅度
 */
export type LyricPace = 'beat' | 'slow' | 'medium' | 'fast'

/** 固定快慢（不含跟随节拍） */
export type FixedLyricPace = Exclude<LyricPace, 'beat'>

export const LYRIC_PACES: readonly LyricPace[] = ['beat', 'slow', 'medium', 'fast']

/** 全曲没有指定节奏时跟随节拍 */
export const DEFAULT_LYRIC_PACE: LyricPace = 'beat'

/** 跟随节拍不可用时的回退 */
export const FALLBACK_LYRIC_PACE: FixedLyricPace = 'medium'

export const PACE = {
  // 固定档的基准脉冲周期 T_b（毫秒）：心跳的拍长，其余动效的时长按 T_b 换算（见 rhythm/effects.ts）
  basePeriod: { slow: 1000, medium: 750, fast: 520 },
  // 长音颤音的频率（Hz，声乐的颤音约 5～7 Hz）与开始颤之前的延迟（占音长的比例）；模拟人声，不随节拍
  vibratoHz: { slow: 4.8, medium: 5.5, fast: 6.5 },
  vibratoDelay: { slow: 0.28, medium: 0.2, fast: 0.14 },
} satisfies Record<string, Record<FixedLyricPace, number>>

export function isLyricPace(value: unknown): value is LyricPace {
  return typeof value === 'string' && (LYRIC_PACES as readonly string[]).includes(value)
}
