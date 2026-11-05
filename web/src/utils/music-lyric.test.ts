import type { LyricMarqueeWordBox, MusicLyricItem, MusicLyricLine } from './music-lyric'
import { describe, expect, it } from 'vitest'
import { alignExtraLyricLines, getExtraLyricLine, getLyricMarqueeOffset, LYRIC_MARQUEE_ANCHOR_RATIO, LYRIC_MARQUEE_SMOOTH_WINDOW_MS, parseMusicLyrics } from './music-lyric'

const line = (startTime: number, text: string): MusicLyricLine => ({ items: [{ text, startTime, duration: 0 }], startTime, duration: 0, originalText: text })

describe('翻译 / 音译挂载（宁缺勿错）', () => {
  const base = [line(0, 'A'), line(2000, 'B'), line(4000, 'C'), line(6000, 'D')]

  it('只挂到时间相近的主行，没有翻译的行不借用相邻行', () => {
    // B、D 没有翻译：不应挂上 A、C 的翻译
    const aligned = alignExtraLyricLines(base, [line(10, 'a'), line(3990, 'c')])
    expect(base.map(item => getExtraLyricLine(aligned, item.startTime)?.originalText ?? null)).toEqual(['a', null, 'c', null])
  })

  it('一行翻译只挂一行主歌词，时间差超出上限的丢弃', () => {
    const aligned = alignExtraLyricLines(base, [line(1000, 'between'), line(9000, 'far')])
    // 1000ms 处与 A、B 等距：只挂一行
    expect(aligned).toHaveLength(1)
    expect(aligned.map(item => item.startTime)).toEqual([expect.any(Number)])
    expect(getExtraLyricLine(aligned, 6000)).toBeNull()
  })

  it('同一主行有多个候选时取时间最近的', () => {
    const aligned = alignExtraLyricLines(base, [line(1800, 'near'), line(2600, 'farther')])
    expect(getExtraLyricLine(aligned, 2000)?.originalText).toBe('near')
    // 次近的那行离 C 也超过上限，被丢弃
    expect(getExtraLyricLine(aligned, 4000)).toBeNull()
  })

  it('解析网易云歌词时翻译与逐字主行对齐', () => {
    const parsed = parseMusicLyrics({
      yrc: { lyric: '[1000,1000](1000,500,0)一(1500,500,0)句\n[3000,1000](3000,1000,0)二', version: 1 },
      tlyric: { lyric: '[00:01.05]line one', version: 1 },
    })
    expect(parsed.sourceType).toBe('yrc')
    expect(getExtraLyricLine(parsed.translationLines, 1000)?.originalText).toBe('line one')
    expect(getExtraLyricLine(parsed.translationLines, 3000)).toBeNull()
  })
})

describe('逐字歌词跑马灯（分段匀变速）', () => {
  // [开始时间, 时长, 字宽]：各字速度不同，1600~1800、3100~3300 为字间空隙
  const syllables: [number, number, number][] = [
    [1000, 200, 40],
    [1200, 300, 30],
    [1500, 100, 30],
    [1800, 400, 80],
    [2200, 150, 60],
    [2350, 250, 25],
    [2600, 500, 75],
    [3300, 200, 90],
    [3500, 300, 60],
    [3800, 400, 120],
  ]
  const items: MusicLyricItem[] = []
  const wordBoxes: LyricMarqueeWordBox[] = []
  let contentWidth = 0
  for (const [startTime, duration, width] of syllables) {
    items.push({ text: '字', startTime, duration })
    wordBoxes.push({ left: contentWidth, width })
    contentWidth += width
  }
  const containerWidth = 200
  const overflow = contentWidth - containerWidth
  const wordLine: MusicLyricLine = { items, startTime: 1000, duration: 3200, originalText: '字'.repeat(items.length) }
  const offsetAt = (currentTimeMs: number, smoothWindowMs?: number) =>
    getLyricMarqueeOffset({ line: wordLine, currentTimeMs, containerWidth, contentWidth, wordBoxes, smoothWindowMs })
  const half = LYRIC_MARQUEE_SMOOTH_WINDOW_MS / 2
  const lineEnd = 4200

  // 原偏移速度突变的时刻：各字边界，以及演唱位置越过滚动起点、终点的时刻
  const crossingTime = (position: number) => {
    const i = wordBoxes.findIndex(box => box.left + box.width > position)
    return items[i].startTime + (position - wordBoxes[i].left) / wordBoxes[i].width * items[i].duration
  }
  const anchor = containerWidth * LYRIC_MARQUEE_ANCHOR_RATIO
  const rawKinks = [...new Set(items.flatMap(item => [item.startTime, item.startTime + item.duration])), crossingTime(anchor), crossingTime(anchor + overflow)]
  // 平滑后加速度跳变的时刻：原折点前后各半个窗口
  const kinks = rawKinks.flatMap(time => [time - half, time + half])

  const h = 0.01
  const leftVelocity = (t: number, smoothWindowMs?: number) => (offsetAt(t, smoothWindowMs) - offsetAt(t - h, smoothWindowMs)) / h
  const rightVelocity = (t: number, smoothWindowMs?: number) => (offsetAt(t + h, smoothWindowMs) - offsetAt(t, smoothWindowMs)) / h
  const grid = (from: number, to: number, step: number) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step)

  it('不平滑时速度在字的边界突变（对照）', () => {
    // 2200ms 处由 0.2px/ms 突变为 0.4px/ms
    expect(rightVelocity(2200, 0) - leftVelocity(2200, 0)).toBeCloseTo(0.2, 3)
  })

  it('字的边界、开始滚动与滚到底处速度连续', () => {
    for (const t of [...rawKinks, ...kinks, ...grid(500, 4800, 7)])
      expect(Math.abs(rightVelocity(t) - leftVelocity(t)), `t=${t}`).toBeLessThan(1e-3)
  })

  it('两次加速度跳变之间速度线性变化（匀变速）', () => {
    const delta = 5
    const velocity = (t: number) => (offsetAt(t + h) - offsetAt(t - h)) / (2 * h)
    for (const t of grid(500, 4800, 3)) {
      if (kinks.some(kink => Math.abs(kink - t) <= delta + h))
        continue
      expect(Math.abs(velocity(t) - (velocity(t - delta) + velocity(t + delta)) / 2), `t=${t}`).toBeLessThan(1e-3)
    }
  })

  it('整句起止位置不变', () => {
    for (const t of [0, 900, 1000])
      expect(offsetAt(t)).toBe(0)
    for (const t of [lineEnd, lineEnd + half, lineEnd + 5000]) {
      expect(offsetAt(t)).toBeCloseTo(overflow, 6)
      expect(offsetAt(t)).toBeCloseTo(offsetAt(t, 0), 6)
    }
  })

  it('不超出文本范围，也不倒退', () => {
    let last = 0
    for (const t of grid(0, 5000, 3)) {
      const offset = offsetAt(t)
      expect(offset).toBeGreaterThanOrEqual(0)
      expect(offset).toBeLessThanOrEqual(overflow)
      expect(offset).toBeGreaterThanOrEqual(last - 1e-9)
      last = offset
    }
  })

  it('跟住演唱位置：介于前后半个窗口时刻的原偏移之间', () => {
    for (const t of grid(500, 4800, 5)) {
      const offset = offsetAt(t)
      expect(offset).toBeGreaterThanOrEqual(offsetAt(t - half, 0) - 1e-9)
      expect(offset).toBeLessThanOrEqual(offsetAt(t + half, 0) + 1e-9)
    }
    // 远离折点的匀速段与原偏移重合
    expect(offsetAt(2850)).toBeCloseTo(offsetAt(2850, 0), 6)
  })
})
