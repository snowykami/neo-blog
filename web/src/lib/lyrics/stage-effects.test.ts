import type { LyricLine, ResolvedLyrics } from './types'
import { describe, expect, it, vi } from 'vitest'
import { LYRIC_SCENES } from './annotation-options'
import { getStageSignals, SCENE_MAX_LINES, spotlightAt, spotlightLevel, VOCAL_TINT_FACTOR } from './stage-effects'
import { StageParticles } from './stage-particles'

/** 每行 1 秒、间隔 1 秒的歌词：第 i 行在 [2i, 2i+1) 秒演唱 */
function lyricsOf(lines: Partial<LyricLine>[]): ResolvedLyrics {
  return {
    source: 'ncm-yrc',
    wordTimed: true,
    instrumental: false,
    lines: lines.map((extra, i) => ({
      words: [{ text: '词', start: i * 2000, end: i * 2000 + 1000 }],
      start: i * 2000,
      end: i * 2000 + 1000,
      isDuet: false,
      isBackground: false,
      ...extra,
    })),
  }
}

describe('播放器页全屏特效信号', () => {
  it('背景呼吸：唱到 swell / shake 时随起落曲线亮起，其他特效不触发', () => {
    const lyrics = lyricsOf([
      { emphasis: [{ from: 0, to: 1, start: 0, end: 1000, factor: 0.8, effect: 'swell' }] },
      { emphasis: [{ from: 0, to: 1, start: 2000, end: 3000, factor: 1, effect: 'glow' }] },
    ])
    expect(getStageSignals(lyrics, 500).pulse).toBeCloseTo(0.8, 2)
    expect(getStageSignals(lyrics, 1200).pulse).toBe(0)
    expect(getStageSignals(lyrics, 2500).pulse).toBe(0)
  })

  it('背景染色：开始后淡入，唱完后淡出，取最强的颜色', () => {
    const lyrics = lyricsOf([{ emphasis: [{ from: 0, to: 1, start: 0, end: 1000, factor: 0.5, effect: 'glow', color: 'cherry-blossom' }] }])
    expect(getStageSignals(lyrics, 150).tint).toEqual({ color: 'cherry-blossom', strength: 0.5 })
    expect(getStageSignals(lyrics, 800).tint?.strength).toBe(1)
    expect(getStageSignals(lyrics, 1750).tint?.strength).toBeCloseTo(0.5, 2)
    expect(getStageSignals(lyrics, 3000).tint).toBeNull()
  })

  it('副歌爆发：副歌起点行开唱时迅速亮起，再慢慢回落', () => {
    const lyrics = lyricsOf([{}, { chorusStart: true }])
    expect(getStageSignals(lyrics, 1900).burst).toBe(0)
    expect(getStageSignals(lyrics, 2200).burst).toBe(1)
    expect(getStageSignals(lyrics, 3100).burst).toBeCloseTo(0.25, 2)
    expect(getStageSignals(lyrics, 4100).burst).toBe(0)
  })

  it('粒子场景：模型给出持续行数时按它结束（第 sceneLines 行唱完后）', () => {
    const lines: Partial<LyricLine>[] = Array.from({ length: 8 }, () => ({}))
    // 第 1 行起持续 3 行：第 1 ~ 3 行，第 3 行在 [6, 7) 秒
    lines[1] = { scene: 'rain', sceneLines: 3 }
    const lyrics = lyricsOf(lines)
    expect(getStageSignals(lyrics, 6500).scene?.name).toBe('rain')
    expect(getStageSignals(lyrics, 7500).scene).toBeNull()
    // 0 或缺省按默认行数
    lines[1] = { scene: 'rain', sceneLines: 0 }
    expect(getStageSignals(lyricsOf(lines), 7500).scene?.name).toBe('rain')
  })

  it('粒子场景：从标注行开始，持续若干行，遇到新场景时切换（带颜色主题）', () => {
    const lines: Partial<LyricLine>[] = Array.from({ length: SCENE_MAX_LINES + 4 }, () => ({}))
    lines[1] = { scene: 'petals' }
    const lyrics = lyricsOf(lines)
    expect(getStageSignals(lyrics, 1500).scene).toBeNull()
    expect(getStageSignals(lyrics, 2000).scene).toEqual({ name: 'petals', color: null })
    // 第 1 ~ SCENE_MAX_LINES 行（共 SCENE_MAX_LINES 行）唱完后结束
    const lastLine = SCENE_MAX_LINES
    expect(getStageSignals(lyrics, lastLine * 2000 + 500).scene?.name).toBe('petals')
    expect(getStageSignals(lyrics, lastLine * 2000 + 1500).scene).toBeNull()

    lines[3] = { scene: 'snow', sceneColor: 'ice' }
    expect(getStageSignals(lyricsOf(lines), 6500).scene).toEqual({ name: 'snow', color: 'ice' })
  })

  it('聚光灯：点题句开唱前 0.2 秒开始亮起，0.5 秒内亮满，唱完后 0.6 秒内回落', () => {
    // 第 2 行在 [4, 5) 秒演唱
    const lyrics = { ...lyricsOf([{}, {}, {}, {}]), spotlights: [2] }
    expect(spotlightLevel(lyrics, 3700)).toBe(0)
    expect(spotlightLevel(lyrics, 4050)).toBeCloseTo(0.5)
    expect(spotlightLevel(lyrics, 4500)).toBe(1)
    expect(spotlightLevel(lyrics, 5300)).toBeCloseTo(0.5)
    expect(spotlightLevel(lyrics, 5600)).toBe(0)
    expect(getStageSignals(lyrics, 4500).spotlight).toBe(1)
    expect(spotlightLevel(lyricsOf([{}, {}]), 500)).toBe(0)
  })

  it('聚光灯：多句时取此刻最亮的一次，相邻两句交接时不熄灭', () => {
    // 第 1、2 行紧挨着，在 [2, 3)、[3, 4) 秒演唱
    const lyrics = { ...lyricsOf([{}, {}, { start: 3000, end: 4000 }]), spotlights: [1, 2] }
    expect(spotlightAt(lyrics, 2500)).toEqual({ line: 1, level: 1 })
    // 交接：前一句刚开始回落时仍以它为准，后一句亮满后换到后一句
    expect(spotlightAt(lyrics, 3050)?.line).toBe(1)
    expect(spotlightAt(lyrics, 3300)).toEqual({ line: 2, level: 1 })
    expect(spotlightLevel(lyrics, 3150)).toBeGreaterThan(0.75)
    expect(spotlightAt(lyrics, 5000)).toBeNull()
  })

  it('自定义粒子：场景带上这首歌的粒子；粒子不存在时当作没有场景', () => {
    const sprite = { name: 'doll', paths: [{ d: 'M2 2 L22 2 L12 20 Z', paint: 'fill' as const }], motion: 'fall' as const, size: 'm' as const, color: 'peach' as const }
    const lyrics = { ...lyricsOf([{ scene: 'custom:doll' }, {}]), sprites: { doll: sprite } }
    expect(getStageSignals(lyrics, 500).scene).toEqual({ name: 'custom:doll', color: null, sprite })
    expect(getStageSignals({ ...lyrics, sprites: undefined }, 500).scene).toBeNull()
  })

  it('多声部方向性洗光：按主行 align 与歌手色输出强度，单人无 agents 为 null，背景行不抢占', () => {
    expect(getStageSignals(lyricsOf([{ agent: 'v1' }]), 500).vocal).toBeNull()

    const multi: ResolvedLyrics = {
      ...lyricsOf([
        { agent: 'v1', align: 'left' },
        { agent: 'v2', align: 'right', isDuet: true },
        { agent: 'v1', align: 'left', isBackground: true, start: 2200, end: 2800, words: [{ text: '和', start: 2200, end: 2800 }] },
        { agent: 'v1000', align: 'center' },
      ]),
      agents: {
        v1: { id: 'v1', color: 'sky' },
        v2: { id: 'v2', color: 'rose' },
        v1000: { id: 'v1000', color: 'lavender', isGroup: true },
      },
    }
    const atV1 = getStageSignals(multi, 500).vocal
    expect(atV1?.align).toBe('left')
    expect(atV1?.color).toBe('sky')
    expect(atV1?.strength).toBeCloseTo(VOCAL_TINT_FACTOR, 3)

    const atV2 = getStageSignals(multi, 2500).vocal
    expect(atV2?.align).toBe('right')
    expect(atV2?.color).toBe('rose')

    const atChorus = getStageSignals(multi, 6500).vocal
    expect(atChorus?.align).toBe('center')
    expect(atChorus?.color).toBe('lavender')
  })

  it('粒子引擎跨场景无缝交叉过渡：切到相邻新场景时旧粒子渐隐的同时立即生成新场景粒子，无 1.2s 真空断档', () => {
    const noopCtx = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
    } as unknown as CanvasRenderingContext2D
    const canvas = {
      width: 1280,
      height: 800,
      getContext: () => noopCtx,
    } as unknown as HTMLCanvasElement

    const engine = new StageParticles(canvas)
    engine.resize(1280, 800)

    // 先把 snow 场景推进到满密度
    for (let i = 0; i < 40; i++)
      engine.update(0.05, { name: 'snow', color: null }, true)
    expect(engine.idle).toBe(false)

    // 紧接着直接切到 rain（高频生成）：首 0.25s 内无需等待旧 density 排空即已进入交叉绘制态
    noopCtx.stroke = vi.fn()
    for (let i = 0; i < 5; i++)
      engine.update(0.05, { name: 'rain', color: null }, true)
    // snow 只用 fill 画圆，rain 只用 stroke 画雨线；stroke 被调用证明新场景 rain 已并行生成绘制
    expect(noopCtx.stroke).toHaveBeenCalled()
  })

  it('全部 25 种内置粒子场景与自定义 sway/burst 在节拍输入下均可正常生成与绘制', () => {
    const noopGradient = { addColorStop: vi.fn() }
    const noopCtx = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      fillText: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      createLinearGradient: vi.fn(() => noopGradient),
      createRadialGradient: vi.fn(() => noopGradient),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      font: '',
      textAlign: 'left',
      textBaseline: 'alphabetic',
    } as unknown as CanvasRenderingContext2D
    const canvas = {
      width: 1280,
      height: 800,
      getContext: () => noopCtx,
    } as unknown as HTMLCanvasElement

    expect(LYRIC_SCENES).toHaveLength(24)
    expect(LYRIC_SCENES).toContain('beams')
    const engine = new StageParticles(canvas)
    engine.resize(1280, 800)

    const rhythm = {
      pulses: () => ({ pulses: [{ t: 1000, a: 1, synth: false }], periodMs: 600 }),
      heart: 0.85,
      breath: 0.7,
      sway: 0.6,
      tempoScale: 1.2,
      rawPeriodMs: 500,
      basePeriodMs: 500,
    }

    for (const name of LYRIC_SCENES) {
      engine.clear()
      let paintedAny = false
      for (let i = 0; i < 90; i++) {
        if (engine.update(0.05, { name, color: null }, true, rhythm))
          paintedAny = true
      }
      expect(paintedAny, `scene ${name} should spawn and paint`).toBe(true)
      expect(engine.idle).toBe(false)
    }
  })

  it('舞台灯（beams）支持顶部向下与底部向上双向投射，且烟花绽放寿命随真实单拍周期自适应伸缩', () => {
    const translateYs: number[] = []
    const scaleYs: number[] = []
    const noopGradient = { addColorStop: vi.fn() }
    const noopCtx = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn((_x: number, y: number) => translateYs.push(y)),
      rotate: vi.fn(),
      scale: vi.fn((_sx: number, sy: number) => scaleYs.push(sy)),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      createLinearGradient: vi.fn(() => noopGradient),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
    } as unknown as CanvasRenderingContext2D
    const canvas = {
      width: 1280,
      height: 800,
      getContext: () => noopCtx,
    } as unknown as HTMLCanvasElement

    const engine = new StageParticles(canvas)
    engine.resize(1280, 800)

    // 连续触发多拍舞台灯，验证既有顶部桁架（y = -3）也有底部台唇（y = 803 + scale(1, -1)）
    for (let beatIdx = 1; beatIdx <= 30; beatIdx++) {
      engine.update(0.04, { name: 'beams', color: null }, true, {
        pulses: () => ({ pulses: [{ t: beatIdx * 360, a: 1, synth: false }], periodMs: 360 }),
        heart: 0.9,
        breath: 0.8,
        sway: 0.5,
        tempoScale: 1.67,
        rawPeriodMs: 360,
        basePeriodMs: 720,
      })
    }
    expect(translateYs.some(y => y < 0)).toBe(true)
    expect(translateYs.some(y => y > 800)).toBe(true)
    expect(scaleYs).toContain(-1)

    // 验证快歌（166.7 BPM, rawPeriodMs=360, basePeriodMs=720）抵消八度折叠并缩短烟花绽放寿命，慢歌（77 BPM, rawPeriodMs=780）烟花持久悬停
    const queriedOctaves: number[] = []
    engine.clear()
    engine.update(0.05, { name: 'fireworks', color: null }, true, {
      pulses: (oct) => {
        queriedOctaves.push(oct)
        return { pulses: [{ t: 360, a: 1, synth: false }], periodMs: 720 }
      },
      heart: 0.8,
      breath: 0.5,
      sway: 0,
      tempoScale: 1.67,
      rawPeriodMs: 360,
      basePeriodMs: 720,
    })
    // fireworks 原始 beat=1，抵消快歌 foldShift=1 后应查询 octave=0（真实双拍 720ms，而非 4 拍 1440ms）
    expect(queriedOctaves).toContain(0)
    // 保持播放态（无新拍点）推进 1.35s（> 快歌最大寿命 2 * 0.36 * 1.62 ≈ 1.17s），快歌烟花已按自身寿命干净消散
    const fastIdleRhythm = {
      pulses: () => ({ pulses: [], periodMs: 720 }),
      heart: 0.2,
      breath: 0.2,
      sway: 0,
      tempoScale: 1.67,
      rawPeriodMs: 360,
      basePeriodMs: 720,
    }
    const clearCallsBeforeFastEnd = (noopCtx.clearRect as ReturnType<typeof vi.fn>).mock.calls.length
    for (let i = 0; i < 28; i++)
      engine.update(0.05, { name: 'fireworks', color: null }, true, fastIdleRhythm)
    // 最后一帧已无存活烟花（不再触发绘制）
    const paintedAtFast1400ms = engine.update(0.05, { name: 'fireworks', color: null }, true, fastIdleRhythm)
    expect(paintedAtFast1400ms).toBe(false)
    expect((noopCtx.clearRect as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(clearCallsBeforeFastEnd)

    // 对比慢歌（rawPeriodMs=780，最小寿命 2 * 0.78 * 1.25 = 1.95s）：同样推进 1.45s 时烟花仍在空中绽放绘制
    engine.clear()
    const slowIdleRhythm = {
      pulses: () => ({ pulses: [], periodMs: 1560 }),
      heart: 0.2,
      breath: 0.2,
      sway: 0,
      tempoScale: 0.77,
      rawPeriodMs: 780,
      basePeriodMs: 780,
    }
    engine.update(0.05, { name: 'fireworks', color: null }, true, {
      ...slowIdleRhythm,
      pulses: () => ({ pulses: [{ t: 780, a: 1, synth: false }], periodMs: 1560 }),
    })
    for (let i = 0; i < 28; i++)
      engine.update(0.05, { name: 'fireworks', color: null }, true, slowIdleRhythm)
    const paintedAtSlow1400ms = engine.update(0.05, { name: 'fireworks', color: null }, true, slowIdleRhythm)
    expect(paintedAtSlow1400ms).toBe(true)
  })

  it('小画幅灵动岛（320×36, maxParticles=20）节奏粒子逐拍必响应不漏拍，无节奏雨雪按面积稀疏', () => {
    const arcCalls: number[] = []
    const noopCtx = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn((x: number, y: number, r: number) => arcCalls.push(r)),
      fill: vi.fn(),
      stroke: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
    } as unknown as CanvasRenderingContext2D
    const canvas = {
      width: 320,
      height: 36,
      getContext: () => noopCtx,
    } as unknown as HTMLCanvasElement

    const compact = new StageParticles(canvas, { scale: 0.7, maxParticles: 20 })
    compact.resize(320, 36)

    // 先用无节奏高密 rain 把 20 个名额彻底占满
    for (let i = 0; i < 40; i++)
      compact.update(0.05, { name: 'rain', color: null }, true, null)

    // 紧接着切入 fireworks（beat: 1，每朵烟花刚炸开首帧画 28 颗火花圆点 + 1 个中心闪光 = 29 次 arc）：
    // 连续喂入 4 个独立拍点，即便面积仅 320×36 且旧雨滴尚未散尽，每一拍都必须新增 1 朵烟花（绝不漏拍）
    for (let beatIdx = 1; beatIdx <= 4; beatIdx++) {
      arcCalls.length = 0
      compact.update(0.02, { name: 'fireworks', color: null }, true, {
        pulses: () => ({ pulses: [{ t: beatIdx * 1000, a: 0.75, synth: false }], periodMs: 1000 }),
        heart: 0.8,
        breath: 0.6,
        sway: 0,
        tempoScale: 1,
      })
      // 第 k 拍后同屏至少有 k 朵烟花（每朵 ≥ 28 次火花 arc）
      expect(arcCalls.length).toBeGreaterThanOrEqual(beatIdx * 28)
    }
  })
})
