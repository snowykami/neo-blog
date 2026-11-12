import { NextIntlClientProvider } from 'next-intl'
import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import zhMessages from '@/locales/zh.json'
import { ImageViewer } from './content-image-viewer'

const globalActEnv = globalThis as Record<string, unknown>
// React 19 测试环境标识，消除 act() 警告
globalActEnv.IS_REACT_ACT_ENVIRONMENT = true

const SAMPLE_IMAGES = [
  { src: 'https://example.com/1.jpg', alt: '图一', caption: '第一张图注' },
  { src: 'https://example.com/2.jpg', alt: '图二', caption: '第二张图注' },
  { src: 'https://example.com/3.jpg', alt: '图三', caption: '第三张图注' },
]

function dispatchPointer(target: Element, type: string, init: PointerEventInit = {}) {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    clientX: 400,
    clientY: 300,
    ...init,
  })
  target.dispatchEvent(event)
}

describe('content-image-viewer 组件交互回归', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    vi.useFakeTimers()
    // 测试环境下跳过关闭过渡等待，直接验证状态收敛
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }))
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
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  function mountViewer(initialIndex = 0) {
    let latestIndex: number | null = initialIndex
    function Harness() {
      const [idx, setIdx] = useState<number | null>(initialIndex)
      latestIndex = idx
      return React.createElement(NextIntlClientProvider, {
        locale: 'zh',
        messages: { ImageViewer: zhMessages.ImageViewer },
        children: React.createElement(ImageViewer, {
          images: SAMPLE_IMAGES,
          index: idx,
          onIndexChange: setIdx,
        }),
      })
    }
    act(() => {
      root.render(React.createElement(Harness))
    })
    return { getIndex: () => latestIndex }
  }

  it('单击图片本身不会误关预览器，双击图片可放大与还原', () => {
    const { getIndex } = mountViewer(0)
    const img = document.body.querySelector<HTMLImageElement>('img[alt="图一"]')!
    expect(img).toBeTruthy()

    // 单击图片正中央：绝不能关闭预览器
    act(() => {
      dispatchPointer(img, 'pointerdown', { clientX: 500, clientY: 400 })
      dispatchPointer(img, 'pointerup', { clientX: 500, clientY: 400 })
    })
    expect(getIndex()).toBe(0)

    // 紧接着第二次点击构成双击：放大到 >= 200%
    act(() => {
      vi.advanceTimersByTime(120)
      dispatchPointer(img, 'pointerdown', { clientX: 502, clientY: 401 })
      dispatchPointer(img, 'pointerup', { clientX: 502, clientY: 401 })
    })
    const resetBtn = document.body.querySelector<HTMLButtonElement>('button[aria-label="重置缩放"]')!
    expect(resetBtn.textContent).not.toBe('100%')

    // 放大状态下点击背景空白：先重置回 100%，不会直接把预览器关掉
    const stage = document.body.querySelector('[data-viewer-stage]')!
    act(() => {
      vi.advanceTimersByTime(400)
      dispatchPointer(stage, 'pointerdown', { clientX: 20, clientY: 20 })
      dispatchPointer(stage, 'pointerup', { clientX: 20, clientY: 20 })
    })
    expect(getIndex()).toBe(0)
    expect(resetBtn.textContent).toBe('100%')

    // 100% 原始大小下再次点击背景空白：正常关闭预览器
    act(() => {
      dispatchPointer(stage, 'pointerdown', { clientX: 20, clientY: 20 })
      dispatchPointer(stage, 'pointerup', { clientX: 20, clientY: 20 })
    })
    expect(getIndex()).toBeNull()
  })

  it('翻到最后一张时继续点击禁用的「下一张」按钮不会穿透关闭预览器', () => {
    const { getIndex } = mountViewer(2)
    const nextBtn = document.body.querySelector<HTMLButtonElement>('button[aria-label="下一张"]')!
    expect(nextBtn.getAttribute('aria-disabled')).toBe('true')

    act(() => {
      dispatchPointer(nextBtn, 'pointerdown', { clientX: 980, clientY: 400 })
      dispatchPointer(nextBtn, 'pointerup', { clientX: 980, clientY: 400 })
      nextBtn.click()
    })
    expect(getIndex()).toBe(2)
  })

  it('鼠标右键点击空白处不会关闭预览器，缩略图点击可直接跳选且支持返回键关闭', () => {
    const { getIndex } = mountViewer(0)
    const stage = document.body.querySelector('[data-viewer-stage]')!

    // 右键点击舞台空白处
    act(() => {
      dispatchPointer(stage, 'pointerdown', { button: 2, clientX: 30, clientY: 30 })
      dispatchPointer(stage, 'pointerup', { button: 2, clientX: 30, clientY: 30 })
    })
    expect(getIndex()).toBe(0)

    // 点击底部第 3 张缩略图直接跳转
    const thirdThumb = document.body.querySelector<HTMLButtonElement>('[data-thumb-index="2"]')!
    act(() => {
      thirdThumb.click()
    })
    expect(getIndex()).toBe(2)

    // 移动端触发浏览器返回事件（popstate）时优先关闭预览器
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(getIndex()).toBeNull()
  })
})
