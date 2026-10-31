import { describe, expect, it } from 'vitest'
import { BUILTIN_THEME_MAP, resolveActiveTheme, resolveScheduledTheme } from './index'
import { isWithinRange, matchesSchedule } from './triggers'
import { parseThemeDefinition } from './types'

/** 用固定时刻（北京时间的正午）构造时间，避免测试机器时区影响结果 */
function beijingNoon(date: string) {
  return new Date(`${date}T04:00:00Z`)
}

describe('isWithinRange', () => {
  it('普通区间按首尾包含判断', () => {
    expect(isWithinRange(610, [[6, 10], [7, 10]])).toBe(true)
    expect(isWithinRange(820, [[6, 10], [7, 10]])).toBe(false)
  })

  it('from > to 时按跨年区间处理', () => {
    // 腊月廿八 ~ 正月初七
    expect(isWithinRange(101, [[12, 28], [1, 7]])).toBe(true)
    expect(isWithinRange(1230, [[12, 28], [1, 7]])).toBe(true)
    expect(isWithinRange(108, [[12, 28], [1, 7]])).toBe(false)
  })
})

describe('matchesSchedule', () => {
  it('公历区间', () => {
    expect(matchesSchedule({ solar: [[12, 20], [12, 26]] }, beijingNoon('2026-12-25'))).toBe(true)
    expect(matchesSchedule({ solar: [[12, 20], [12, 26]] }, beijingNoon('2026-12-27'))).toBe(false)
  })

  it('农历区间：春节与中秋', () => {
    // 2026-02-17 是农历正月初一
    expect(matchesSchedule({ lunar: [[12, 28], [1, 7]] }, beijingNoon('2026-02-17'))).toBe(true)
    // 2026-09-25 是农历八月十五
    expect(matchesSchedule({ lunar: [[8, 14], [8, 16]] }, beijingNoon('2026-09-25'))).toBe(true)
    expect(matchesSchedule({ lunar: [[8, 14], [8, 16]] }, beijingNoon('2026-08-15'))).toBe(false)
  })
})

describe('resolveScheduledTheme', () => {
  const themed = parseThemeDefinition({
    id: 'test-theme',
    priority: 10,
    schedule: { lunar: [[8, 14], [8, 16]] },
    tokens: { hue: 42 },
  })!
  const stronger = parseThemeDefinition({
    id: 'stronger-theme',
    priority: 20,
    schedule: { lunar: [[8, 14], [8, 16]] },
    tokens: { hue: 88 },
  })!

  it('区间重叠时取 priority 更大的', () => {
    expect(resolveScheduledTheme([themed, stronger], beijingNoon('2026-09-25'))?.id).toBe('stronger-theme')
    expect(resolveScheduledTheme([stronger, themed], beijingNoon('2026-09-25'))?.id).toBe('stronger-theme')
  })

  it('没有命中时返回 null', () => {
    expect(resolveScheduledTheme([themed], beijingNoon('2026-08-15'))).toBeNull()
  })
})

describe('内置主题', () => {
  it('春节窗口内命中春节', () => {
    expect(resolveActiveTheme(beijingNoon('2026-02-17'))?.id).toBe('spring-festival')
  })

  it('中秋当天命中中秋', () => {
    expect(resolveActiveTheme(beijingNoon('2026-09-25'))?.id).toBe('mid-autumn')
  })

  it('情人节按公历命中，且不与春节窗口重叠', () => {
    expect(resolveActiveTheme(beijingNoon('2026-02-14'))?.id).toBe('valentine')
  })

  it('平常日期不触发任何主题', () => {
    expect(resolveActiveTheme(beijingNoon('2026-08-15'))).toBeNull()
  })

  it('全年任意一天都能稳定解析（结果唯一且来自内置表）', () => {
    for (let day = 0; day < 366; day++) {
      const now = beijingNoon('2026-01-01')
      now.setUTCDate(now.getUTCDate() + day)
      const first = resolveActiveTheme(now)
      const second = resolveActiveTheme(now)
      expect(second?.id).toBe(first?.id)
      if (first)
        expect(BUILTIN_THEME_MAP.has(first.id)).toBe(true)
    }
  })
})
