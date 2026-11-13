import { describe, expect, it } from 'vitest'
import { toStaticPath } from './symbolicate'

describe('toStaticPath', () => {
  it('extracts /_next/static/ path from same-origin and CDN root URLs', () => {
    expect(toStaticPath('/_next/static/chunks/main-abc123.js')).toBe('/_next/static/chunks/main-abc123.js')
    expect(toStaticPath('https://cdn.example.com/_next/static/chunks/main-abc123.js?v=1')).toBe('/_next/static/chunks/main-abc123.js')
  })

  it('strips CDN subpath assetPrefix before /_next/static/', () => {
    expect(toStaticPath('https://cdn.example.com/neo-blog/v2/_next/static/chunks/app-xyz.js')).toBe('/_next/static/chunks/app-xyz.js')
  })

  it('returns null for non-static URLs', () => {
    expect(toStaticPath('https://blog.example.com/p/hello')).toBeNull()
    expect(toStaticPath('webpack-internal:///./src/index.ts')).toBeNull()
  })
})
