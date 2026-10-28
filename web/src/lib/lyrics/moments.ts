import type { ResolvedLyrics } from './types'

/**
 * 歌词区底部「时刻」的显示时机（见 spec 7.2d），返回当前显示的内容：intro / outro / note:序号 / null
 * - note（关键节点）：在对应歌词行开唱时显示 NOTE_MS，遇到下一个时刻或尾奏时提前让位；优先级最高
 * - intro（前奏导语）：开播后显示到开唱前 INTRO_LEAD_MS，前奏较短时也至少显示 INTRO_MIN_MS（显示在歌词下方，不挡歌词）
 * - outro（尾奏热评）：最后一句唱完 OUTRO_DELAY_MS 后显示，直到歌曲结束前 OUTRO_END_MS
 */

export type LyricMoment = 'intro' | 'outro' | `note:${number}` | null

const INTRO_START_MS = 300
const INTRO_LEAD_MS = 600
const INTRO_MIN_MS = 8000
const NOTE_MS = 9000
const OUTRO_DELAY_MS = 800
const OUTRO_END_MS = 300

export function lyricMomentAt(lyrics: ResolvedLyrics, timeMs: number, durationMs: number | null): LyricMoment {
  const lines = lyrics.lines.filter(line => !line.isBackground)
  if (lines.length === 0)
    return null
  const outroStart = Math.max(...lines.map(line => line.end)) + OUTRO_DELAY_MS
  const notes = lyrics.notes ?? []
  for (let i = notes.length - 1; i >= 0; i--) {
    const start = notes[i].start
    const end = Math.min(start + NOTE_MS, notes[i + 1]?.start ?? Infinity, lyrics.outro ? outroStart : Infinity)
    if (timeMs >= start && timeMs < end)
      return `note:${i}`
  }
  if (lyrics.intro && timeMs >= INTRO_START_MS && timeMs < Math.max(lines[0].start - INTRO_LEAD_MS, INTRO_START_MS + INTRO_MIN_MS))
    return 'intro'
  if (lyrics.outro && timeMs > outroStart && (durationMs == null || timeMs < durationMs - OUTRO_END_MS))
    return 'outro'
  return null
}
