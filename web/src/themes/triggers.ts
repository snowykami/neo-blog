import type { MonthDay, MonthDayRange, ThemeDefinition, ThemeSchedule } from './types'

/**
 * 节日 / 季节性主题的触发判断。
 * 纯函数，只依赖 Intl，不引农历库：Node 与浏览器内置的中国农历历法足够判断春节、中秋等日期。
 */

// 固定时区：让所有访客在同一刻进入、退出节日主题，也保证服务端与客户端算出的结果一致
const TIME_ZONE = 'Asia/Shanghai'

const SOLAR_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  month: 'numeric',
  day: 'numeric',
})

const LUNAR_FORMAT = new Intl.DateTimeFormat('en-u-ca-chinese', {
  timeZone: TIME_ZONE,
  month: 'numeric',
  day: 'numeric',
})

/** 读取某个时区下的 [月, 日]；农历闰月的 month 形如 `6bis`，去掉后缀按常规月处理 */
function readMonthDay(format: Intl.DateTimeFormat, date: Date): MonthDay {
  const parts = format.formatToParts(date)
  const month = parts.find(part => part.type === 'month')?.value.replace('bis', '') ?? '1'
  const day = parts.find(part => part.type === 'day')?.value ?? '1'
  return [Number(month), Number(day)]
}

/** 把 [月, 日] 压成一个可比较的整数，避免每次都比较两个字段 */
function toKey([month, day]: MonthDay): number {
  return month * 100 + day
}

/** 区间判断；from > to 时按跨年区间处理（腊月廿八 ~ 正月初七） */
export function isWithinRange(key: number, [from, to]: MonthDayRange): boolean {
  const start = toKey(from)
  const end = toKey(to)
  return start <= end ? key >= start && key <= end : key >= start || key <= end
}

/** 判断某个时间点是否命中触发规则 */
export function matchesSchedule(schedule: ThemeSchedule, now: Date = new Date()): boolean {
  if (schedule.solar && isWithinRange(toKey(readMonthDay(SOLAR_FORMAT, now)), schedule.solar))
    return true
  if (schedule.lunar && isWithinRange(toKey(readMonthDay(LUNAR_FORMAT, now)), schedule.lunar))
    return true
  return false
}

/**
 * 在给定的主题集合中挑出当前生效的主题：
 * 只考虑配置了 schedule 的主题，命中多个时取 priority 最大的（中秋与国庆可能重叠）
 */
export function resolveScheduledTheme(
  themes: readonly ThemeDefinition[],
  now: Date = new Date(),
): ThemeDefinition | null {
  let picked: ThemeDefinition | null = null
  for (const theme of themes) {
    if (!theme.schedule || !matchesSchedule(theme.schedule, now))
      continue
    if (!picked || (theme.priority ?? 0) > (picked.priority ?? 0))
      picked = theme
  }
  return picked
}
