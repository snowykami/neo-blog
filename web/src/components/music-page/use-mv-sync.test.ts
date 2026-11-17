import { describe, expect, it } from 'vitest'
import {
  clampMvOffsetMs,
  computeDriftCorrection,
  computeTargetVideoTime,
  formatMvOffset,
  isTargetVideoTimeInBounds,
  MAX_MV_OFFSET_MS,
  MIN_MV_OFFSET_MS,
} from './use-mv-sync'

describe('use-mv-sync pure helpers', () => {
  it('按公式 targetVideoTime = audioCurrentTime + offsetMs / 1000 计算目标时间', () => {
    expect(computeTargetVideoTime(10, 0)).toBe(10)
    expect(computeTargetVideoTime(0, 3500)).toBe(3.5)
    expect(computeTargetVideoTime(2, -5000)).toBe(-3)
  })

  it('判断时间轴越界区间（< 0 或 >= duration）', () => {
    expect(isTargetVideoTimeInBounds(-0.1, 180)).toBe(false)
    expect(isTargetVideoTimeInBounds(0, 180)).toBe(true)
    expect(isTargetVideoTimeInBounds(179.9, 180)).toBe(true)
    expect(isTargetVideoTimeInBounds(180, 180)).toBe(false)
    expect(isTargetVideoTimeInBounds(190, 180)).toBe(false)
    // 元数据尚未给出有效 duration 时，非负时间视为有效，负时间仍越界
    expect(isTargetVideoTimeInBounds(5, Number.NaN)).toBe(true)
    expect(isTargetVideoTimeInBounds(-1, Number.NaN)).toBe(false)
  })

  it('按漂移阈值分级纠偏（< 0.25s 忽略、0.25s~1.5s 调速、>= 1.5s 直接 seek）', () => {
    expect(computeDriftCorrection(10, 9.85)).toEqual({ kind: 'none', playbackRate: 1 })
    expect(computeDriftCorrection(10, 10.2)).toEqual({ kind: 'none', playbackRate: 1 })

    const catchUp = computeDriftCorrection(10.8, 10)
    expect(catchUp.kind).toBe('rate')
    expect(catchUp.playbackRate).toBeGreaterThan(1)
    expect(catchUp.playbackRate).toBeLessThanOrEqual(1.12)

    const slowDown = computeDriftCorrection(10, 10.8)
    expect(slowDown.kind).toBe('rate')
    expect(slowDown.playbackRate).toBeLessThan(1)
    expect(slowDown.playbackRate).toBeGreaterThanOrEqual(0.88)

    expect(computeDriftCorrection(12, 10)).toEqual({ kind: 'seek', targetTime: 12, playbackRate: 1 })
    expect(computeDriftCorrection(8, 10)).toEqual({ kind: 'seek', targetTime: 8, playbackRate: 1 })
  })

  it('裁剪与格式化 MV Offset', () => {
    expect(clampMvOffsetMs(-999999)).toBe(MIN_MV_OFFSET_MS)
    expect(clampMvOffsetMs(999999)).toBe(MAX_MV_OFFSET_MS)
    expect(clampMvOffsetMs(1250)).toBe(1250)
    expect(formatMvOffset(1000)).toBe('+1.0s')
    expect(formatMvOffset(-100)).toBe('-0.1s')
    expect(formatMvOffset(0)).toBe('0.0s')
  })
})
