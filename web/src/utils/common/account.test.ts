import { describe, expect, it } from 'vitest'
import { isValidEmail, isValidPassword } from './account'

describe('isValidEmail', () => {
  it('接受常见的邮箱地址', () => {
    expect(isValidEmail('someone@example.com')).toBe(true)
    expect(isValidEmail('first.last+tag@mail.example.org')).toBe(true)
    expect(isValidEmail('admin@localhost')).toBe(true)
  })

  it('拒绝明显不是邮箱的输入', () => {
    expect(isValidEmail('')).toBe(false)
    expect(isValidEmail('bad-email')).toBe(false)
    expect(isValidEmail('a@')).toBe(false)
    expect(isValidEmail('@example.com')).toBe(false)
    expect(isValidEmail('a@@example.com')).toBe(false)
    expect(isValidEmail('a b@example.com')).toBe(false)
    expect(isValidEmail('a@example..com')).toBe(false)
    expect(isValidEmail('a@example.com.')).toBe(false)
    expect(isValidEmail(' a@example.com')).toBe(false)
  })
})

describe('isValidPassword', () => {
  it('长度在 8–32 之间', () => {
    expect(isValidPassword('1234567')).toBe(false)
    expect(isValidPassword('12345678')).toBe(true)
    expect(isValidPassword('a'.repeat(32))).toBe(true)
    expect(isValidPassword('a'.repeat(33))).toBe(false)
  })
})
