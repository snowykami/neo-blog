import { describe, expect, it } from 'vitest'
import { formatCompactNumber } from './number'

describe('formatCompactNumber', () => {
  it('formats numbers under 1000 without unit suffix', () => {
    expect(formatCompactNumber(0)).toBe('0')
    expect(formatCompactNumber(42)).toBe('42')
    expect(formatCompactNumber(999)).toBe('999')
  })

  it('formats thousands, millions, and billions using K, M, and B', () => {
    expect(formatCompactNumber(1_000)).toBe('1K')
    expect(formatCompactNumber(1_250)).toBe('1.3K')
    expect(formatCompactNumber(12_340)).toBe('12.3K')
    expect(formatCompactNumber(100_000)).toBe('100K')
    expect(formatCompactNumber(1_000_000)).toBe('1M')
    expect(formatCompactNumber(8_240_000)).toBe('8.2M')
    expect(formatCompactNumber(20_000_000)).toBe('20M')
    expect(formatCompactNumber(1_500_000_000)).toBe('1.5B')
  })

  it('promotes boundary values instead of outputting 1000K or 1000M', () => {
    expect(formatCompactNumber(999_949)).toBe('999.9K')
    expect(formatCompactNumber(999_950)).toBe('1M')
    expect(formatCompactNumber(999_950_000)).toBe('1B')
  })

  it('handles negative and non-finite inputs safely', () => {
    expect(formatCompactNumber(-12_300)).toBe('-12.3K')
    expect(formatCompactNumber(Number.NaN)).toBe('0')
    expect(formatCompactNumber(Number.POSITIVE_INFINITY)).toBe('0')
  })
})
