import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { themeInitScript } from './init-script'

/**
 * 首帧脚本是内联字符串，没法按常规 import 断言，直接执行一遍看它对 DOM / 存储做了什么。
 * 这层测试的价值在于：它和水合后的 DeviceProvider 是同一套规则的两个实现，容易漂移。
 */

const realMatchMedia = window.matchMedia

function setSystemDark(dark: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('prefers-color-scheme: dark') ? dark : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

function runScript() {
  // eslint-disable-next-line no-new-func
  new Function(themeInitScript)()
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.className = ''
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-theme-effect')
  document.documentElement.removeAttribute('data-theme-mode')
  setSystemDark(false)
})

afterEach(() => {
  window.matchMedia = realMatchMedia
})

describe('首帧脚本：明暗解析', () => {
  it('没有节日主题时跟随用户偏好', () => {
    localStorage.setItem('theme', 'dark')
    runScript()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('没有节日主题且偏好是跟随系统时看系统', () => {
    setSystemDark(true)
    runScript()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('节日绑定夜晚时优先用夜晚，即使系统是亮色', () => {
    document.documentElement.setAttribute('data-theme', 'halloween')
    document.documentElement.setAttribute('data-theme-mode', 'dark')
    localStorage.setItem('theme', 'light')
    runScript()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('用户在节日期间手动改成亮色，就按用户的来', () => {
    document.documentElement.setAttribute('data-theme', 'halloween')
    document.documentElement.setAttribute('data-theme-mode', 'dark')
    localStorage.setItem('theme-mode-override', JSON.stringify({ id: 'halloween', mode: 'light' }))
    runScript()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('用户在节日期间手动选「跟随系统」也生效', () => {
    document.documentElement.setAttribute('data-theme', 'halloween')
    document.documentElement.setAttribute('data-theme-mode', 'dark')
    localStorage.setItem('theme-mode-override', JSON.stringify({ id: 'halloween', mode: 'system' }))
    runScript()
    // 系统是亮色 → 亮色
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    // 换成系统暗色 → 暗色
    document.documentElement.className = ''
    setSystemDark(true)
    runScript()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})

describe('首帧脚本：开关与标记清理', () => {
  it('用户关掉节日主题时摘掉属性并回到自己的偏好', () => {
    document.documentElement.setAttribute('data-theme', 'halloween')
    document.documentElement.setAttribute('data-theme-effect', 'flicker')
    document.documentElement.setAttribute('data-theme-mode', 'dark')
    localStorage.setItem('theme-pack', 'off')
    localStorage.setItem('theme', 'light')
    runScript()
    expect(document.documentElement.getAttribute('data-theme')).toBeNull()
    expect(document.documentElement.getAttribute('data-theme-mode')).toBeNull()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('手动标记属于别的节日时直接清掉', () => {
    document.documentElement.setAttribute('data-theme', 'christmas')
    document.documentElement.setAttribute('data-theme-mode', 'dark')
    localStorage.setItem('theme-mode-override', JSON.stringify({ id: 'halloween', mode: 'light' }))
    runScript()
    expect(localStorage.getItem('theme-mode-override')).toBeNull()
    // 标记失效后回到节日默认
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('节日已经过去（没有 data-theme）时也清掉残留标记', () => {
    localStorage.setItem('theme-mode-override', JSON.stringify({ id: 'halloween', mode: 'light' }))
    localStorage.setItem('theme', 'dark')
    runScript()
    expect(localStorage.getItem('theme-mode-override')).toBeNull()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('本地配色方案仍然被应用', () => {
    localStorage.setItem('color-scheme', 'violet')
    runScript()
    expect(document.documentElement.getAttribute('data-user-color')).toBe('violet')
  })
})
