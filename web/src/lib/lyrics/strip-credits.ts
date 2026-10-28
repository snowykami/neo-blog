import type { LyricLine } from './types'

/**
 * 去掉平台歌词首尾的署名行（见 spec 2.4，规则参考 StarryPlayer）：「歌名 - 歌手」、「词：…」「作曲 : …」「Producer: …」、
 * 「未经许可不得翻唱…」等。只去掉开头（最多 16 行）与结尾（最多 8 行）连续的署名行，且不会把所有行都去掉；TTML 不经过这里
 */

export interface LyricTrackInfo {
  name: string
  artists: string[]
}

const HEAD_MAX_LINES = 16
const TAIL_MAX_LINES = 8
// 开头几行中只有歌名或某位歌手的行（有的歌词把歌名、歌手分两行写）；副歌常以歌名结尾，结尾不按这条去
const HEADING_MAX_LINES = 3
// 冒号前的键最多这么多字，且只在行首这么多字内找冒号
const CREDIT_KEY_MAX_CHARS = 12
const CREDIT_COLON_WITHIN = 24

const CREDIT_NOTICES = ['未经许可', '未經許可', '不得翻唱', '禁止翻唱']
const CREDIT_PREFIXES = ['lyrics by ', 'music by ', 'composed by ', 'written by ', 'produced by ', 'arranged by ', 'mixed by ', 'mastered by ']
const CREDIT_EXACT_KEYS = new Set(['op', 'sp', 'isrc', 'pv', 'mv'])
const CREDIT_KEYWORDS = [
  '词',
  '詞',
  '曲',
  '编',
  '編',
  '制作',
  '製作',
  '监制',
  '監製',
  '出品',
  '发行',
  '發行',
  '演唱',
  '原唱',
  '翻唱',
  '歌手',
  '混音',
  '缩混',
  '录音',
  '錄音',
  '母带',
  '母帶',
  '和声',
  '和聲',
  '合声',
  '合聲',
  '配唱',
  '吉他',
  '贝斯',
  '貝斯',
  '鼓',
  '键盘',
  '鍵盤',
  '钢琴',
  '鋼琴',
  '弦乐',
  '弦樂',
  '人声',
  '人聲',
  '伴奏',
  '策划',
  '企划',
  '企劃',
  '统筹',
  '統籌',
  '出版',
  '版权',
  '版權',
  '宣传',
  '推广',
  '监修',
  '監修',
  '录制',
  '錄製',
  'lyric',
  'compos',
  'arrang',
  'produc',
  'writ',
  'mix',
  'master',
  'vocal',
  'record',
  'engineer',
  'guitar',
  'bass',
  'drum',
  'piano',
  'keyboard',
  'strings',
  'publish',
  'label',
]

/** 匹配用的归一化：小写，去掉空白、标点与符号 */
export function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
}

const lineText = (line: LyricLine) => line.words.map(word => word.text).join('').trim()

export function isCreditText(text: string): boolean {
  const lower = text.toLowerCase()
  if (CREDIT_NOTICES.some(notice => lower.includes(notice)) || CREDIT_PREFIXES.some(prefix => lower.startsWith(prefix)))
    return true
  const colon = text.slice(0, CREDIT_COLON_WITHIN).search(/[:：]/)
  if (colon < 0)
    return false
  const key = normalizeForMatch(text.slice(0, colon))
  if (!key || [...key].length > CREDIT_KEY_MAX_CHARS)
    return false
  return CREDIT_EXACT_KEYS.has(key) || CREDIT_KEYWORDS.some(keyword => key.includes(keyword))
}

function isTitleLine(text: string, title: string, artists: string[]): boolean {
  if (!title || !/[-—–]/.test(text))
    return false
  const normalized = normalizeForMatch(text)
  return normalized.includes(title) && (artists.length === 0 || artists.some(artist => normalized.includes(artist)))
}

export function stripCredits(lines: LyricLine[], track?: LyricTrackInfo | null): LyricLine[] {
  if (lines.length <= 1)
    return lines
  const title = track ? normalizeForMatch(track.name) : ''
  const artists = (track?.artists ?? []).map(normalizeForMatch).filter(Boolean)
  const isMetadata = (line: LyricLine) => {
    const text = lineText(line)
    return !text || isCreditText(text) || isTitleLine(text, title, artists)
  }
  const isHeading = (line: LyricLine) => {
    const text = normalizeForMatch(lineText(line))
    return !!text && (text === title || artists.includes(text))
  }

  let head = 0
  while (head < Math.min(lines.length, HEAD_MAX_LINES) && (isMetadata(lines[head]) || (head < HEADING_MAX_LINES && isHeading(lines[head]))))
    head++
  let tail = lines.length
  while (tail > Math.max(head, lines.length - TAIL_MAX_LINES) && isMetadata(lines[tail - 1]))
    tail--
  if (head >= tail)
    return lines
  return head === 0 && tail === lines.length ? lines : lines.slice(head, tail)
}
