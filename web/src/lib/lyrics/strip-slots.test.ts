import type { StripLine } from './strip-slots'
import { describe, expect, it } from 'vitest'
import { placeStripLines } from './strip-slots'

const line = (index: number, { duet = false, background = false, ownedByFocus = false } = {}): StripLine => ({ index, duet, background, ownedByFocus })

describe('placeStripLines', () => {
  it('焦点句单独在唱时不分层', () => {
    expect(placeStripLines(line(3), []).size).toBe(0)
  })

  it('两句时焦点句在上、另一句在下，铺满整行', () => {
    const slots = placeStripLines(line(3), [line(4, { duet: true })])
    expect(slots.get(3)).toEqual({ row: 'top', half: false })
    expect(slots.get(4)).toEqual({ row: 'bottom', half: false })
  })

  it('同一位歌手的三句不分格：下层优先放焦点句的背景和声', () => {
    const slots = placeStripLines(line(3), [line(4, { background: true, ownedByFocus: true }), line(5)])
    expect(slots.size).toBe(2)
    expect(slots.get(4)).toEqual({ row: 'bottom', half: false })
  })

  it('两位歌手各有主唱与和声时分成四格', () => {
    // 天天天国地獄国 3:28 起：v2 主唱与和声、v1 主唱与和声同时在唱
    const slots = placeStripLines(line(10, { duet: true }), [line(11, { duet: true, background: true, ownedByFocus: true }), line(12), line(13, { background: true })])
    expect([...slots]).toEqual([
      [10, { row: 'top', half: true }],
      [11, { row: 'bottom', half: true }],
      [12, { row: 'top', half: true }],
      [13, { row: 'bottom', half: true }],
    ])
  })

  it('三句时按歌手分列，空出的格不补', () => {
    const slots = placeStripLines(line(10), [line(11, { background: true, ownedByFocus: true }), line(12, { duet: true })])
    expect(slots.get(10)).toEqual({ row: 'top', half: true })
    expect(slots.get(11)).toEqual({ row: 'bottom', half: true })
    expect(slots.get(12)).toEqual({ row: 'top', half: true })
  })

  it('同一格已有句子时放到同列的另一排，两排都满时不显示', () => {
    const slots = placeStripLines(line(10), [line(11), line(12), line(13, { duet: true })])
    expect(slots.get(10)).toEqual({ row: 'top', half: true })
    expect(slots.get(11)).toEqual({ row: 'bottom', half: true })
    expect(slots.has(12)).toBe(false)
    expect(slots.get(13)).toEqual({ row: 'top', half: true })
  })
})
