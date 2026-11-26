import type { FriendTechItem } from '@/models/friend'
import { NextIntlClientProvider } from 'next-intl'
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import zhMessages from '@/locales/zh.json'
import { FriendCard } from './friend-card'
import { FriendTechIcon } from './friend-tech-icon'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe('friend-card 技术栈展示与双端悬浮窗', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('techStack 为空时不渲染 info 按钮，且完整保留 cf-friends-* 爬虫结构', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        React.createElement(NextIntlClientProvider, {
          locale: 'zh',
          messages: zhMessages,
          children: React.createElement(FriendCard, {
            item: {
              name: '测试友链',
              url: 'https://blog.example.com',
              avatar: 'https://blog.example.com/avatar.png',
              description: '这是一个测试描述',
              colorKey: 'sky',
              healthStatus: 'healthy',
              latencyMs: 120,
              techStack: [],
            },
          }),
        }),
      )
    })

    const linkEl = container.querySelector('a.cf-friends-link')
    expect(linkEl).not.toBeNull()
    expect(linkEl?.getAttribute('href')).toBe('https://blog.example.com')
    expect(linkEl?.querySelector('.cf-friends-avatar')?.getAttribute('data-src')).toBe('https://blog.example.com/avatar.png')
    expect(linkEl?.querySelector('.cf-friends-name')?.textContent).toBe('测试友链')
    expect(container.querySelector('button')).toBeNull()

    // 非交互预览卡片（interactive=false）不应输出 cf-friends-* 爬虫类名，避免污染外部朋友圈抓取
    await act(async () => {
      root.render(
        React.createElement(NextIntlClientProvider, {
          locale: 'zh',
          messages: zhMessages,
          children: React.createElement(FriendCard, {
            interactive: false,
            item: {
              name: '本站友链名片',
              url: 'https://self.example.com',
              avatar: 'https://self.example.com/avatar.png',
              description: '预览描述',
              colorKey: 'sky',
            },
          }),
        }),
      )
    })
    expect(container.querySelector('.cf-friends-link')).toBeNull()
    expect(container.querySelector('.cf-friends-name')).toBeNull()
    expect(container.querySelector('.cf-friends-avatar')).toBeNull()

    await act(async () => {
      root.unmount()
    })
  })

  it('techStack 非空时 info 按钮与 <a> 同级不嵌套，鼠标悬停展开/延迟收起，且点击不触发友链跳转', async () => {
    vi.useFakeTimers()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    const techStack: FriendTechItem[] = [
      { id: 'cloudflare', name: 'Cloudflare', category: 'cdn' },
      { id: 'caddy', name: 'Caddy', category: 'server' },
      { id: 'neo-blog', name: 'neo-blog', category: 'cms' },
      { id: 'nextjs', name: 'Next.js', category: 'framework' },
      { id: 'react', name: 'React', category: 'framework' },
    ]

    const onAnchorClick = vi.fn((e: Event) => e.preventDefault())

    await act(async () => {
      root.render(
        React.createElement(NextIntlClientProvider, {
          locale: 'zh',
          messages: zhMessages,
          children: React.createElement(FriendCard, {
            item: {
              name: '雪神的博客',
              url: 'https://blog.sfkm.me',
              avatar: 'https://blog.sfkm.me/avatar.png',
              description: '技术与生活随笔',
              colorKey: 'ocean',
              healthStatus: 'healthy',
              latencyMs: 86,
              techStack,
            },
          }),
        }),
      )
    })

    const linkEl = container.querySelector('a.cf-friends-link')!
    expect(linkEl).not.toBeNull()
    linkEl.addEventListener('click', onAnchorClick)

    // 严禁 <a> 内部嵌套 <button>
    expect(linkEl.querySelector('button')).toBeNull()

    const infoBtn = container.querySelector('button[aria-label*="雪神的博客"]') as HTMLButtonElement
    expect(infoBtn).not.toBeNull()

    // 桌面鼠标移入触发延迟开启（React 的 onPointerEnter 基于底层冒泡的 pointerover 合成）
    await act(async () => {
      infoBtn.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
      vi.advanceTimersByTime(80)
    })

    const popover = document.body.querySelector('[data-slot="popover-content"]') as HTMLElement
    expect(popover).not.toBeNull()
    expect(popover.textContent).toContain('站点技术栈')
    expect(popover.textContent).toContain('86 ms')
    expect(popover.textContent).toContain('Cloudflare')
    expect(popover.textContent).toContain('Caddy')
    expect(popover.textContent).toContain('neo-blog')
    expect(popover.textContent).toContain('Next.js')
    expect(popover.textContent).toContain('React')

    // 鼠标从按钮移向浮层内容期间（<150ms）保持打开
    await act(async () => {
      infoBtn.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: document.body }))
      vi.advanceTimersByTime(80)
      popover.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
      vi.advanceTimersByTime(200)
    })
    expect(document.body.querySelector('[data-slot="popover-content"]')).not.toBeNull()

    // 纯悬停展开态下，鼠标离开浮层超过 150ms 后自动收起
    await act(async () => {
      popover.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: document.body }))
      vi.advanceTimersByTime(180)
    })
    expect(document.body.querySelector('[data-slot="popover-content"]')).toBeNull()

    // 悬停展开后单击 info 按钮应将其固定：鼠标移出超过 150ms 仍保持打开，再次点击才关闭，且全程不触发 <a> 跳转
    await act(async () => {
      infoBtn.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
      vi.advanceTimersByTime(80)
    })
    expect(document.body.querySelector('[data-slot="popover-content"]')).not.toBeNull()

    await act(async () => {
      infoBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
      infoBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      infoBtn.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: document.body }))
      vi.advanceTimersByTime(300)
    })
    expect(onAnchorClick).not.toHaveBeenCalled()
    expect(document.body.querySelector('[data-slot="popover-content"]')).not.toBeNull()

    await act(async () => {
      infoBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
      infoBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(document.body.querySelector('[data-slot="popover-content"]')).toBeNull()

    // 移动端触屏轻点展开、再次轻点收起，且全程不触发 <a> 跳转
    await act(async () => {
      infoBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))
      infoBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(onAnchorClick).not.toHaveBeenCalled()
    expect(document.body.querySelector('[data-slot="popover-content"]')).not.toBeNull()

    await act(async () => {
      infoBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))
      infoBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(onAnchorClick).not.toHaveBeenCalled()
    expect(document.body.querySelector('[data-slot="popover-content"]')).toBeNull()

    await act(async () => {
      root.unmount()
    })
  })

  it('friendTechIcon 覆盖常见指纹与分类兜底图标', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    const ids = [
      ['cloudflare', 'cdn'],
      ['vercel', 'cdn'],
      ['edgeone', 'cdn'],
      ['nginx', 'server'],
      ['caddy', 'server'],
      ['hexo', 'cms'],
      ['astro', 'cms'],
      ['wordpress', 'cms'],
      ['halo', 'cms'],
      ['nextjs', 'framework'],
      ['vue', 'framework'],
      ['unknown-cdn', 'cdn'],
      ['unknown-cms', 'cms'],
    ] as const

    await act(async () => {
      root.render(
        React.createElement(
          'div',
          null,
          ids.map(([id, category]) => React.createElement(FriendTechIcon, { key: id, id, category })),
        ),
      )
    })

    expect(container.querySelectorAll('svg').length).toBe(ids.length)

    await act(async () => {
      root.unmount()
    })
  })
})
