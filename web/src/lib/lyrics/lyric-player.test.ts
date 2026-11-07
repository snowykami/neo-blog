import { describe, expect, it } from 'vitest'
import { lineAppearance } from './lyric-player'

const base = { inactiveAlpha: 0.35, blurFactor: 1, noBlur: false, spot: 0, spotted: false }

describe('歌词行的不透明度与模糊（8.5、7.2k）', () => {
  it('按距焦点的行距模糊，焦点行与在唱的行清晰', () => {
    expect(lineAppearance({ ...base, active: true, distance: 0 })).toEqual({ alpha: 1, blur: 0 })
    // 重叠的对唱、背景和声：不是焦点但正在唱
    expect(lineAppearance({ ...base, active: true, distance: 1 })).toEqual({ alpha: 1, blur: 0 })
    expect(lineAppearance({ ...base, active: false, distance: 2 })).toEqual({ alpha: 0.35, blur: 3 })
    expect(lineAppearance({ ...base, active: false, distance: 9 }).blur).toBe(5)
    expect(lineAppearance({ ...base, active: false, distance: 2, blurFactor: 0.5 }).blur).toBe(1.5)
  })

  it('聚光灯只压低不在唱的其余行，同时在唱的行与焦点行保持原样', () => {
    const spot = { ...base, spot: 1 }
    expect(lineAppearance({ ...spot, active: true, distance: 0, spotted: true })).toEqual({ alpha: 1, blur: 0 })
    // 与点题句同时在唱的另一句（对唱、背景和声）不变淡、不变虚
    expect(lineAppearance({ ...spot, active: true, distance: 1 })).toEqual({ alpha: 1, blur: 0 })
    expect(lineAppearance({ ...spot, active: false, distance: 0 })).toEqual({ alpha: 0.35, blur: 0 })
    // 不在唱的行：变淡到 0.24，模糊至少 2.5px
    expect(lineAppearance({ ...spot, active: false, distance: 1 })).toEqual({ alpha: 0.24, blur: 2.5 })
    expect(lineAppearance({ ...spot, active: false, distance: 4 })).toEqual({ alpha: 0.24, blur: 5 })
    // 强度一半时按比例过渡
    const half = lineAppearance({ ...base, spot: 0.5, active: false, distance: 1 })
    expect(half.alpha).toBeCloseTo(0.295)
    expect(half.blur).toBe(2)
  })

  it('减少动态效果或手动滚动时不模糊', () => {
    expect(lineAppearance({ ...base, noBlur: true, active: false, distance: 3 }).blur).toBe(0)
  })
})
