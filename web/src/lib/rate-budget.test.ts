import { describe, expect, it } from 'vitest'
import { createRateBudget } from './rate-budget'

describe('createRateBudget', () => {
  it('allows up to the limit per window and resets in the next window', () => {
    let now = 0
    const take = createRateBudget(2, 1000, () => now)
    expect([take(), take(), take()]).toEqual([true, true, false])
    now = 999
    expect(take()).toBe(false)
    now = 1000
    expect([take(), take(), take()]).toEqual([true, true, false])
  })
})
