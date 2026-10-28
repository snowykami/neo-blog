import type { LyricTrackInfo } from './strip-credits'
import type { LyricLine, LyricSource, ResolvedLyrics } from './types'
import type { MusicLyricLine, MusicLyricParseResult } from '@/utils/music-lyric'
import { getExtraLyricLine, LYRIC_PLACEHOLDERS } from '@/utils/music-lyric'
import { preprocessLyricLines } from './preprocess'
import { romanWordsFromTimed } from './romanization'
import { stripCredits } from './strip-credits'
import { EMPTY_LYRICS } from './types'

export type LyricPlatform = 'ncm' | 'qq'

// 行级歌词最后一行没有下一行可参考时的行时长
const LAST_LINE_DURATION_MS = 5000

const PLATFORM_SOURCES: Record<LyricPlatform, { wordTimed: LyricSource, lineTimed: LyricSource }> = {
  ncm: { wordTimed: 'ncm-yrc', lineTimed: 'ncm-lrc' },
  qq: { wordTimed: 'qq-qrc', lineTimed: 'qq-lrc' },
}

// QQ 音乐纯音乐的占位歌词
const QQ_INSTRUMENTAL_RE = /纯音乐，请您?欣赏/

/**
 * 平台歌词（网易云 parseMusicLyrics / QQ 音乐 parseQqLyrics 的结果）转换为歌词引擎的数据模型并预处理：
 * - 逐字（yrc / qrc）：词的结束时间 = 开始 + 时长；逐行（lrc）：整行为一个词，结束时间取下一行的开始
 * - 翻译 / 音译已在解析时一对一挂到主行（宁缺勿错），这里按开始时间精确取；与原文相同的翻译不显示
 * - 去掉首尾的署名行（歌名 - 歌手、作词、作曲等，需要曲目信息判断歌名行）
 */
export function platformToLyrics(parsed: MusicLyricParseResult | null, platform: LyricPlatform, track?: LyricTrackInfo | null): ResolvedLyrics {
  if (!parsed || parsed.lines.length === 0)
    return EMPTY_LYRICS

  // 接口返回的「无歌词 / 纯音乐」占位
  const placeholder = parsed.lines.length === 1 ? parsed.lines[0].originalText.trim() : ''
  if (LYRIC_PLACEHOLDERS.has(placeholder))
    return { ...EMPTY_LYRICS, instrumental: placeholder === 'pure_music_without_lyric' }
  if (platform === 'qq' && parsed.lines.every(line => QQ_INSTRUMENTAL_RE.test(line.originalText)))
    return { ...EMPTY_LYRICS, instrumental: true }

  const wordTimed = parsed.sourceType === 'yrc' || parsed.sourceType === 'qrc'
  const lines: LyricLine[] = parsed.lines.map((line, index) => {
    const next = parsed.lines[index + 1]
    const end = wordTimed
      ? line.startTime + line.duration
      : next?.startTime ?? line.startTime + LAST_LINE_DURATION_MS
    const translation = getExtraLyricLine(parsed.translationLines, line.startTime)?.originalText
    const romajiLine = getExtraLyricLine(parsed.romajiLines, line.startTime)
    const words = wordTimed
      ? line.items.map(item => ({ text: item.text, start: item.startTime, end: item.startTime + item.duration }))
      : [{ text: line.originalText, start: line.startTime, end }]
    // QQ 音乐的音译是带逐字时间的 QRC，直接使用；其他来源的音译在最终歌词上对齐（见 romanization.ts）
    const romanizationWords = platform === 'qq' && wordTimed && romajiLine ? romanWordsFromTimed(romajiLine.items, words) ?? undefined : undefined
    return {
      words,
      start: line.startTime,
      end,
      translation: translation && translation !== line.originalText ? translation : undefined,
      romanization: romajiLine?.originalText,
      romanizationWords,
      isDuet: false,
      isBackground: false,
    }
  })

  const sources = PLATFORM_SOURCES[platform]
  return {
    source: wordTimed ? sources.wordTimed : sources.lineTimed,
    wordTimed,
    instrumental: false,
    lines: preprocessLyricLines(stripCredits(lines, track)),
  }
}

/** 单行歌词组件（导航栏、单曲卡、文章内的歌词摘录）使用的旧数据结构：翻译 / 音译行的开始时间与所属主行一致 */
export interface SingleLineLyrics {
  lines: MusicLyricLine[]
  translationLines: MusicLyricLine[]
  romajiLines: MusicLyricLine[]
}

/**
 * 把歌词引擎的数据转换回单行歌词组件使用的旧结构：只保留主唱行（背景人声与主行重叠，不单独显示），
 * 逐字歌词保留词的时间，逐行歌词整行为一个时长为 0 的条目（与 LRC 解析结果一致）；
 * 行的开始时间取第一个词的实际开始时间（单行显示不需要「提前起唱」，提前换行会截掉上一行的尾音）
 */
export function toSingleLineLyrics(lyrics: ResolvedLyrics): SingleLineLyrics {
  const result: SingleLineLyrics = { lines: [], translationLines: [], romajiLines: [] }
  for (const line of lyrics.lines) {
    if (line.isBackground)
      continue
    const originalText = line.words.map(word => word.text).join('').trim()
    const startTime = line.words[0]?.start ?? line.start
    result.lines.push(lyrics.wordTimed
      ? {
          items: line.words.map(word => ({ text: word.text, startTime: word.start, duration: Math.max(0, word.end - word.start) })),
          startTime,
          duration: Math.max(0, line.end - startTime),
          originalText,
        }
      : { items: [{ text: originalText, startTime, duration: 0 }], startTime, duration: 0, originalText })
    const extra = (text: string) => ({ items: [], startTime, duration: 0, originalText: text })
    if (line.translation)
      result.translationLines.push(extra(line.translation))
    if (line.romanization)
      result.romajiLines.push(extra(line.romanization))
  }
  return result
}
