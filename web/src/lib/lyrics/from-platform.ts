import type { PlatformLyricParsed } from './parse-platform'
import type { LyricTrackInfo } from './strip-credits'
import type { LyricLine, LyricSource, ResolvedLyrics } from './types'
import { getLyricLineText, LYRIC_PLACEHOLDERS } from './line-utils'
import { preprocessLyricLines } from './preprocess'
import { romanWordsFromTimed } from './romanization'
import { stripCredits } from './strip-credits'
import { EMPTY_LYRICS } from './types'

export type LyricPlatform = 'ncm' | 'qq' | 'kugou'

// 行级歌词最后一行没有下一行可参考时的行时长
const LAST_LINE_DURATION_MS = 5000

const PLATFORM_SOURCES: Record<LyricPlatform, { wordTimed: LyricSource, lineTimed: LyricSource }> = {
  ncm: { wordTimed: 'ncm-yrc', lineTimed: 'ncm-lrc' },
  qq: { wordTimed: 'qq-qrc', lineTimed: 'qq-lrc' },
  kugou: { wordTimed: 'kugou-krc', lineTimed: 'kugou-lrc' },
}

// QQ 音乐、酷狗音乐纯音乐的占位歌词
const INSTRUMENTAL_RE = /纯音乐，请您?欣赏/

/**
 * 平台歌词（网易云 parseNcmLyrics / QQ 音乐与酷狗音乐 parseQqLyrics 的结果）转换为歌词引擎的数据模型并预处理：
 * - 逐字（yrc / qrc）：保留各词起止时间；逐行（lrc）：整行为一个词，结束时间取下一行的开始
 * - 翻译 / 音译已在解析时一对一挂到主行（宁缺勿错），这里按开始时间精确取；与原文相同的翻译不显示
 * - 去掉首尾的署名行（歌名 - 歌手、作词、作曲等，需要曲目信息判断歌名行）
 */
export function platformToLyrics(
  parsed: PlatformLyricParsed | null,
  platform: LyricPlatform,
  track?: LyricTrackInfo | null,
): ResolvedLyrics {
  if (!parsed || parsed.lines.length === 0)
    return EMPTY_LYRICS

  // 接口返回的「无歌词 / 纯音乐」占位
  const placeholder = parsed.lines.length === 1 ? getLyricLineText(parsed.lines[0]).trim() : ''
  if (LYRIC_PLACEHOLDERS.has(placeholder))
    return { ...EMPTY_LYRICS, instrumental: placeholder === 'pure_music_without_lyric' }
  if (platform !== 'ncm' && parsed.lines.every(line => INSTRUMENTAL_RE.test(getLyricLineText(line))))
    return { ...EMPTY_LYRICS, instrumental: true }

  const translationByStart = new Map(parsed.translations.map(item => [item.start, item.text]))
  const romajiByStart = new Map(parsed.romanizations.map(item => [item.start, item]))

  const wordTimed = parsed.sourceType === 'yrc' || parsed.sourceType === 'qrc'
  const lines: LyricLine[] = parsed.lines.map((line, index) => {
    const next = parsed.lines[index + 1]
    const originalText = getLyricLineText(line).trim()
    const end = wordTimed
      ? line.end
      : next?.start ?? line.start + LAST_LINE_DURATION_MS
    const translation = translationByStart.get(line.start)
    const romajiLine = romajiByStart.get(line.start)
    const words = wordTimed
      ? line.words
      : [{ text: originalText, start: line.start, end }]
    // QQ 音乐、酷狗音乐的音译是带逐字时间的 QRC，直接使用；其他来源的音译在最终歌词上对齐（见 romanization.ts）
    const romanizationWords = platform !== 'ncm' && wordTimed && romajiLine?.items
      ? romanWordsFromTimed(romajiLine.items, words) ?? undefined
      : undefined
    return {
      words,
      start: line.start,
      end,
      translation: translation && translation !== originalText ? translation : undefined,
      romanization: romajiLine?.text,
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
