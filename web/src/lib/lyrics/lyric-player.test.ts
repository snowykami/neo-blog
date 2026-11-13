import type { ResolvedLyrics } from './types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lineAppearance, LyricPlayer } from './lyric-player'

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

describe('振假名渲染与 HDR 跨行平滑退场', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mountPlayer(lyrics: ResolvedLyrics, opts?: { strip?: boolean, hdr?: boolean }) {
    let currentSec = 0
    let rafCb: FrameRequestCallback | null = null
    let nowMs = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCb = cb
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
      rafCb = null
    })

    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 480, configurable: true })
    Object.defineProperty(container, 'clientHeight', { value: 640, configurable: true })
    document.body.append(container)

    const player = new LyricPlayer(container, {
      getTime: () => currentSec,
      isPlaying: () => true,
      onSeek: () => {},
      strip: opts?.strip,
    })
    player.setDisplay({
      showTranslation: true,
      showRomanization: true,
      footerText: '',
      effects: true,
      hdr: opts?.hdr ?? false,
    })
    player.setLyrics(lyrics)

    const step = (sec: number, deltaMs: number) => {
      currentSec = sec
      nowMs += deltaMs
      player.wake()
      const cb = rafCb
      rafCb = null
      cb?.(nowMs)
    }

    return {
      container,
      player,
      step,
      cleanup: () => {
        player.dispose()
        container.remove()
      },
    }
  }

  const sampleLyrics: ResolvedLyrics = {
    source: 'ttml-amll',
    wordTimed: true,
    instrumental: false,
    lines: [
      {
        words: [{
          text: '明日',
          start: 1000,
          end: 1600,
          ruby: [
            { text: 'あ', start: 1000, end: 1200 },
            { text: 'し', start: 1200, end: 1400 },
            { text: 'た', start: 1400, end: 1600 },
          ],
        }],
        start: 1000,
        end: 1600,
        isDuet: false,
        isBackground: false,
      },
      {
        words: [{ text: '光', start: 1700, end: 2500 }],
        start: 1700,
        end: 2500,
        isDuet: false,
        isBackground: false,
      },
    ],
  }

  it('非单行条渲染上方振假名分片，strip 单行条不渲染振假名', () => {
    const full = mountPlayer(sampleLyrics, { strip: false })
    expect(full.container.querySelectorAll('.lyric-furigana .lyric-word')).toHaveLength(3)
    expect(Array.from(full.container.querySelectorAll('.lyric-furigana .lyric-word'), el => el.textContent)).toEqual(['あ', 'し', 'た'])
    full.cleanup()

    const strip = mountPlayer(sampleLyrics, { strip: true })
    expect(strip.container.querySelectorAll('.lyric-furigana')).toHaveLength(0)
    strip.cleanup()
  })

  it('跨行退场时 HDR 亮度在 0.4s 内平滑过渡且避让模糊滤镜，结束后清理退场态', () => {
    const ctx = mountPlayer(sampleLyrics, { hdr: true })
    // 第一行正在唱
    ctx.step(1.2, 16)
    const lines = ctx.container.querySelectorAll<HTMLElement>('.lyric-line')
    expect(lines[0].classList.contains('lyric-line--active')).toBe(true)
    expect(lines[0].style.filter).toBe('')

    // 推进到第二行：第一行进入 400ms HDR 退场窗口，filter 保持为空防止白块闪烁
    ctx.step(1.8, 600)
    expect(lines[0].classList.contains('lyric-line--active')).toBe(false)
    expect(lines[0].classList.contains('lyric-line--hdr-exit')).toBe(true)
    expect(lines[0].style.getPropertyValue('--lyric-hdr-line')).toContain('data:image/png;base64,')
    expect(lines[0].style.filter).toBe('')

    // 退场进行到 200ms：词透明度处于中间插值态
    ctx.step(2.0, 200)
    expect(lines[0].classList.contains('lyric-line--hdr-exit')).toBe(true)
    const mainWord = lines[0].querySelector<HTMLElement>(':scope .lyric-unit > .lyric-word')!
    const midOpacity = Number.parseFloat(mainWord.style.opacity)
    expect(midOpacity).toBeGreaterThan(0.21)
    expect(midOpacity).toBeLessThan(1)
    expect(lines[0].style.filter).toBe('')

    // 超过 400ms 退场结束：移除 .lyric-line--hdr-exit 与 --lyric-hdr-line，恢复景深模糊
    ctx.step(2.3, 250)
    expect(lines[0].classList.contains('lyric-line--hdr-exit')).toBe(false)
    expect(lines[0].style.getPropertyValue('--lyric-hdr-line')).toBe('')
    expect(mainWord.style.opacity).toBe('')
    expect(lines[0].style.filter).toContain('blur(')
    ctx.cleanup()
  })
})
