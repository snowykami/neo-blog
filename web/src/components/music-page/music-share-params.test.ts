import { describe, expect, it } from 'vitest'
import { buildMusicShareSearch, formatMusicStart, parseMusicShareParams } from './music-share-params'

describe('播放器页分享参数', () => {
  it('解析 id 与 start（保留小数），不合法的值视为没有', () => {
    expect(parseMusicShareParams('?id=105&start=63.48')).toEqual({ id: 105, start: 63.48 })
    expect(parseMusicShareParams('?id=abc&start=-1')).toEqual({ id: null, start: null })
    expect(parseMusicShareParams('?id=1.5&start=')).toEqual({ id: null, start: null })
    expect(parseMusicShareParams('')).toEqual({ id: null, start: null })
  })

  it('写入时保留两位小数并保留其他参数', () => {
    expect(formatMusicStart(63.4789)).toBe('63.48')
    expect(formatMusicStart(Number.NaN)).toBe('0.00')
    expect(buildMusicShareSearch('?from=share&start=1', 105, 7)).toBe('?from=share&start=7.00&id=105')
  })
})
