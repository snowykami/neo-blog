import { describe, expect, it } from 'vitest'
import { pickColorScheme } from './color-scheme'

const allowed = ['blue', 'violet', 'green']

describe('pickColorScheme', () => {
  it('prefers the account preference after login, then the local choice, then the site default', () => {
    expect(pickColorScheme({ account: 'green', stored: 'violet', fallback: 'blue', allowed })).toBe('green')
    expect(pickColorScheme({ account: '', stored: 'violet', fallback: 'blue', allowed })).toBe('violet')
    expect(pickColorScheme({ account: null, stored: null, fallback: 'blue', allowed })).toBe('blue')
  })

  it('skips schemes that are no longer offered', () => {
    expect(pickColorScheme({ account: 'pink', stored: 'violet', fallback: 'blue', allowed })).toBe('violet')
    expect(pickColorScheme({ account: 'pink', stored: 'red', fallback: 'blue', allowed })).toBe('blue')
    expect(pickColorScheme({ account: 'pink', stored: 'red', fallback: 'rose', allowed })).toBeUndefined()
  })
})
