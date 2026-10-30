import { describe, expect, it } from 'vitest'
import { placeRuby, rubyGroups, rubyText } from './ruby-layout'

const part = (text: string, word: number) => ({ text, start: 0, end: 0, word })

describe('注音行', () => {
  it('显示时去掉音译首尾的空白与标点', () => {
    expect(rubyText('i  、')).toBe('i')
    expect(rubyText('u  。')).toBe('u')
    expect(rubyText('ka ')).toBe('ka')
    expect(rubyText('、')).toBe('')
  })

  it('按字分组：网易云每个音拍后都有空格，同一个字的音拍连在一起；只剩标点的段丢弃', () => {
    // ただ暖かい、感情。 的网易云音译：ta da a ta ta ka i 、 ka n jo u 。
    const parts = [part('ta ', 0), part('da ', 1), part('a ', 2), part('ta ', 2), part('ta ', 2), part('ka ', 3), part('i  、', 4), part('ka ', 6), part('n ', 6), part('jo ', 7), part('u  。', 7)]
    const groups = rubyGroups(parts).map(group => [group.word, group.parts.map(item => rubyText(item.text)).join('')])
    expect(groups).toEqual([[0, 'ta'], [1, 'da'], [2, 'atata'], [3, 'ka'], [4, 'i'], [6, 'kan'], [7, 'jou']])
    expect(rubyGroups([part('、', 5)])).toEqual([])
  })

  it('第一个音拍对准字的中心，音译可以伸到相邻的字下面', () => {
    // 两个 30px 宽的字，音译 10px 宽：各自居中，不推移
    const placed = placeRuby([
      { left: 0, top: 0, charWidth: 30, firstWidth: 10, rubyWidth: 10 },
      { left: 30, top: 0, charWidth: 30, firstWidth: 10, rubyWidth: 10 },
    ], 4)
    expect(placed).toEqual([{ shift: 0, offset: 10 }, { shift: 0, offset: 10 }])
    // 音译从 12 到 32，伸出字的右边缘（30）到下一个字下面；下一段从 39 开始，间距够，不推
    const overhang = placeRuby([
      { left: 0, top: 0, charWidth: 30, firstWidth: 6, rubyWidth: 20 },
      { left: 30, top: 0, charWidth: 30, firstWidth: 12, rubyWidth: 12 },
    ], 4)
    expect(overhang[1].shift).toBe(0)
  })

  it('与前一段音译重叠时推后，推移累加到同一排后面的字；换排后重新开始', () => {
    const placed = placeRuby([
      // 音译从 12 到 62
      { left: 0, top: 0, charWidth: 30, firstWidth: 6, rubyWidth: 50 },
      // 原本从 39 开始，需不早于 66：推后 27
      { left: 30, top: 0, charWidth: 30, firstWidth: 12, rubyWidth: 12 },
      // 原本从 69 开始，加上前面的 27 为 96，在 66 + 12 + 4 = 82 之后，不再推
      { left: 60, top: 0, charWidth: 30, firstWidth: 12, rubyWidth: 12 },
      // 换排
      { left: 0, top: 40, charWidth: 30, firstWidth: 12, rubyWidth: 12 },
    ], 4)
    expect(placed.map(item => item.shift)).toEqual([0, 27, 0, 0])
  })
})
