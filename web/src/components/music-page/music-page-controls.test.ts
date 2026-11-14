import type { LyricLine } from '@/lib/lyrics/types'
import type { MusicTrack } from '@/models/music'
import { NextIntlClientProvider } from 'next-intl'
import * as React from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import zhMessages from '@/locales/zh.json'
import { MoreControlsMenu } from './music-page-controls'

const sampleTrack: MusicTrack = {
  id: 1,
  name: '琵琶行',
  artists: ['白居易'],
  album: '唐诗集',
  albumPic: '',
  audio: '',
  lyric: '',
  link: '',
  aliases: [],
}

const sampleLines: LyricLine[] = [
  {
    start: 1000,
    end: 4000,
    words: [{ text: '五陵年少争缠头', start: 1000, end: 4000 }],
    romanization: 'wu ling nian shao',
    translation: 'Noble youths of Wuling vied',
    isDuet: false,
    isBackground: false,
  },
]

async function waitForCondition(check: () => boolean, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check())
      return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('condition timed out')
}

describe('moreControlsMenu 二阶弹簧控制菜单', () => {
  const origAnimate = Element.prototype.animate
  const origClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

  afterEach(() => {
    document.body.innerHTML = ''
    if (origAnimate)
      Element.prototype.animate = origAnimate
    if (origClipboardDescriptor)
      Object.defineProperty(navigator, 'clipboard', origClipboardDescriptor)
    vi.restoreAllMocks()
  })

  it('在没有外层 LazyMotion 时点击也能完整展开到可见状态，并支持开关、复制与外部点击收起', async () => {
    // @ts-expect-error happy-dom 的 WAAPI cancel() 会抛未捕获异常，测试走 Motion JS 动画驱动
    delete Element.prototype.animate

    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    const setShowLyricMoments = vi.fn()
    const setShowLyricEffects = vi.fn()
    const setHdr = vi.fn()

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    try {
      flushSync(() => {
        root.render(
          React.createElement(NextIntlClientProvider, {
            locale: 'zh',
            messages: zhMessages,
            children: React.createElement(MoreControlsMenu, {
              showLyricMoments: false,
              setShowLyricMoments,
              showLyricEffects: true,
              setShowLyricEffects,
              hdr: false,
              setHdr,
              hdrDisplay: true,
              currentTrack: sampleTrack,
              lyricLines: sampleLines,
            }),
          }),
        )
      })

      const trigger = container.querySelector('button[aria-label="更多控制"]') as HTMLButtonElement | null
      expect(trigger).not.toBeNull()
      expect(trigger?.getAttribute('aria-expanded')).toBe('false')
      expect(trigger?.getAttribute('aria-haspopup')).toBe('true')
      expect(container.querySelector('[role="group"]')).toBeNull()

      flushSync(() => {
        trigger!.click()
      })

      expect(trigger?.getAttribute('aria-expanded')).toBe('true')
      const menu = container.querySelector('[role="group"]') as HTMLElement | null
      expect(menu).not.toBeNull()

      // 核心回归断言：包裹 LazyMotion 后 <m.div> 必须被动画驱动至可见，而不是卡在 opacity: 0
      await waitForCondition(() => Number.parseFloat(menu?.style.opacity || '0') > 0.9)
      expect(Number.parseFloat(menu!.style.opacity)).toBeGreaterThan(0.9)

      const momentsBtn = menu!.querySelector('button[aria-label="评论与旁白"]') as HTMLButtonElement | null
      const effectsBtn = menu!.querySelector('button[aria-label="歌词特效"]') as HTMLButtonElement | null
      const copyBtn = menu!.querySelector('button[aria-label="复制歌词"]') as HTMLButtonElement | null
      expect(momentsBtn).not.toBeNull()
      expect(effectsBtn).not.toBeNull()
      expect(copyBtn).not.toBeNull()

      momentsBtn!.click()
      effectsBtn!.click()
      expect(setShowLyricMoments).toHaveBeenCalledWith(true)
      expect(setShowLyricEffects).toHaveBeenCalledWith(false)

      await copyBtn!.click()
      await waitForCondition(() => writeText.mock.calls.length === 1)
      expect(writeText).toHaveBeenCalledWith('琵琶行 - 白居易\n\n五陵年少争缠头\nwu ling nian shao\nNoble youths of Wuling vied')

      // 点击菜单外部收起
      flushSync(() => {
        document.body.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }))
      })
      expect(trigger?.getAttribute('aria-expanded')).toBe('false')
    }
    finally {
      flushSync(() => root.unmount())
      container.remove()
    }
  })
})
