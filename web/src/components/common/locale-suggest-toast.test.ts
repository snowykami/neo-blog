import { describe, expect, it } from 'vitest'
import { detectBrowserTargetLocale } from './locale-suggest-toast'

describe('detectBrowserTargetLocale', () => {
  it('按浏览器语言顺序匹配支持的界面语言', () => {
    expect(detectBrowserTargetLocale(['en-US', 'zh-CN'])).toBe('en')
    expect(detectBrowserTargetLocale(['ja-JP', 'en'])).toBe('ja')
    expect(detectBrowserTargetLocale(['zh-Hant-TW', 'en'])).toBe('zh-TW')
    expect(detectBrowserTargetLocale(['zh-Hans-CN'])).toBe('zh-CN')
  })

  it('浏览器带有不支持的语言时回退到默认英文', () => {
    expect(detectBrowserTargetLocale(['fr-FR', 'de-DE'])).toBe('en')
  })

  it('无语言偏好时返回 undefined', () => {
    expect(detectBrowserTargetLocale([])).toBeUndefined()
    expect(detectBrowserTargetLocale(undefined)).toBeUndefined()
  })
})
