import { htmlToText } from './string'

// 阅读分钟数（按每分钟约 270 字估算），content 为纯文本或 HTML 均可
export function calculateReadingTime(content: string): number {
  return readingTimeFromWords(countWords(content))
}

// 由字数估算阅读分钟数，至少 1 分钟
export function readingTimeFromWords(words: number): number {
  return Math.max(1, Math.ceil(words / 270))
}

// 正文字数：去掉标签与空白后的字符数（中文按字计）
export function countWords(content: string): number {
  return htmlToText(content).replace(/\s/g, '').length
}
