import { describe, expect, it } from 'vitest'
import { remoteDraftDiverged } from './use-content-editor'

describe('remoteDraftDiverged', () => {
  it('版本号相同时不合并', () => {
    expect(remoteDraftDiverged(6, 6)).toBe(false)
    expect(remoteDraftDiverged(undefined, 0)).toBe(false)
  })

  it('服务端版本更新时合并', () => {
    expect(remoteDraftDiverged(7, 6)).toBe(true)
  })

  it('服务端版本比基线小时也合并，避免一直 draft_conflict', () => {
    expect(remoteDraftDiverged(5, 6)).toBe(true)
    expect(remoteDraftDiverged(undefined, 3)).toBe(true)
  })
})
