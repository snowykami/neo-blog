import type { NavMenuItem } from './nav-shared'
import { HouseIcon, NewspaperIcon, PanelsTopLeftIcon } from 'lucide-react'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileNavSheet } from './mobile-nav-sheet'

const selectColorSpy = vi.fn()

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  Link: ({
    children,
    href,
    className,
    onClick,
    prefetch: _prefetch,
    unstable_dynamicOnHover: _dynamicOnHover,
    ...rest
  }: React.ComponentProps<'a'> & { prefetch?: boolean, unstable_dynamicOnHover?: boolean }) =>
    React.createElement('a', { href, className, onClick, ...rest }, children),
}))

vi.mock('@/components/common/color-scheme-picker', () => ({
  useColorScheme: () => ({
    color: 'blue',
    colorSchemes: ['blue', 'green', 'rose', 'violet'],
    selectColor: selectColorSpy,
  }),
  ColorSchemeCircles: ({ color, colorSchemes, onSelect }: { color: string, colorSchemes: string[], onSelect: (s: string) => void }) =>
    React.createElement(
      'div',
      { 'data-testid': 'color-scheme-circles' },
      colorSchemes.map(scheme =>
        React.createElement(
          'button',
          {
            'key': scheme,
            'type': 'button',
            'data-scheme': scheme,
            'aria-pressed': color === scheme,
            'onClick': () => onSelect(scheme),
          },
          scheme,
        ),
      ),
    ),
  ThemePackSection: () => React.createElement('div', { 'data-testid': 'theme-pack-section' }),
}))

vi.mock('@/contexts/theme-context', () => ({
  useTheme: () => ({ theme: null, enabled: false, setEnabled: vi.fn() }),
}))

vi.mock('@/hooks/use-color-scheme-name', () => ({
  useColorSchemeName: () => (scheme: string) => `scheme:${scheme}`,
}))

vi.mock('@/contexts/device-context', () => ({
  useDevice: () => ({ mode: 'system', setMode: vi.fn() }),
}))

describe('mobileNavSheet 移动端侧边菜单', () => {
  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    selectColorSpy.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const sampleItems: NavMenuItem[] = [
    { title: 'homepage', href: '/', icon: HouseIcon },
    {
      title: 'post',
      icon: NewspaperIcon,
      children: [
        { title: 'archive', href: '/a' },
        { title: 'category', href: '/c' },
      ],
    },
    {
      title: 'page',
      icon: PanelsTopLeftIcon,
      children: [
        { title: 'page-1', label: '友链', href: '/links' },
        { title: 'page-2', label: '音乐播放器', href: '/music' },
      ],
    },
  ]

  it('首页与子分组导航项保持一致的 h-11 shrink-0 盒模型，且颜色主题默认折叠为单按钮并通过 Popover 展开切换', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const triggerRef = { current: null }

    try {
      await act(async () => {
        root.render(React.createElement(MobileNavSheet, {
          items: sampleItems,
          open: true,
          setOpen: vi.fn(),
          triggerRef,
        }))
      })

      const sheetEl = document.body.querySelector('[data-slot="sheet-content"]')!
      expect(sheetEl).not.toBeNull()

      // 1. 验证首页与其他导航链接全部具备统一 h-11 shrink-0 类名，且置于 grid 容器内不被压缩
      const navEl = sheetEl.querySelector('nav')!
      expect(navEl.className).toContain('grid')
      const links = Array.from(navEl.querySelectorAll('a'))
      expect(links.length).toBe(5)
      for (const link of links) {
        expect(link.className).toContain('h-11')
        expect(link.className).toContain('shrink-0')
      }

      // 2. 默认不平铺全部圆形色块，仅展示单个紧凑颜色触发按钮
      expect(document.body.querySelector('[data-testid="color-scheme-circles"]')).toBeNull()
      const paletteTrigger = sheetEl.querySelector('[data-slot="popover-trigger"]') as HTMLButtonElement
      expect(paletteTrigger).not.toBeNull()
      expect(paletteTrigger.textContent).toContain('scheme:blue')

      // 3. 点击触发按钮弹出自研 Popover 色板并切换主题色
      await act(async () => {
        paletteTrigger.click()
      })
      const circles = document.body.querySelector('[data-testid="color-scheme-circles"]')!
      expect(circles).not.toBeNull()
      const roseBtn = circles.querySelector('button[data-scheme="rose"]') as HTMLButtonElement
      await act(async () => {
        roseBtn.click()
      })
      expect(selectColorSpy).toHaveBeenCalledWith('rose')
    }
    finally {
      await act(async () => {
        root.unmount()
      })
      container.remove()
    }
  })

  it('内容超出可视高度时自动激活底部滚动提示微胶囊与进度滑轨，点击胶囊平滑下翻并在到底后隐藏', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const triggerRef = { current: null }

    try {
      await act(async () => {
        root.render(React.createElement(MobileNavSheet, {
          items: sampleItems,
          open: true,
          setOpen: vi.fn(),
          triggerRef,
        }))
      })

      const sheetEl = document.body.querySelector('[data-slot="sheet-content"]')!
      const viewportEl = sheetEl.querySelector('.overflow-y-auto') as HTMLDivElement
      expect(viewportEl).not.toBeNull()

      // 未溢出时底部提示胶囊对辅助技术隐藏且不可 Tab 聚焦
      const findHintBtn = () => Array.from(sheetEl.querySelectorAll('button')).find(b => b.textContent?.includes('scroll_more'))!
      expect(findHintBtn().getAttribute('aria-hidden')).toBe('true')
      expect(findHintBtn().tabIndex).toBe(-1)

      // 模拟内容增多产生纵向溢出（scrollHeight=600, clientHeight=280, scrollTop=0）
      let currentScrollTop = 0
      Object.defineProperty(viewportEl, 'scrollHeight', { configurable: true, get: () => 600 })
      Object.defineProperty(viewportEl, 'clientHeight', { configurable: true, get: () => 280 })
      Object.defineProperty(viewportEl, 'scrollTop', {
        configurable: true,
        get: () => currentScrollTop,
        set: (v: number) => { currentScrollTop = v },
      })
      const scrollBySpy = vi.fn(({ top }: { top: number }) => {
        currentScrollTop = Math.min(320, currentScrollTop + top)
      })
      viewportEl.scrollBy = scrollBySpy as unknown as typeof viewportEl.scrollBy

      await act(async () => {
        viewportEl.dispatchEvent(new Event('scroll'))
      })
      expect(findHintBtn().getAttribute('aria-hidden')).toBe('false')
      expect(findHintBtn().tabIndex).toBe(0)

      // 点击提示胶囊触发下翻，滚到底部后自动收起提示
      await act(async () => {
        findHintBtn().click()
      })
      expect(scrollBySpy).toHaveBeenCalledTimes(1)
      currentScrollTop = 320
      await act(async () => {
        viewportEl.dispatchEvent(new Event('scroll'))
      })
      expect(findHintBtn().getAttribute('aria-hidden')).toBe('true')
    }
    finally {
      await act(async () => {
        root.unmount()
      })
      container.remove()
    }
  })
})
