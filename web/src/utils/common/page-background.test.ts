import { describe, expect, it } from 'vitest'
import { mergePageBackground, resolvePageBackground } from './page-background'

describe('resolvePageBackground', () => {
  it('蒙版颜色可单独使用：没有背景图时它就是纯色背景', () => {
    const resolved = resolvePageBackground({ veilColor: '  #101018  ', veil: 1 })
    expect(resolved.image).toBeUndefined()
    expect(resolved.veilColor).toBe('#101018')
    expect(resolved.veil).toBe(1)
  })

  it('蒙版颜色留空时返回 undefined，交给 CSS 回退到主题底色', () => {
    expect(resolvePageBackground({ veilColor: '   ' }).veilColor).toBeUndefined()
    expect(resolvePageBackground().veilColor).toBeUndefined()
  })

  it('缺省没有背景图，但默认显示节日装饰', () => {
    const resolved = resolvePageBackground()
    // 后台只暴露「背景图」一个字段：有图就生效，没图这一层只负责节日装饰
    expect(resolved.image).toBeUndefined()
    expect(resolved.decorations).toBe(true)
    expect(resolved.image).toBeUndefined()
    expect(resolved.veil).toBeCloseTo(0.72)
  })

  it('越界的模糊/不透明度/遮罩会被夹到合法区间', () => {
    const resolved = resolvePageBackground({ image: 'https://a/b.webp', blur: 999, opacity: -3, veil: 5 })
    expect(resolved.image?.blur).toBe(40)
    expect(resolved.image?.opacity).toBe(0)
    expect(resolved.veil).toBe(1)
  })

  it('没有图片时不会产出 image 字段（避免空 url() 请求）', () => {
    expect(resolvePageBackground({ image: '   ' }).image).toBeUndefined()
  })

  it('naN 回落到默认值（模糊 0、不透明度 1）', () => {
    const resolved = resolvePageBackground({ image: 'https://a/b.webp', blur: Number.NaN, opacity: Number.NaN })
    expect(resolved.image?.blur).toBe(0)
    expect(resolved.image?.opacity).toBe(1)
  })

  it('decorations 只在显式 false 时关闭', () => {
    expect(resolvePageBackground({ decorations: false }).decorations).toBe(false)
    expect(resolvePageBackground({ decorations: true }).decorations).toBe(true)
    expect(resolvePageBackground({}).decorations).toBe(true)
  })
})

describe('mergePageBackground', () => {
  it('后者覆盖前者，未提供的字段保持前者', () => {
    const merged = mergePageBackground(
      { image: 'https://a/1.webp', blur: 10, veil: 0.5 },
      { blur: 20 },
    )
    expect(merged.image?.src).toBe('https://a/1.webp')
    expect(merged.image?.blur).toBe(20)
    expect(merged.veil).toBe(0.5)
  })

  it('忽略 undefined / null，不会把已有值抹掉', () => {
    const merged = mergePageBackground(
      { image: 'https://a/1.webp' },
      { image: undefined, blur: null as unknown as number },
    )
    expect(merged.image?.src).toBe('https://a/1.webp')
  })

  it('页面级可以单独关掉装饰', () => {
    const merged = mergePageBackground({ decorations: true }, { decorations: false })
    expect(merged.decorations).toBe(false)
  })
})
