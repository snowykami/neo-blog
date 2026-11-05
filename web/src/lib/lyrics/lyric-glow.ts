import type { ResolvedLyrics } from './types'
import { LYRIC_COLORS, MOOD_GLOW } from './colors'
import { LYRIC_EMPHASIS_MIN_MS } from './config'

/** 此刻歌词的颜色与是否在「高亮」：color 为空时没有可用的歌词颜色（由调用方回落到封面主色） */
export interface LyricGlow {
  color: string | null
  strong: boolean
}

const NO_GLOW: LyricGlow = { color: null, strong: false }

/**
 * 此刻在唱的歌词的颜色（顶栏灵动岛的描边辉光用）：此刻在唱的强调短语的颜色 → 这一行情绪基调的辉光色 → 没有。
 * 唱到带特效的强调短语（factor > 0）或全曲点题的句子（聚光灯）时为高亮。
 * 强调短语的演出时长不短于 LYRIC_EMPHASIS_MIN_MS（与歌词引擎一致），唱得很快的短语也能停留到被看见
 */
export function lyricGlowAt(lyrics: ResolvedLyrics, timeMs: number): LyricGlow {
  const index = lyrics.lines.findIndex(line => !line.isBackground && timeMs >= line.start && timeMs < line.end)
  if (index < 0)
    return NO_GLOW
  const line = lyrics.lines[index]
  let color: string | null = null
  let strong = lyrics.spotlights?.includes(index) ?? false
  for (const group of line.emphasis ?? []) {
    if (timeMs < group.start || timeMs >= group.start + Math.max(LYRIC_EMPHASIS_MIN_MS, group.end - group.start))
      continue
    if (group.factor > 0)
      strong = true
    if (group.color && !color)
      color = LYRIC_COLORS[group.color]
  }
  return { color: color ?? (line.mood ? MOOD_GLOW[line.mood] : null), strong }
}
