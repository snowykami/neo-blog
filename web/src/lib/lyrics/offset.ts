import type { ResolvedLyrics } from './types'

/**
 * 歌词整体偏移（见 spec 7.2l）：管理员在播放器里微调、对所有人生效，按歌词来源分别保存。
 * offsetMs 为正时歌词推迟（比原时间轴晚出现），为负时提前；在选出歌词之后、计算强调之前平移所有时间，
 * 之后的强调分组、间奏、时刻等都按平移后的时间计算
 */
export function shiftLyrics(lyrics: ResolvedLyrics, offsetMs: number): ResolvedLyrics {
  if (!offsetMs || lyrics.lines.length === 0)
    return lyrics
  const shift = <T extends { start: number, end: number }>(item: T): T => ({ ...item, start: item.start + offsetMs, end: item.end + offsetMs })
  return {
    ...lyrics,
    lines: lyrics.lines.map(line => ({
      ...shift(line),
      words: line.words.map(shift),
      // 逐字音译有自己的时间（随原文音节擦除），要一起平移，否则偏移后音译与原文错开
      ...(line.romanizationWords && { romanizationWords: line.romanizationWords.map(shift) }),
    })),
  }
}

/** 偏移的显示：秒，保留一位小数并带正负号（如 +0.3s、-1.2s） */
export function formatLyricOffset(offsetMs: number): string {
  const seconds = (offsetMs / 1000).toFixed(1)
  return offsetMs > 0 ? `+${seconds}s` : `${seconds}s`
}
