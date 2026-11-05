import type { RhythmContext } from './rhythm/effects'
import type { RhythmModel, RhythmPulse } from './rhythm/model'
import { describe, expect, it } from 'vitest'
import { interludeDot, interludeDots, interludePlan } from './interlude'
import { rhythmContext } from './rhythm/effects'
import { DEFAULT_RHYTHM_PARAMS } from './rhythm/params'

// 10 秒的间奏：0 ~ 10000ms，固定中速（T_b = 750ms，网格从人声进入的 10000ms 往回排）
const at = (t: number, i: number) => interludeDot(0, 10_000, t, i, 3)
const fixed = rhythmContext(undefined, null)

/** 跟随节拍的上下文：拍点为 first + k·period（各级按二分取偶数拍） */
function beatContext(first: number, period: number, until: number): RhythmContext {
  const beats: RhythmPulse[] = []
  for (let t = first; t <= until; t += period)
    beats.push({ t, a: 1, synth: false })
  const trains = new Map<number, RhythmPulse[]>([[0, beats]])
  for (let k = 1; k <= 4; k++)
    trains.set(k, trains.get(k - 1)!.filter((_, i) => i % 2 === 0))
  const model = { analysis: { basePeriodMs: period }, trains, baseK: 0, reliable: true } as unknown as RhythmModel
  return { pace: 'beat', model, params: DEFAULT_RHYTHM_PARAMS, base: period }
}

describe('间奏圆点', () => {
  it('间奏外不可见', () => {
    expect(at(-1, 0).opacity).toBe(0)
    expect(at(10_000, 0).opacity).toBe(0)
  })

  it('依次淡入，先以未点亮的低透明度出现', () => {
    expect(at(0, 0).opacity).toBe(0)
    expect(at(900, 0).opacity).toBeCloseTo(0.1, 2)
    expect(at(900, 2).opacity).toBeLessThan(at(900, 0).opacity)
  })

  it('固定快慢：网格从人声进入往回排，倒计时与退场都落在拍上', () => {
    const plan = interludePlan(0, 10_000, 3, fixed)
    const onGrid = (t: number) => Math.abs(((t - plan.origin) / 750) - Math.round((t - plan.origin) / 750)) < 1e-6
    expect(plan.entry).toBe(10_000)
    expect(onGrid(plan.exitAt)).toBe(true)
    expect(plan.lit.every(onGrid)).toBe(true)
    expect(plan.lit[2]).toBe(plan.exitAt)
    expect(plan.lit[0]).toBeLessThan(plan.lit[1])
    expect(plan.lit[1]).toBeLessThan(plan.lit[2])
  })

  it('倒计时：每个点在自己的那一拍亮满，之前的点已亮满、之后的点还没点亮', () => {
    const { lit } = interludePlan(0, 10_000, 3, fixed)
    expect(at(lit[0], 0).opacity).toBeCloseTo(1, 2)
    expect(at(lit[0], 1).opacity).toBeCloseTo(0.1, 2)
    expect(at(lit[1] - 1, 1).opacity).toBeGreaterThan(0.9)
    expect(at(lit[1], 2).opacity).toBeCloseTo(0.1, 2)
    expect(at(lit[2], 2).opacity).toBeCloseTo(1, 2)
  })

  it('呼吸在吸气与呼气之间交替', () => {
    // 呼吸每 1500ms 翻转一次（网格从人声进入往回排：1000、2500、4000……），取每次翻转缓完的时刻
    const scales = [2400, 3900, 5400, 6900].map(t => at(t, 1).scale)
    expect(Math.max(...scales)).toBeGreaterThan(1.1)
    expect(Math.min(...scales)).toBeLessThan(1)
  })

  it('跟随节拍：人声落在拍上（几十毫秒内）时收拢在人声进入的时刻完成，抢拍时落在之前最近的一拍', () => {
    // 拍在 11020：人声比拍早 20ms，算作人声的拍，收拢在人声进入的时刻完成
    expect(interludePlan(1000, 11_000, 3, beatContext(220, 600, 20_000)).entry).toBe(11_000)
    // 拍在 10900、11500：人声比拍晚 100ms，收拢落在 10900
    const plan = interludePlan(1000, 11_000, 3, beatContext(100, 600, 20_000))
    expect(plan.entry).toBe(10_900)
    expect((plan.exitAt - 100) % 600).toBe(0)
    expect(plan.lit.every(t => (t - 100) % 600 === 0)).toBe(true)
  })

  it('退场：在拍上先放大，收拢在人声进入的那一拍完成', () => {
    const plan = interludePlan(0, 10_000, 3, fixed)
    expect(at(plan.exitAt + 600, 1).scale).toBeGreaterThan(1.1)
    expect(at(plan.vanishAt + 300, 1).opacity).toBeLessThan(0.01)
    expect(at(plan.entry - 10, 1).scale).toBeLessThan(0.3)
  })

  it('很短的间奏：时间点保持先后顺序，不出现 NaN', () => {
    for (const end of [300, 1500, 2600]) {
      const plan = interludePlan(0, end, 3, fixed)
      const points = [...plan.lit, plan.exitAt, plan.vanishAt, plan.entry]
      expect(points.every(Number.isFinite)).toBe(true)
      expect(plan.lit[0]).toBeLessThanOrEqual(plan.lit[1])
      expect(plan.lit[1]).toBeLessThanOrEqual(plan.lit[2])
      expect(plan.exitAt).toBeLessThanOrEqual(plan.vanishAt)
      expect(plan.vanishAt).toBeLessThanOrEqual(plan.entry)
      expect(plan.entry).toBeLessThanOrEqual(end)
      for (let t = 0; t < end; t += 50)
        expect(interludeDots(0, end, t, 3).every(dot => Number.isFinite(dot.opacity) && Number.isFinite(dot.scale))).toBe(true)
    }
  })
})
