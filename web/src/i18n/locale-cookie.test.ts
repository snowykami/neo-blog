import { describe, expect, it } from 'vitest'
import { LOCALE_COOKIE, readLocaleCookie, writeLocaleCookie } from './locale-cookie'

describe('locale cookie', () => {
  it('reads the cookie by exact name', () => {
    expect(readLocaleCookie('')).toBe('')
    expect(readLocaleCookie(`a=b; ${LOCALE_COOKIE}=zh-tw; c=d`)).toBe('zh-tw')
    expect(readLocaleCookie(`X${LOCALE_COOKIE}=ja`)).toBe('')
    expect(readLocaleCookie(`${LOCALE_COOKIE}=%E0%A4%A`)).toBe('')
  })

  it('writes a cookie the reader understands', () => {
    writeLocaleCookie('ja')
    expect(readLocaleCookie(document.cookie)).toBe('ja')
  })
})
