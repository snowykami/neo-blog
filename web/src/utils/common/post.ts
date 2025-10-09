// 阅读分钟数
export function calculateReadingTime(content: string): number {
  const words = content.length
  const readingTime = Math.ceil(words / 270)
  return readingTime
}
