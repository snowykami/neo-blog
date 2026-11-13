/**
 * 特效节奏（见 spec 8.2）：动效的快慢由音乐节拍决定（beat，前端分析音频得到拍点，动效由拍点驱动，见 rhythm/）；
 * slow / medium / fast 为固定快慢档位，仅在节拍不可用时作为回退，或在调试面板里临时覆盖。
 * 节奏只改变动效的快慢，不改变幅度
 */

/** 固定快慢档位（心跳、抖动等动效在节拍回退与调试覆盖时用） */
export type FixedLyricPace = 'slow' | 'medium' | 'fast'

export const FIXED_LYRIC_PACES: readonly FixedLyricPace[] = ['slow', 'medium', 'fast']

export const PACE = {
  // 固定档的基准脉冲周期 T_b（毫秒）：心跳的拍长，其余动效的时长按 T_b 换算（见 rhythm/effects.ts）
  basePeriod: { slow: 1000, medium: 750, fast: 520 },
  // 长音颤音的频率（Hz，声乐的颤音约 5～7 Hz）与开始颤之前的延迟（占音长的比例）；模拟人声，不随节拍
  vibratoHz: { slow: 4.8, medium: 5.5, fast: 6.5 },
  vibratoDelay: { slow: 0.28, medium: 0.2, fast: 0.14 },
} satisfies Record<string, Record<FixedLyricPace, number>>
