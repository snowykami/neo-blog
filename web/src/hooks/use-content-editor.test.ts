import { describe, expect, it } from 'vitest'
import { fitsKeepalive, remoteDraftDiverged, waitForSaveSettled } from './use-content-editor'

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

describe('fitsKeepalive', () => {
  it('请求体在 keepalive 上限内时使用 keepalive', () => {
    expect(fitsKeepalive({ draftContent: '<p>短内容</p>' })).toBe(true)
  })

  it('超出上限（按 UTF-8 字节计）时退回普通请求', () => {
    expect(fitsKeepalive({ draftContent: '字'.repeat(25_000) })).toBe(false)
    expect(fitsKeepalive({ draftContent: 'a'.repeat(70_000) })).toBe(false)
  })
})

describe('waitForSaveSettled', () => {
  it('等进行中的保存结束后再继续（离开前补存不依赖定时器）', async () => {
    let saving = true
    setTimeout(() => {
      saving = false
    }, 20)
    await waitForSaveSettled(() => saving, 5)
    expect(saving).toBe(false)
  })

  it('没有进行中的保存时立即返回', async () => {
    let calls = 0
    await waitForSaveSettled(() => {
      calls++
      return false
    })
    expect(calls).toBe(1)
  })
})
