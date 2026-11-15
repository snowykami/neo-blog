import { NextIntlClientProvider } from 'next-intl'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaginationController } from './pagination'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const messages = {
  Components: {
    pagination: {
      go_to_page: '前往第 {page} 页',
      previous_page: '上一页',
      next_page: '下一页',
      page_size: '每页条数',
    },
  },
}

describe('paginationController 无障碍与链接语义', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    if (!window.matchMedia) {
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    }
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    host.remove()
    document.body.innerHTML = ''
  })

  async function renderPagination(props: React.ComponentProps<typeof PaginationController>) {
    await act(async () => {
      root.render(
        React.createElement(NextIntlClientProvider, {
          locale: 'zh-CN',
          messages,
          children: React.createElement(PaginationController, props),
        }),
      )
    })
  }

  it('未传 buildHref 时全部渲染为原生 button，不渲染空 href 的 a 且禁用态不使用 aria-disabled', async () => {
    await renderPagination({ total: 0, pageSize: 10 })
    expect(host.querySelectorAll('a')).toHaveLength(0)
    const zeroButtons = host.querySelectorAll('button')
    expect(zeroButtons).toHaveLength(1)
    expect(zeroButtons[0].getAttribute('type')).toBe('button')
    expect(zeroButtons[0].getAttribute('aria-current')).toBe('page')

    const onPageChange = vi.fn()
    await renderPagination({ total: 30, pageSize: 10, page: 1, onPageChange })

    expect(host.querySelectorAll('a')).toHaveLength(0)
    expect(host.querySelectorAll('[aria-disabled]')).toHaveLength(0)

    const buttons = Array.from(host.querySelectorAll('button'))
    expect(buttons).toHaveLength(5) // 上一页 + 1/2/3 + 下一页
    buttons.forEach(btn => expect(btn.getAttribute('type')).toBe('button'))

    const prevBtn = host.querySelector('button[aria-label="上一页"]') as HTMLButtonElement
    const nextBtn = host.querySelector('button[aria-label="下一页"]') as HTMLButtonElement
    const page1Btn = host.querySelector('button[aria-label="前往第 1 页"]') as HTMLButtonElement
    const page2Btn = host.querySelector('button[aria-label="前往第 2 页"]') as HTMLButtonElement

    expect(prevBtn.disabled).toBe(true)
    expect(nextBtn.disabled).toBe(false)
    expect(page1Btn.getAttribute('aria-current')).toBe('page')
    expect(page2Btn.getAttribute('aria-current')).toBeNull()

    await act(async () => {
      page2Btn.click()
    })
    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  it('传入 buildHref 时可用页渲染为带合法 href 的 a，禁用态渲染为 disabled button', async () => {
    const onPageChange = vi.fn()
    const buildHref = (p: number) => (p === 1 ? '?' : `?page=${p}`)

    await renderPagination({ total: 30, pageSize: 10, page: 1, buildHref, onPageChange })

    expect(host.querySelectorAll('[aria-disabled]')).toHaveLength(0)

    const prevEl = host.querySelector('[aria-label="上一页"]') as HTMLButtonElement
    expect(prevEl.tagName).toBe('BUTTON')
    expect(prevEl.type).toBe('button')
    expect(prevEl.disabled).toBe(true)

    const anchors = Array.from(host.querySelectorAll('a'))
    expect(anchors).toHaveLength(4) // 1, 2, 3, 下一页
    anchors.forEach((a) => {
      const href = a.getAttribute('href')
      expect(href).toBeTruthy()
    })

    const page1Link = host.querySelector('a[aria-label="前往第 1 页"]') as HTMLAnchorElement
    const page2Link = host.querySelector('a[aria-label="前往第 2 页"]') as HTMLAnchorElement
    const nextLink = host.querySelector('a[aria-label="下一页"]') as HTMLAnchorElement

    expect(page1Link.getAttribute('href')).toBe('?')
    expect(page1Link.getAttribute('aria-current')).toBe('page')
    expect(page2Link.getAttribute('href')).toBe('?page=2')
    expect(nextLink.getAttribute('href')).toBe('?page=2')

    // 带修饰键（Ctrl/Cmd）点击保留浏览器默认行为
    const metaEvent = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: true })
    await act(async () => {
      page2Link.dispatchEvent(metaEvent)
    })
    expect(metaEvent.defaultPrevented).toBe(false)
    expect(onPageChange).not.toHaveBeenCalledWith(2)

    // 普通左键点击阻止整页跳转并触发客户端翻页
    const plainEvent = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    await act(async () => {
      page2Link.dispatchEvent(plainEvent)
    })
    expect(plainEvent.defaultPrevented).toBe(true)
    expect(onPageChange).toHaveBeenCalledWith(2)

    // 末页时下一页渲染为 disabled button
    await renderPagination({ total: 30, pageSize: 10, page: 3, buildHref, onPageChange })
    const nextBtnAtEnd = host.querySelector('[aria-label="下一页"]') as HTMLButtonElement
    expect(nextBtnAtEnd.tagName).toBe('BUTTON')
    expect(nextBtnAtEnd.disabled).toBe(true)
  })

  it('disabled 为 true 时即使传入 buildHref 也全部降级为禁用 button', async () => {
    await renderPagination({
      total: 30,
      pageSize: 10,
      page: 2,
      disabled: true,
      buildHref: p => `?page=${p}`,
    })

    expect(host.querySelectorAll('a')).toHaveLength(0)
    expect(host.querySelectorAll('[aria-disabled]')).toHaveLength(0)
    const buttons = Array.from(host.querySelectorAll('button'))
    expect(buttons.length).toBeGreaterThan(0)
    buttons.forEach(btn => expect(btn.disabled).toBe(true))
  })
})
