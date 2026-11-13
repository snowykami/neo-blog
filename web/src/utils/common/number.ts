const COMPACT_UNITS = [
  { threshold: 1e9, suffix: 'B' },
  { threshold: 1e6, suffix: 'M' },
  { threshold: 1e3, suffix: 'K' },
] as const

/**
 * 大数字按国际通用 K / M / B 紧凑格式化（最多保留 1 位小数，自动进位避免出现 1000K / 1000M），
 * 不随界面语言变成「万 / 亿」
 */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value))
    return '0'
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (abs < 1000)
    return `${sign}${Math.round(abs)}`

  for (let i = 0; i < COMPACT_UNITS.length; i++) {
    const { threshold, suffix } = COMPACT_UNITS[i]
    if (abs >= threshold) {
      const scaled = Math.round((abs / threshold) * 10) / 10
      if (scaled >= 1000 && i > 0) {
        const upper = COMPACT_UNITS[i - 1]
        return `${sign}1${upper.suffix}`
      }
      const text = Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(1)
      return `${sign}${text}${suffix}`
    }
  }
  return `${sign}${Math.round(abs)}`
}
