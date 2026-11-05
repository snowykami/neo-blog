// IANA 时区工具：校验、UTC 偏移与本地化名称，供个人设置和主页「当地时间」使用

/** 当前浏览器的 IANA 时区，取不到时返回空字符串 */
export function getBrowserTimeZone(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  }
  catch {
    return ''
  }
}

// 标准时区名，与后端 pkg/utils/timezone.go 一致：UTC，或 IANA「区域/地点」形式的名称，每段首字母大写；
// EST、PST8PDT 这类旧式缩写和 UTC+8、北京时间等写法都不算
const TIME_ZONE_PATTERN = /^(?:UTC|[A-Z][A-Za-z]+(?:\/[A-Z][\w+-]*){1,2})$/

/**
 * 页面上的时间按访客浏览器的时区显示（接口统一返回带时区的 ISO 时间）：浏览器把自己的时区记在这个 cookie 里，
 * 服务端渲染时按它格式化，与浏览器里一致，不受服务器所在时区影响（见 i18n/request.ts 与 TimeZoneSync）
 */
export const TIME_ZONE_COOKIE = 'time_zone'

/** 还不知道浏览器时区时（第一次访问、搜索引擎爬虫）显示时间用的时区 */
export const DEFAULT_TIME_ZONE = 'Asia/Shanghai'

/** 显示时间用的时区：cookie 里记录的浏览器时区有效时用它，否则用默认时区 */
export function resolveDisplayTimeZone(cookieValue: string | null | undefined): string {
  return cookieValue && isValidTimeZone(cookieValue) ? cookieValue : DEFAULT_TIME_ZONE
}

/** 主流时区预设，id 对应 TimeZone.presets 下的城市名文案 */
export const TIME_ZONE_PRESETS = [
  { id: 'utc', timeZone: 'UTC' },
  { id: 'shanghai', timeZone: 'Asia/Shanghai' },
  { id: 'hong_kong', timeZone: 'Asia/Hong_Kong' },
  { id: 'taipei', timeZone: 'Asia/Taipei' },
  { id: 'tokyo', timeZone: 'Asia/Tokyo' },
  { id: 'seoul', timeZone: 'Asia/Seoul' },
  { id: 'singapore', timeZone: 'Asia/Singapore' },
  { id: 'kolkata', timeZone: 'Asia/Kolkata' },
  { id: 'dubai', timeZone: 'Asia/Dubai' },
  { id: 'moscow', timeZone: 'Europe/Moscow' },
  { id: 'berlin', timeZone: 'Europe/Berlin' },
  { id: 'paris', timeZone: 'Europe/Paris' },
  { id: 'london', timeZone: 'Europe/London' },
  { id: 'new_york', timeZone: 'America/New_York' },
  { id: 'chicago', timeZone: 'America/Chicago' },
  { id: 'los_angeles', timeZone: 'America/Los_Angeles' },
  { id: 'sydney', timeZone: 'Australia/Sydney' },
] as const

export type TimeZonePresetId = typeof TIME_ZONE_PRESETS[number]['id']

/** 是否为标准时区：格式符合且浏览器认识 */
export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone.length > 64 || !TIME_ZONE_PATTERN.test(timeZone))
    return false
  try {
    // eslint-disable-next-line no-new
    new Intl.DateTimeFormat('en', { timeZone })
    return true
  }
  catch {
    return false
  }
}

/** 可选的时区：浏览器支持的全部 IANA 时区，列表里没有 UTC 时补上 */
export function listTimeZones(): string[] {
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  return zones.includes('UTC') ? zones : ['UTC', ...zones]
}

function timeZoneNamePart(timeZone: string, locale: string, date: Date, timeZoneName: Intl.DateTimeFormatOptions['timeZoneName']) {
  return new Intl.DateTimeFormat(locale, { timeZone, timeZoneName })
    .formatToParts(date)
    .find(part => part.type === 'timeZoneName')
    ?.value ?? ''
}

/** 时区在指定时刻相对 UTC 的偏移（分钟，东区为正），会随夏令时变化 */
export function getTimeZoneOffset(timeZone: string, date: Date): number {
  // en-US 的 longOffset 形如 GMT+09:00、GMT-03:30，零偏移时只有 GMT
  const match = /([+-])(\d{2}):(\d{2})/.exec(timeZoneNamePart(timeZone, 'en-US', date, 'longOffset'))
  if (!match)
    return 0
  const minutes = Number(match[2]) * 60 + Number(match[3])
  return match[1] === '-' ? -minutes : minutes
}

/** UTC 偏移的展示形式：UTC+9、UTC+5:45、UTC-3:30，零偏移为 UTC */
export function formatUtcOffset(minutes: number): string {
  if (minutes === 0)
    return 'UTC'
  const abs = Math.abs(minutes)
  const rest = abs % 60
  return `UTC${minutes > 0 ? '+' : '-'}${Math.floor(abs / 60)}${rest ? `:${String(rest).padStart(2, '0')}` : ''}`
}

/** 本地化的时区名称，如「日本标准时间」「北美东部时间」；只能显示成 GMT 偏移的时区返回空字符串 */
export function getTimeZoneDisplayName(timeZone: string, locale: string, date: Date): string {
  for (const style of ['longGeneric', 'long'] as const) {
    const name = timeZoneNamePart(timeZone, locale, date, style)
    if (name && !/^(?:GMT|UTC)(?:[+-]|$)/.test(name))
      return name
  }
  return ''
}

/** 时区在指定时刻的日期（YYYY-MM-DD），用于判断与访问者是否在同一天 */
export function getDateInTimeZone(timeZone: string, date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}
