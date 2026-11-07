/**
 * 特效节奏（见 spec 8.2）：动效的快慢只由音乐节拍决定（beat，前端分析音频得到拍点，动效由拍点驱动，见 rhythm/）；
 * 标注里的 pace 已不再参与（后端仍在产出，等清理）；slow / medium / fast 为固定快慢，只在节拍不可用时作为回退，或在调试面板里临时覆盖。
 * 节奏只改变动效的快慢，不改变幅度
 */
export type LyricPace = 'beat' | 'slow' | 'medium' | 'fast'

/** 固定快慢（不含跟随节拍） */
export type FixedLyricPace = Exclude<LyricPace, 'beat'>

export const LYRIC_PACES: readonly LyricPace[] = ['beat', 'slow', 'medium', 'fast']

/** 固定快慢（心跳、抖动等动效在回退与调试覆盖时用） */
export const FIXED_LYRIC_PACES: readonly FixedLyricPace[] = ['slow', 'medium', 'fast']

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
