import type { ResolvedLyrics } from './types'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lineAppearance, LyricPlayer } from './lyric-player'

const base = { inactiveAlpha: 0.35, blurFactor: 1, noBlur: false, spot: 0, spotted: false }

describe('歌词行的不透明度与模糊（8.5、7.2k）', () => {
  it('按非对称行距模糊：焦点与在唱行清晰，已唱行 3px，待唱行递增上限 4px，悬停解除模糊', () => {
    expect(lineAppearance({ ...base, active: true, distance: 0 })).toEqual({ alpha: 1, blur: 0 })
    // 重叠的对唱、背景和声：不是焦点但正在唱
    expect(lineAppearance({ ...base, active: true, distance: 1 })).toEqual({ alpha: 1, blur: 0 })
    // 待唱行递增（上限 4px）
    expect(lineAppearance({ ...base, active: false, distance: 1 })).toEqual({ alpha: 0.35, blur: 2 })
    expect(lineAppearance({ ...base, active: false, distance: 2 })).toEqual({ alpha: 0.35, blur: 3 })
    expect(lineAppearance({ ...base, active: false, distance: 9 }).blur).toBe(4)
    expect(lineAppearance({ ...base, active: false, distance: 2, blurFactor: 0.5 }).blur).toBe(1.5)
    // 已唱行统一温和模糊 3px（窄视口或紧凑模式按 blurFactor 缩放）
    expect(lineAppearance({ ...base, active: false, past: true, distance: 1 })).toEqual({ alpha: 0.35, blur: 3 })
    expect(lineAppearance({ ...base, active: false, past: true, distance: 8 })).toEqual({ alpha: 0.35, blur: 3 })
    expect(lineAppearance({ ...base, active: false, past: true, distance: 1, blurFactor: 0.5 }).blur).toBe(1.5)
    // 鼠标悬停行解除模糊
    expect(lineAppearance({ ...base, active: false, hovered: true, distance: 3 }).blur).toBe(0)
  })

  it('聚光灯只压低不在唱的其余行，同时在唱的行与焦点行保持原样', () => {
    const spot = { ...base, spot: 1 }
    expect(lineAppearance({ ...spot, active: true, distance: 0, spotted: true })).toEqual({ alpha: 1, blur: 0 })
    // 与点题句同时在唱的另一句（对唱、背景和声）不变淡、不变虚
    expect(lineAppearance({ ...spot, active: true, distance: 1 })).toEqual({ alpha: 1, blur: 0 })
    expect(lineAppearance({ ...spot, active: false, distance: 0 })).toEqual({ alpha: 0.35, blur: 0 })
    // 不在唱的行：变淡到 0.24，模糊至少 2.5px
    expect(lineAppearance({ ...spot, active: false, distance: 1 })).toEqual({ alpha: 0.24, blur: 2.5 })
    expect(lineAppearance({ ...spot, active: false, distance: 4 })).toEqual({ alpha: 0.24, blur: 4 })
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

  it('跨行退场时 HDR 保持静态素材并经由不透明度在 0.4s 内平滑过渡且避让模糊滤镜，结束后清理退场态', () => {
    const ctx = mountPlayer(sampleLyrics, { hdr: true })
    // 第一行正在唱
    ctx.step(1.2, 16)
    const lines = ctx.container.querySelectorAll<HTMLElement>('.lyric-line')
    expect(lines[0].classList.contains('lyric-line--active')).toBe(true)
    expect(lines[0].style.filter).toBe('')

    // 推进到第二行：第一行进入 400ms HDR 退场窗口，filter 保持为空防止白块闪烁，且不写入逐帧变化的 --lyric-hdr-line
    ctx.step(1.8, 600)
    expect(lines[0].classList.contains('lyric-line--active')).toBe(false)
    expect(lines[0].classList.contains('lyric-line--hdr-exit')).toBe(true)
    expect(lines[0].style.getPropertyValue('--lyric-hdr-line')).toBe('')
    expect(lines[0].style.filter).toBe('')

    // 退场进行到 200ms：词透明度处于平滑衰减中间插值态（0.115 ~ 1 之间）
    ctx.step(2.0, 200)
    expect(lines[0].classList.contains('lyric-line--hdr-exit')).toBe(true)
    const mainWord = lines[0].querySelector<HTMLElement>(':scope .lyric-unit > .lyric-word')!
    const midOpacity = Number.parseFloat(mainWord.style.opacity)
    expect(midOpacity).toBeGreaterThan(0.115)
    expect(midOpacity).toBeLessThan(1)
    expect(lines[0].style.filter).toBe('')

    // 超过 400ms 退场结束：移除 .lyric-line--hdr-exit，清理词 opacity，恢复景深模糊
    ctx.step(2.3, 250)
    expect(lines[0].classList.contains('lyric-line--hdr-exit')).toBe(false)
    expect(mainWord.style.opacity).toBe('')
    expect(lines[0].style.filter).toContain('blur(')
    ctx.cleanup()
  })

  it('强调特效词在 HDR 跨行退场期间零素材切换（防 WebKit 异步解码闪烁）并由单字 opacity 平滑衰减', () => {
    const emphasisLyrics: ResolvedLyrics = {
      source: 'ttml-amll',
      wordTimed: true,
      instrumental: false,
      spotlights: [0],
      lines: [
        {
          words: [
            { text: '星光', start: 1000, end: 1500 },
            { text: '璀璨', start: 1500, end: 2000 },
          ],
          emphasis: [{ from: 1, to: 2, start: 1500, end: 2000, factor: 1, effect: 'swell', color: 'amber' }],
          start: 1000,
          end: 2000,
          isDuet: false,
          isBackground: false,
        },
        {
          words: [{ text: '下一句', start: 2100, end: 3000 }],
          start: 2100,
          end: 3000,
          isDuet: false,
          isBackground: false,
        },
      ],
    }

    const ctx = mountPlayer(emphasisLyrics, { hdr: true })
    ctx.step(1.8, 16)
    const line0 = ctx.container.querySelectorAll<HTMLElement>('.lyric-line')[0]
    const emphasisWord = line0.querySelector<HTMLElement>('.lyric-word--emphasis')!
    const chars = emphasisWord.querySelectorAll<HTMLElement>('.lyric-char')
    const activeBg = chars[0].style.backgroundImage
    expect(activeBg).toContain('data:image/png;base64,')
    expect(line0.classList.contains('lyric-line--spot')).toBe(true)

    // 切到下一行，逐帧走过退场窗口：单字 backgroundImage 必须与激活态完全一致（零重新解码），外层强调词不建组透明度层
    ctx.step(2.2, 400)
    expect(line0.classList.contains('lyric-line--hdr-exit')).toBe(true)
    expect(line0.classList.contains('lyric-line--spot')).toBe(true)
    expect(chars[0].style.backgroundImage).toBe(activeBg)
    expect(emphasisWord.style.opacity).toBe('')

    ctx.step(2.3, 100)
    expect(chars[0].style.backgroundImage).toBe(activeBg)
    expect(emphasisWord.style.opacity).toBe('')
    const charOpacity100 = Number.parseFloat(chars[0].style.opacity)
    expect(charOpacity100).toBeGreaterThan(0.05)
    expect(charOpacity100).toBeLessThan(1)

    ctx.step(2.45, 150)
    expect(chars[0].style.backgroundImage).toBe(activeBg)
    const charOpacity250 = Number.parseFloat(chars[0].style.opacity)
    expect(charOpacity250).toBeLessThan(charOpacity100)

    // 退场满 400ms 后彻底卸下 HDR 素材、聚光灯类名与单字 opacity，恢复景深模糊
    ctx.step(2.7, 200)
    expect(line0.classList.contains('lyric-line--hdr-exit')).toBe(false)
    expect(line0.classList.contains('lyric-line--spot')).toBe(false)
    expect(chars[0].style.backgroundImage).toBe('')
    expect(chars[0].style.color).toBe('')
    expect(chars[0].style.opacity).toBe('')
    expect(line0.style.filter).toContain('blur(')
    ctx.cleanup()
  })

  it('多歌手布局类、居中合唱、间奏跟随对齐、背景折叠展开与段落间距', () => {
    const multiLyrics: ResolvedLyrics = {
      source: 'ttml-amll',
      wordTimed: true,
      instrumental: false,
      lines: [
        { words: [{ text: '独唱', start: 9000, end: 11000 }], start: 9000, end: 11000, isDuet: false, isBackground: false, align: 'center' },
        { words: [{ text: '(前置和声)', start: 11200, end: 11800 }], start: 11200, end: 11800, isDuet: false, isBackground: true, backgroundPosition: 'above' },
        { words: [{ text: '主行', start: 11500, end: 13000 }], start: 11500, end: 13000, isDuet: false, isBackground: false, align: 'left' },
        { words: [{ text: '新段落对唱', start: 13200, end: 15000 }], start: 13200, end: 15000, isDuet: true, isBackground: false, align: 'right', paragraphStart: true },
      ],
    }

    const ctx = mountPlayer(multiLyrics)
    ctx.container.querySelectorAll<HTMLElement>('.lyric-line').forEach((el) => {
      Object.defineProperty(el, 'offsetHeight', { value: el.classList.contains('lyric-line--bg') ? 28 : 40, configurable: true })
    })

    // 初次挂载在 t=0 处前奏间奏
    ctx.step(0, 16)
    expect(ctx.container.classList.contains('lyric-player--multi-vocal')).toBe(true)
    const interlude = ctx.container.querySelector<HTMLElement>('.lyric-interlude')!
    expect(interlude.classList.contains('lyric-interlude--center')).toBe(true)

    const lineEls = ctx.container.querySelectorAll<HTMLElement>('.lyric-line')
    expect(lineEls[0].classList.contains('lyric-line--center')).toBe(true)
    expect(lineEls[3].classList.contains('lyric-line--duet')).toBe(true)
    expect(lineEls[3].classList.contains('lyric-line--para')).toBe(true)

    // 背景人声未唱到时折叠：opacity=0，scale=0.88，带 collapsed 与 aria-hidden
    expect(lineEls[1].classList.contains('lyric-line--collapsed')).toBe(true)
    expect(lineEls[1].getAttribute('aria-hidden')).toBe('true')
    expect(Number.parseFloat(lineEls[1].style.opacity)).toBe(0)
    expect(lineEls[1].style.transform).toContain('scale(0.8800)')

    // 段落间距验证（第 2 行与第 3 行间额外包含 0.45 * 16 = 7.2px 段落间距）
    const topY = (el: HTMLElement) => Number.parseFloat(/translate3d\(0px,\s*([-\d.]+)px/.exec(el.style.transform)?.[1] ?? /translate3d\(0,\s*([-\d.]+)px/.exec(el.style.transform)?.[1] ?? '0')
    expect(topY(lineEls[3]) - topY(lineEls[2])).toBeCloseTo(40 + 7.2, 1)

    // 跳转到前置背景行时间窗口：弹簧展开可见
    ctx.step(11.3, 16)
    expect(lineEls[1].classList.contains('lyric-line--collapsed')).toBe(false)
    expect(lineEls[1].hasAttribute('aria-hidden')).toBe(false)
    expect(Number.parseFloat(lineEls[1].style.opacity)).toBeCloseTo(0.75, 2)
    expect(lineEls[1].style.transform).toContain('scale(1.0000)')

    // 离开所属主行到下一段：重新开始折叠
    ctx.step(13.5, 16)
    for (let i = 0; i < 40; i++)
      ctx.step(13.5, 16)
    expect(lineEls[1].classList.contains('lyric-line--collapsed')).toBe(true)
    expect(Number.parseFloat(lineEls[1].style.opacity)).toBeLessThan(0.05)

    ctx.cleanup()
  })

  it('鼠标悬停解除模糊、按压缩放回弹、手动滚动整体提亮非激活行', () => {
    const lyrics: ResolvedLyrics = {
      source: 'ttml-amll',
      wordTimed: true,
      instrumental: false,
      lines: [
        { words: [{ text: '第一行', start: 1000, end: 2000 }], start: 1000, end: 2000, isDuet: false, isBackground: false },
        { words: [{ text: '第二行', start: 2000, end: 3000 }], start: 2000, end: 3000, isDuet: false, isBackground: false },
        { words: [{ text: '第三行', start: 3000, end: 4000 }], start: 3000, end: 4000, isDuet: false, isBackground: false },
      ],
    }

    const ctx = mountPlayer(lyrics)
    const lines = ctx.container.querySelectorAll<HTMLElement>('.lyric-line')
    const captureColors = (el: HTMLElement) => {
      const real = el.style
      const colors: string[] = []
      const proxy = new Proxy(real, {
        set(target, prop, val) {
          if (prop === 'color')
            colors.push(String(val))
          return Reflect.set(target, prop, val)
        },
      })
      Object.defineProperty(el, 'style', { get: () => proxy, configurable: true })
      return colors
    }
    const line1Colors = captureColors(lines[1])
    const line2Colors = captureColors(lines[2])

    ctx.step(1.2, 16)
    expect(lines[2].style.filter).toContain('blur(')
    expect(line2Colors.at(-1)).toContain('35.0%')

    // 鼠标悬停第三行：解除模糊
    const moveEv = Object.assign(new Event('pointermove', { bubbles: true }), { pointerType: 'mouse' })
    lines[2].dispatchEvent(moveEv)
    ctx.step(1.25, 16)
    expect(lines[2].style.filter).toBe('')

    // 鼠标按压第三行：向 0.96 缩放；松手回弹
    const downEv = Object.assign(new Event('pointerdown', { bubbles: true }), { pointerType: 'mouse', button: 0 })
    lines[2].dispatchEvent(downEv)
    for (let i = 0; i < 10; i++)
      ctx.step(1.25, 16)
    const pressedScale = Number.parseFloat(/scale\(([\d.]+)\)/.exec(lines[2].style.transform)?.[1] ?? '1')
    expect(pressedScale).toBeLessThan(0.96)
    const upEv = Object.assign(new Event('pointerup', { bubbles: true }), { pointerType: 'mouse', button: 0 })
    lines[2].dispatchEvent(upEv)
    for (let i = 0; i < 40; i++)
      ctx.step(1.3, 16)
    const releasedScale = Number.parseFloat(/scale\(([\d.]+)\)/.exec(lines[2].style.transform)?.[1] ?? '0')
    expect(releasedScale).toBeGreaterThan(0.96)

    // 滚轮手动滚动：非激活行提亮至 50% 且取消全部模糊
    const wheelEv = Object.assign(new Event('wheel', { bubbles: true, cancelable: true }), { deltaMode: 0, deltaY: 20 })
    ctx.container.dispatchEvent(wheelEv)
    ctx.step(1.35, 16)
    expect(line1Colors.at(-1)).toContain('50.0%')
    expect(lines[1].style.filter).toBe('')

    ctx.cleanup()
  })

  it('多演唱者（对齐 StarryPlayer）：待唱起手预标、演唱中胶囊逐行跟随当前行、全左置实心竖条及聚光灯让路', () => {
    const namedMulti: ResolvedLyrics = {
      source: 'ttml-amll',
      wordTimed: true,
      instrumental: false,
      spotlights: [1, 3],
      agents: {
        v1: { id: 'v1', name: '甲', color: 'sky' },
        v2: { id: 'v2', name: '乙', color: 'rose' },
        v1000: { id: 'v1000', color: 'lavender', isGroup: true },
      },
      lines: [
        { words: [{ text: '甲首句', start: 200, end: 800 }], start: 200, end: 800, isDuet: false, isBackground: false, align: 'left', agent: 'v1' },
        { words: [{ text: '甲同段', start: 900, end: 1800 }], start: 900, end: 1800, isDuet: false, isBackground: false, align: 'left', agent: 'v1' },
        { words: [{ text: '甲新段', start: 1900, end: 2500 }], start: 1900, end: 2500, isDuet: false, isBackground: false, align: 'left', agent: 'v1', paragraphStart: true },
        { words: [{ text: '乙对唱', start: 2600, end: 3200 }], start: 2600, end: 3200, isDuet: true, isBackground: false, align: 'right', agent: 'v2' },
        { words: [{ text: '乙和声', start: 2700, end: 3100 }], start: 2700, end: 3100, isDuet: true, isBackground: true, align: 'right', agent: 'v2' },
        { words: [{ text: '大合唱', start: 3300, end: 4000 }], start: 3300, end: 4000, isDuet: false, isBackground: false, align: 'center', agent: 'v1000' },
      ],
    }

    const ctx = mountPlayer(namedMulti)
    ctx.player.setDisplay({ showTranslation: true, showRomanization: true, footerText: '', togetherLabel: '合唱', effects: true, hdr: false })
    const lineEls = Array.from(ctx.container.querySelectorAll<HTMLElement>('.lyric-line'))
    expect(lineEls).toHaveLength(6)
    expect(ctx.container.classList.contains('lyric-player--multi-vocal')).toBe(true)

    // 主行与背景人声行均挂载紧贴正文的 .lyric-vocal 与竖条 .lyric-edge，仅非背景主行挂载胶囊 .lyric-singer；无名群组使用 togetherLabel
    expect(lineEls.map(el => el.querySelectorAll('.lyric-vocal').length)).toEqual([1, 1, 1, 1, 1, 1])
    expect(lineEls.map(el => el.querySelectorAll('.lyric-edge').length)).toEqual([1, 1, 1, 1, 1, 1])
    expect(lineEls[4].style.getPropertyValue('--singer-color')).toBe(lineEls[3].style.getPropertyValue('--singer-color'))
    expect(lineEls[4].style.getPropertyValue('--singer-color')).not.toBe('')
    expect(lineEls.map(el => el.querySelector('.lyric-singer')?.textContent ?? null)).toEqual(['甲', '甲', '甲', '乙', null, '合唱'])
    // 色道隔离：无 mood 行回退微光包含歌手色，有词文本保留独立通道
    expect(lineEls[0].style.getPropertyValue('--lyric-glow')).toContain('color-mix')

    // 切换语言后动态更新所有群组行兜底文案
    ctx.player.setDisplay({ showTranslation: true, showRomanization: true, footerText: '', togetherLabel: 'Together', effects: true, hdr: false })
    expect(lineEls[5].querySelector('.lyric-singer')?.textContent).toBe('Together')

    const visiblePills = () => lineEls.map(el => el.querySelector('.lyric-singer')?.classList.contains('lyric-singer--visible') ?? false)

    // 未开唱前（t=0 < start=200ms）：胶囊预标在即将开唱的第 0 行起始位置
    ctx.step(0, 16)
    expect(visiblePills()).toEqual([true, false, false, false, false, false])

    // 第 0 行演唱时（0.4s）：胶囊标在第 0 行
    ctx.step(0.4, 400)
    expect(visiblePills()).toEqual([true, false, false, false, false, false])

    // 同歌手往后唱到第 1 行（1.2s）：第 0 行收起，第 1 行显示；聚光灯激活期间，该行竖条淡出让路
    ctx.step(1.2, 600)
    expect(visiblePills()).toEqual([false, true, false, false, false, false])
    expect(Number.parseFloat(lineEls[1].querySelector<HTMLElement>('.lyric-edge')!.style.opacity)).toBeLessThan(0.2)

    // 继续往后唱到第 2 行（2.1s）：第 2 行显示胶囊
    ctx.step(2.1, 900)
    expect(visiblePills()).toEqual([false, false, true, false, false, false])

    // 切换到第 3 行对唱（3.0s，同时是点题句）：第 3 行显示胶囊、竖条淡出，弹簧收敛后胶囊按 1/s 反向缩放保持视觉大小不变
    for (let s = 0; s < 20; s++)
      ctx.step(3.0, 32)
    expect(visiblePills()).toEqual([false, false, false, true, false, false])
    expect(Number.parseFloat(lineEls[3].querySelector<HTMLElement>('.lyric-edge')!.style.opacity)).toBeLessThan(0.2)
    const duetPill = lineEls[3].querySelector<HTMLElement>('.lyric-singer')!
    expect(duetPill.style.opacity).toBe('')
    const lineScale = Number.parseFloat(/scale\(([-\d.]+)\)/.exec(lineEls[3].style.transform)?.[1] ?? 'NaN')
    const pillScale = Number.parseFloat(/scale\(([-\d.]+)\)/.exec(duetPill.style.transform)?.[1] ?? 'NaN')
    expect(lineScale).toBeGreaterThan(1.2)
    expect(pillScale).toBeLessThan(1)
    expect(lineScale * pillScale).toBeCloseTo(1, 3)

    // 切换到第 5 行合唱（3.5s）：第 5 行显示胶囊
    ctx.step(3.5, 500)
    expect(visiblePills()).toEqual([false, false, false, false, false, true])

    // 曲末聚焦底栏（4.5s）：全部胶囊收起，对唱行恢复非放大态、胶囊行内 transform 清空
    for (let s = 0; s < 25; s++)
      ctx.step(4.5, 32)
    expect(visiblePills()).toEqual([false, false, false, false, false, false])
    expect(duetPill.style.transform).toBe('')
    ctx.cleanup()

    // 带足够长前奏（≥7s 触发 interlude 条目）时：前奏期间预先在第一句主唱行显示胶囊
    const withIntro: ResolvedLyrics = {
      ...namedMulti,
      lines: [
        { words: [{ text: '前奏后首句', start: 8000, end: 9000 }], start: 8000, end: 9000, isDuet: false, isBackground: false, align: 'left', agent: 'v1' },
      ],
    }
    const introCtx = mountPlayer(withIntro)
    introCtx.step(1.0, 16)
    expect(introCtx.container.querySelector('.lyric-singer')?.classList.contains('lyric-singer--visible')).toBe(true)
    introCtx.cleanup()

    // 无名双人：零胶囊（不展示 v1/v2 等占位文本），但每句均有竖条
    const unnamedDuo: ResolvedLyrics = {
      source: 'ttml-amll',
      wordTimed: true,
      instrumental: false,
      agents: { v1: { id: 'v1', color: 'sky' }, v2: { id: 'v2', color: 'rose' } },
      lines: [
        { words: [{ text: '一', start: 0, end: 500 }], start: 0, end: 500, isDuet: false, isBackground: false, align: 'left', agent: 'v1' },
        { words: [{ text: '二', start: 600, end: 1100 }], start: 600, end: 1100, isDuet: true, isBackground: false, align: 'right', agent: 'v2' },
      ],
    }
    const duoCtx = mountPlayer(unnamedDuo)
    expect(duoCtx.container.querySelectorAll('.lyric-singer')).toHaveLength(0)
    expect(duoCtx.container.querySelectorAll('.lyric-edge')).toHaveLength(2)
    duoCtx.cleanup()

    // 无名三人：每句主行渲染纯圆点胶囊 .lyric-singer--dot-only
    const unnamedTrio: ResolvedLyrics = {
      source: 'ttml-amll',
      wordTimed: true,
      instrumental: false,
      agents: { v1: { id: 'v1', color: 'sky' }, v2: { id: 'v2', color: 'rose' }, v3: { id: 'v3', color: 'jade' } },
      lines: [
        { words: [{ text: '一', start: 0, end: 500 }], start: 0, end: 500, isDuet: false, isBackground: false, align: 'left', agent: 'v1' },
        { words: [{ text: '二', start: 600, end: 1100 }], start: 600, end: 1100, isDuet: true, isBackground: false, align: 'right', agent: 'v2' },
        { words: [{ text: '三', start: 1200, end: 1700 }], start: 1200, end: 1700, isDuet: false, isBackground: false, align: 'left', agent: 'v3' },
      ],
    }
    const trioCtx = mountPlayer(unnamedTrio)
    expect(trioCtx.container.querySelectorAll('.lyric-singer.lyric-singer--dot-only')).toHaveLength(3)
    trioCtx.cleanup()

    // 单行条（strip）完全不渲染胶囊与竖条
    const stripCtx = mountPlayer(namedMulti, { strip: true })
    expect(stripCtx.container.querySelectorAll('.lyric-singer')).toHaveLength(0)
    expect(stripCtx.container.querySelectorAll('.lyric-edge')).toHaveLength(0)
    stripCtx.cleanup()

    // 4 人自定义色合唱：渲染 4 枚圆点、拼接全部成员名称，并在左侧竖条注入 4 色纵向渐变
    const quartetChorus: ResolvedLyrics = {
      source: 'ttml-custom',
      wordTimed: true,
      instrumental: false,
      agents: {
        'v1': { id: 'v1', name: '甲', color: 'crimson', colorHex: '#d9695b' },
        'v2': { id: 'v2', name: '乙', color: 'jade', colorHex: '#3f9a66' },
        'v4': { id: 'v4', name: '丙', color: 'lake', colorHex: '#2f93a3' },
        'v3': { id: 'v3', name: '丁', color: 'violet', colorHex: '#8462cc' },
        'v1+v2+v4+v3': { id: 'v1+v2+v4+v3', color: 'lavender', isGroup: true, members: ['v1', 'v2', 'v4', 'v3'] },
      },
      lines: [
        { words: [{ text: '一起唱', start: 0, end: 1000 }], start: 0, end: 1000, isDuet: false, isBackground: false, align: 'center', agent: 'v1+v2+v4+v3' },
      ],
    }
    const quartetCtx = mountPlayer(quartetChorus)
    const quartetLine = quartetCtx.container.querySelector<HTMLElement>('.lyric-line')!
    const dots = Array.from(quartetLine.querySelectorAll<HTMLElement>('.lyric-singer__dot'))
    expect(dots).toHaveLength(4)
    expect(dots.map(d => d.style.getPropertyValue('--dot-color'))).toEqual(['#d9695b', '#3f9a66', '#2f93a3', '#8462cc'])
    expect(quartetLine.querySelector('.lyric-singer__label')?.textContent).toBe('甲 · 乙 · 丙 · 丁')
    expect(quartetLine.style.getPropertyValue('--singer-edge-gradient')).toBe('linear-gradient(180deg, #d9695b, #3f9a66, #2f93a3, #8462cc)')
    quartetCtx.cleanup()
  })

  it('cSS 级联与纵向滚动对齐：.lyric-line 保持绝对定位（不叠加文档流高度），竖条紧贴文字左侧、胶囊激活态保持中性样式且留白平滑不偏心', () => {
    const cssText = readFileSync(resolve(__dirname, 'lyric-player.css'), 'utf8')
    expect(cssText).not.toMatch(/\.lyric-line--active\s+\.lyric-singer/)
    const styleEl = document.createElement('style')
    styleEl.textContent = cssText
    document.head.append(styleEl)

    const lyrics: ResolvedLyrics = {
      source: 'ttml-amll',
      wordTimed: true,
      instrumental: false,
      agents: {
        v1: { id: 'v1', name: '甲', color: 'sky' },
        v2: { id: 'v2', name: '乙', color: 'rose' },
        v1000: { id: 'v1000', color: 'lavender', isGroup: true },
      },
      lines: Array.from({ length: 8 }, (_, i) => ({
        words: [{ text: `第${i}句`, start: i * 1000, end: i * 1000 + 800 }],
        start: i * 1000,
        end: i * 1000 + 800,
        isDuet: i % 3 === 1,
        isBackground: false,
        align: (i % 3 === 2 ? 'center' : i % 3 === 1 ? 'right' : 'left') as 'left' | 'right' | 'center',
        agent: i % 3 === 2 ? 'v1000' : i % 3 === 1 ? 'v2' : 'v1',
      })),
    }

    const ctx = mountPlayer(lyrics)
    try {
      const lineEls = Array.from(ctx.container.querySelectorAll<HTMLElement>('.lyric-line'))
      for (const el of lineEls) {
        Object.defineProperty(el, 'offsetHeight', { value: 52, configurable: true })
        const cs = getComputedStyle(el)
        expect(cs.position).toBe('absolute')
        expect(cs.top).toBe('0px')
      }
      expect(getComputedStyle(lineEls[0]).textAlign).toBe('left')
      expect(getComputedStyle(lineEls[1]).textAlign).toBe('right')
      expect(getComputedStyle(lineEls[2]).textAlign).toBe('center')
      expect(['0', '0px']).toContain(getComputedStyle(lineEls[0]).insetInlineStart)
      expect(getComputedStyle(lineEls[0]).width).toBe('85%')
      expect(['0', '0px']).toContain(getComputedStyle(lineEls[1]).insetInlineEnd)
      expect(getComputedStyle(lineEls[1]).width).toBe('85%')
      expect(getComputedStyle(lineEls[2]).insetInlineStart).toBe('7.5%')
      expect(getComputedStyle(lineEls[2]).width).toBe('85%')
      expect(getComputedStyle(lineEls[2]).boxSizing).toBe('border-box')

      // 所有声部竖条统一放在紧贴正文左侧；默认胶囊水平原点统一对齐竖条起点 (left bottom)
      for (const lineEl of [lineEls[0], lineEls[1], lineEls[2]]) {
        const edgeCs = getComputedStyle(lineEl.querySelector<HTMLElement>('.lyric-edge')!)
        expect(['0', '0px']).toContain(edgeCs.insetInlineStart)
        const pill = lineEl.querySelector<HTMLElement>('.lyric-singer')!
        Object.defineProperty(pill, 'offsetHeight', { value: 20, configurable: true })
        expect(getComputedStyle(pill).display).toBe('flex')
        expect(getComputedStyle(pill).position).toBe('absolute')
        expect(getComputedStyle(pill).transformOrigin).toBe('left bottom')
      }
      for (const lineEl of lineEls.slice(3))
        Object.defineProperty(lineEl.querySelector<HTMLElement>('.lyric-singer')!, 'offsetHeight', { value: 20, configurable: true })

      // 触发重新测量并推进到第 5 行（5.2s，非紧凑模式下 pillHeight = 20 + 6 = 26px）：
      // 弹簧收敛后焦点第 5 行正文中心仍严格落在 640 * 0.35 = 224px；第 5 行上方为胶囊额外让出 26px（总间距 52 + 26 = 78px），无胶囊的 5→6 间距仍为 52px
      ctx.player.setDisplay({ showTranslation: true, showRomanization: false, footerText: '', togetherLabel: '合唱', effects: true, hdr: false })
      for (let stepIdx = 0; stepIdx < 80; stepIdx++)
        ctx.step(5.2, 32)

      const yOf = (el: HTMLElement) => Number.parseFloat(/translate3d\(0,\s*([-\d.]+)px/.exec(el.style.transform)?.[1] ?? 'NaN')
      expect(yOf(lineEls[5]) + 52 / 2).toBeCloseTo(640 * 0.35, 1)
      expect(yOf(lineEls[5]) - yOf(lineEls[4])).toBeCloseTo(52 + 26, 1)
      expect(yOf(lineEls[6]) - yOf(lineEls[5])).toBeCloseTo(52, 1)

      // 极短对唱/合唱句（胶囊宽 > 文字包裹宽）自动切入防溢出钳制类，长句解除钳制并重新对齐竖条起点
      Object.defineProperty(lineEls[1].querySelector<HTMLElement>('.lyric-vocal')!, 'offsetWidth', { value: 40, configurable: true })
      Object.defineProperty(lineEls[1].querySelector<HTMLElement>('.lyric-singer')!, 'offsetWidth', { value: 110, configurable: true })
      Object.defineProperty(lineEls[2].querySelector<HTMLElement>('.lyric-vocal')!, 'offsetWidth', { value: 48, configurable: true })
      Object.defineProperty(lineEls[2].querySelector<HTMLElement>('.lyric-singer')!, 'offsetWidth', { value: 120, configurable: true })
      Object.defineProperty(lineEls[0].querySelector<HTMLElement>('.lyric-vocal')!, 'offsetWidth', { value: 40, configurable: true })
      Object.defineProperty(lineEls[0].querySelector<HTMLElement>('.lyric-singer')!, 'offsetWidth', { value: 110, configurable: true })
      ctx.player.setDisplay({ showTranslation: false, showRomanization: false, footerText: '', togetherLabel: '合唱', effects: true, hdr: false })
      ctx.step(5.2, 32)
      expect(lineEls[0].querySelector('.lyric-singer')!.classList.contains('lyric-singer--clamp-end')).toBe(false)
      expect(lineEls[1].querySelector('.lyric-singer')!.classList.contains('lyric-singer--clamp-end')).toBe(true)
      expect(lineEls[2].querySelector('.lyric-singer')!.classList.contains('lyric-singer--clamp-center')).toBe(true)
    }
    finally {
      ctx.cleanup()
      styleEl.remove()
    }
  })

  it('对齐 StarryPlayer 细节：100ms 扫词提前量、振假名与逐字音译不上浮、强调词不双重上浮、背景行双倍上浮及首行段距保护', () => {
    const detailLyrics: ResolvedLyrics = {
      source: 'ttml-amll',
      wordTimed: true,
      instrumental: false,
      lines: [
        {
          words: [
            {
              text: '光',
              start: 1000,
              end: 1400,
              ruby: [{ text: 'ひかり', start: 1000, end: 1400 }],
            },
            {
              text: '永远',
              start: 1400,
              end: 2600,
            },
          ],
          romanizationWords: [
            { text: 'hikari ', start: 1000, end: 1400, word: 0 },
          ],
          emphasis: [
            { from: 1, to: 2, start: 1400, end: 2600, factor: 1, effect: 'swell' },
          ],
          start: 400,
          end: 2600,
          isDuet: true,
          align: 'right',
          isBackground: false,
          paragraphStart: true,
        },
        {
          words: [{ text: '(回声)', start: 1200, end: 1600 }],
          start: 1200,
          end: 1600,
          isDuet: false,
          isBackground: true,
        },
      ],
    }

    const ctx = mountPlayer(detailLyrics)
    const lineEls = Array.from(ctx.container.querySelectorAll<HTMLElement>('.lyric-line'))
    lineEls.forEach((el) => {
      Object.defineProperty(el, 'offsetHeight', { value: 44, configurable: true })
    })
    ctx.container.querySelectorAll<HTMLElement>('.lyric-word').forEach((el) => {
      Object.defineProperty(el, 'offsetWidth', { value: 36, configurable: true })
    })

    // 首行即使误传 paragraphStart 也不保留 .lyric-line--para，未标对齐方向的背景行继承主行右对齐
    expect(lineEls[0].classList.contains('lyric-line--para')).toBe(false)
    expect(lineEls[1].classList.contains('lyric-line--duet')).toBe(true)

    // t=0.95s（距 1.00s 开唱差 50ms）：因 100ms 提前量已进入擦除遮罩与普通词上浮；振假名与逐字音译只擦除不上浮
    ctx.step(0.95, 32)
    const mainWord0 = lineEls[0].querySelector<HTMLElement>(':scope .lyric-unit > .lyric-word')!
    const furiWord = lineEls[0].querySelector<HTMLElement>('.lyric-furigana .lyric-word')!
    const rubyWord = lineEls[0].querySelector<HTMLElement>('.lyric-ruby .lyric-word')!
    expect(mainWord0.style.maskImage).toContain('linear-gradient')
    expect(mainWord0.style.transform).toContain('translateY(')
    expect(furiWord.style.maskImage).toContain('linear-gradient')
    expect(furiWord.style.transform).toBe('')
    expect(rubyWord.style.maskImage).toContain('linear-gradient')
    expect(rubyWord.style.transform).toBe('')

    // t=1.55s：主行词 0 已唱完（上浮满幅 -0.80px），背景行词亦唱完（2 倍上浮 -1.60px）；强调词外层在开启特效时不上浮（由内部 .lyric-char 负责）
    ctx.step(1.55, 600)
    const emphasisWord = lineEls[0].querySelector<HTMLElement>('.lyric-word--emphasis')!
    const bgWord = lineEls[1].querySelector<HTMLElement>('.lyric-word')!
    const liftY = (el: HTMLElement) => Number.parseFloat(/translateY\(([-\d.]+)px\)/.exec(el.style.transform)?.[1] ?? '0')
    expect(emphasisWord.style.transform).toBe('')
    expect(liftY(bgWord)).toBeCloseTo(liftY(mainWord0) * 2, 2)

    // 关闭歌词特效后，强调词回退为普通词上浮
    ctx.player.setDisplay({ showTranslation: true, showRomanization: true, footerText: '', effects: false, hdr: false })
    ctx.step(1.6, 50)
    expect(emphasisWord.style.transform).toContain('translateY(')

    ctx.cleanup()
  })

  it('流式补丁更新译文与逐字音译时原地复用来行 DOM 与激活状态，不触发重建或瞬移', () => {
    const initial: ResolvedLyrics = {
      source: 'ncm-yrc',
      wordTimed: true,
      instrumental: false,
      lines: [
        {
          words: [
            { text: '夜', start: 1000, end: 1500 },
            { text: '空', start: 1500, end: 2200 },
          ],
          start: 1000,
          end: 2200,
          isDuet: false,
          isBackground: false,
        },
        {
          words: [{ text: '星光', start: 2500, end: 3200 }],
          start: 2500,
          end: 3200,
          isDuet: false,
          isBackground: false,
        },
      ],
    }

    const ctx = mountPlayer(initial)
    ctx.container.querySelectorAll<HTMLElement>('.lyric-line').forEach((el) => {
      Object.defineProperty(el, 'offsetHeight', { value: 48, configurable: true })
    })
    ctx.container.querySelectorAll<HTMLElement>('.lyric-word').forEach((el) => {
      Object.defineProperty(el, 'offsetWidth', { value: 32, configurable: true })
    })

    // 推入第 0 行在唱状态
    ctx.step(1.2, 16)
    const line0 = ctx.container.querySelectorAll<HTMLElement>('.lyric-line')[0]!
    const main0 = line0.querySelector<HTMLElement>('.lyric-main')!
    const mainWord0 = main0.querySelector<HTMLElement>('.lyric-word')!
    expect(line0.classList.contains('lyric-line--active')).toBe(true)

    // 流式到达第 0 行翻译与逐字音译
    const patched: ResolvedLyrics = {
      ...initial,
      lines: [
        {
          ...initial.lines[0],
          translation: 'Night sky',
          romanizationWords: [
            { text: 'ye ', start: 1000, end: 1500, word: 0 },
            { text: 'kong', start: 1500, end: 2200, word: 1 },
          ],
        },
        initial.lines[1],
      ],
    }
    ctx.player.setLyrics(patched)
    ctx.step(1.25, 16)

    expect(ctx.container.querySelectorAll<HTMLElement>('.lyric-line')[0]).toBe(line0)
    expect(line0.querySelector<HTMLElement>('.lyric-main')).toBe(main0)
    expect(main0.querySelector<HTMLElement>('.lyric-word')).toBe(mainWord0)
    expect(line0.classList.contains('lyric-line--active')).toBe(true)

    const extra = line0.querySelector<HTMLElement>('.lyric-extra[data-kind="translation"]')!
    expect(extra.textContent).toBe('Night sky')
    expect(extra.classList.contains('lyric-extra--enter')).toBe(true)

    const ruby = line0.querySelector<HTMLElement>('.lyric-ruby')!
    expect(ruby.classList.contains('lyric-ruby--enter')).toBe(true)

    ctx.cleanup()
  })

  it('双翻译对比按顺序渲染第一与第二翻译节点，流式补全时保持第一在第二上方并同步显隐', () => {
    const initial: ResolvedLyrics = {
      source: 'ncm-lrc',
      wordTimed: false,
      instrumental: false,
      lines: [
        {
          words: [{ text: '君の名は', start: 1000, end: 3000 }],
          start: 1000,
          end: 3000,
          romanization: 'kimi no na wa',
          secondaryTranslation: '原生中文：你的名字',
          isDuet: false,
          isBackground: false,
        },
        {
          words: [{ text: '星が降る', start: 3500, end: 5500 }],
          start: 3500,
          end: 5500,
          translation: 'AI 中文：繁星坠落',
          secondaryTranslation: '原生中文：群星闪耀',
          isDuet: false,
          isBackground: false,
        },
      ],
    }

    const ctx = mountPlayer(initial)
    ctx.container.querySelectorAll<HTMLElement>('.lyric-line').forEach((el) => {
      Object.defineProperty(el, 'offsetHeight', { value: 64, configurable: true })
    })

    const line1 = ctx.container.querySelectorAll<HTMLElement>('.lyric-line')[1]!
    const line1Kinds = Array.from(line1.querySelectorAll<HTMLElement>('.lyric-extra')).map(el => el.dataset.kind)
    expect(line1Kinds).toEqual(['translation', 'secondary-translation'])
    expect(line1.querySelector<HTMLElement>('.lyric-extra[data-kind="translation"]')?.textContent).toBe('AI 中文：繁星坠落')
    expect(line1.querySelector<HTMLElement>('.lyric-extra[data-kind="secondary-translation"]')?.textContent).toBe('原生中文：群星闪耀')

    // 当内置译文已存在、AI 第一翻译随后流式到达时，必须插入在 secondary-translation 之前
    const patched: ResolvedLyrics = {
      ...initial,
      lines: [
        {
          ...initial.lines[0],
          translation: 'AI 中文：你的名字是',
        },
        initial.lines[1],
      ],
    }
    ctx.player.setLyrics(patched)

    const line0 = ctx.container.querySelectorAll<HTMLElement>('.lyric-line')[0]!
    const line0Extras = Array.from(line0.querySelectorAll<HTMLElement>('.lyric-extra'))
    expect(line0Extras.map(el => el.dataset.kind)).toEqual(['romanization', 'translation', 'secondary-translation'])
    expect(line0Extras.map(el => el.textContent)).toEqual([
      'kimi no na wa',
      'AI 中文：你的名字是',
      '原生中文：你的名字',
    ])

    // 关闭翻译显示时同时隐藏第一与第二翻译，不影响音译
    ctx.player.setDisplay({ showTranslation: false, showRomanization: true, footerText: '', effects: false, hdr: false })
    expect(line0Extras[0].hidden).toBe(false)
    expect(line0Extras[1].hidden).toBe(true)
    expect(line0Extras[2].hidden).toBe(true)

    ctx.cleanup()
  })

  it('仅非单行条按可见性动态切换 will-change，strip 单行条由 CSS 静态处理不写行内 willChange', () => {
    const cssText = readFileSync(resolve(__dirname, 'lyric-player.css'), 'utf8')
    expect(cssText).toContain('.lyric-player--strip .lyric-item')
    expect(cssText).not.toMatch(/\.lyric-line[^}]*filter 0\.35s/)

    const manyLines: ResolvedLyrics = {
      source: 'ncm-yrc',
      wordTimed: true,
      instrumental: false,
      lines: Array.from({ length: 40 }, (_, i) => ({
        words: [{ text: `L${i}`, start: i * 1000, end: i * 1000 + 800 }],
        start: i * 1000,
        end: i * 1000 + 800,
        isDuet: false,
        isBackground: false,
      })),
    }

    const full = mountPlayer(manyLines, { strip: false })
    full.container.querySelectorAll<HTMLElement>('.lyric-line').forEach(el => Object.defineProperty(el, 'offsetHeight', { value: 60, configurable: true }))
    full.step(0.5, 16)
    const fullEls = Array.from(full.container.querySelectorAll<HTMLElement>('.lyric-item'))
    expect(fullEls[0].style.willChange).toBe('transform')
    expect(fullEls.at(-1)?.style.willChange).toBe('')
    full.cleanup()

    const strip = mountPlayer(manyLines, { strip: true })
    strip.container.querySelectorAll<HTMLElement>('.lyric-line').forEach(el => Object.defineProperty(el, 'offsetHeight', { value: 36, configurable: true }))
    strip.step(0.5, 16)
    const stripEls = Array.from(strip.container.querySelectorAll<HTMLElement>('.lyric-item'))
    expect(stripEls.every(el => el.style.willChange === '')).toBe(true)
    strip.cleanup()
  })
})
