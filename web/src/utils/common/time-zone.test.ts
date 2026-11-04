import { describe, expect, it } from 'vitest'
import {
  formatUtcOffset,
  getDateInTimeZone,
  getTimeZoneDisplayName,
  getTimeZoneOffset,
  isValidTimeZone,
  listTimeZones,
  TIME_ZONE_PRESETS,
} from './time-zone'

// 北美处于夏令时的时刻：纽约为 UTC-4，东京当天已是第二天早上
const SUMMER = new Date('2026-07-01T20:30:00Z')
const WINTER = new Date('2026-01-01T20:30:00Z')

describe('time zone utils', () => {
  it('accepts only standard IANA time zones, same as the backend', () => {
    for (const zone of ['Asia/Tokyo', 'UTC', 'Etc/GMT-8', 'America/Argentina/Buenos_Aires', 'America/Port-au-Prince', 'Asia/Calcutta'])
      expect(isValidTimeZone(zone), zone).toBe(true)
    for (const zone of ['', 'Local', 'EST', 'PST8PDT', 'GMT', 'UTC+8', '北京时间', 'Asia/tokyo', 'asia/Tokyo', 'Mars/Olympus', 'Asia/Shanghai/'])
      expect(isValidTimeZone(zone), zone).toBe(false)
  })

  it('has valid, unique presets', () => {
    expect(TIME_ZONE_PRESETS.every(preset => isValidTimeZone(preset.timeZone))).toBe(true)
    expect(new Set(TIME_ZONE_PRESETS.map(preset => preset.timeZone)).size).toBe(TIME_ZONE_PRESETS.length)
  })

  it('lists time zones with UTC', () => {
    const zones = listTimeZones()
    expect(zones).toContain('UTC')
    expect(zones).toContain('Asia/Tokyo')
  })

  it('computes offsets including DST and non-hour offsets', () => {
    expect(getTimeZoneOffset('Asia/Tokyo', SUMMER)).toBe(540)
    expect(getTimeZoneOffset('America/New_York', SUMMER)).toBe(-240)
    expect(getTimeZoneOffset('America/New_York', WINTER)).toBe(-300)
    expect(getTimeZoneOffset('Asia/Kathmandu', SUMMER)).toBe(345)
    expect(getTimeZoneOffset('America/St_Johns', WINTER)).toBe(-210)
    expect(getTimeZoneOffset('UTC', SUMMER)).toBe(0)
  })

  it('formats UTC offsets', () => {
    expect(formatUtcOffset(540)).toBe('UTC+9')
    expect(formatUtcOffset(345)).toBe('UTC+5:45')
    expect(formatUtcOffset(-210)).toBe('UTC-3:30')
    expect(formatUtcOffset(0)).toBe('UTC')
  })

  it('returns localized names and skips bare GMT offsets', () => {
    expect(getTimeZoneDisplayName('Asia/Tokyo', 'en', SUMMER)).toBe('Japan Standard Time')
    expect(getTimeZoneDisplayName('UTC', 'en', SUMMER)).toBe('Coordinated Universal Time')
    expect(getTimeZoneDisplayName('Etc/GMT-9', 'en', SUMMER)).toBe('')
  })

  it('gets the local date in a time zone', () => {
    expect(getDateInTimeZone('Asia/Tokyo', SUMMER)).toBe('2026-07-02')
    expect(getDateInTimeZone('America/New_York', SUMMER)).toBe('2026-07-01')
  })
})
