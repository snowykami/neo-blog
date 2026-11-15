import type { MusicLyricTranslationLangStatus } from '@/api/music'
import type { LyricLine, ResolvedLyrics } from '@/lib/lyrics/types'
import type { MusicTrack } from '@/models/music'
import { NextIntlClientProvider } from 'next-intl'
import * as React from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import zhMessages from '@/locales/zh.json'
import { MoreControlsMenu } from './music-page-controls'

const lyricTranslationActions = vi.hoisted(() => ({
  refreshTranslations: vi.fn(),
  requestLyricTranslationLanguages: vi.fn(),
}))

vi.mock('@/contexts/lyric-translations', () => ({
  refreshTranslations: lyricTranslationActions.refreshTranslations,
  requestLyricTranslationLanguages: lyricTranslationActions.requestLyricTranslationLanguages,
}))

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
  {
    start: 4200,
    end: 5500,
    words: [{ text: '和声伴唱', start: 4200, end: 5500 }],
    isDuet: false,
    isBackground: true,
  },
  {
    start: 6000,
    end: 9000,
    words: [{ text: '一曲红绡不知数', start: 6000, end: 9000 }],
    romanization: 'yi qu hong xiao',
    translation: 'Countless bolts of red silk for a song',
    isDuet: false,
    isBackground: false,
  },
]

function makeLyrics(lines: LyricLine[]): ResolvedLyrics {
  return {
    source: 'ttml-amll',
    wordTimed: true,
    instrumental: false,
    lines,
  }
}

async function waitForCondition(check: () => boolean, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check())
      return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('condition timed out')
}

async function copyLyricsWithOptions({
  lyrics = makeLyrics(sampleLines),
  showRomaji,
  showTranslation,
}: {
  lyrics?: ResolvedLyrics
  showRomaji: boolean
  showTranslation: boolean
}): Promise<string> {
  // @ts-expect-error happy-dom 的 WAAPI cancel() 会抛未捕获异常，测试走 Motion JS 动画驱动
  delete Element.prototype.animate

  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })

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
            setShowLyricMoments: vi.fn(),
            showLyricEffects: true,
            setShowLyricEffects: vi.fn(),
            showRomaji,
            showTranslation,
            hdr: false,
            setHdr: vi.fn(),
            hdrDisplay: true,
            currentTrack: sampleTrack,
            lyrics,
          }),
        }),
      )
    })

    const trigger = container.querySelector('button[aria-label="更多控制"]') as HTMLButtonElement | null
    flushSync(() => {
      trigger!.click()
    })

    const copyBtn = container.querySelector('button[aria-label="复制歌词"]') as HTMLButtonElement | null
    expect(copyBtn).not.toBeNull()

    copyBtn!.click()
    await waitForCondition(() => writeText.mock.calls.length === 1)
    return writeText.mock.calls[0][0] as string
  }
  finally {
    flushSync(() => root.unmount())
    container.remove()
  }
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
              showRomaji: true,
              showTranslation: true,
              hdr: false,
              setHdr,
              hdrDisplay: true,
              currentTrack: sampleTrack,
              lyrics: makeLyrics([sampleLines[0]]),
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

  it('复制歌词：默认仅歌词时单换行紧凑排版，且保留并括号包裹背景和声行', async () => {
    const linesWithBracketedBg: LyricLine[] = [
      ...sampleLines,
      {
        start: 9200,
        end: 9800,
        words: [{ text: '(ooh)', start: 9200, end: 9800 }],
        isDuet: false,
        isBackground: true,
      },
    ]
    const copied = await copyLyricsWithOptions({
      lyrics: makeLyrics(linesWithBracketedBg),
      showRomaji: false,
      showTranslation: false,
    })

    expect(copied).toBe([
      '琵琶行 - 白居易',
      '',
      '五陵年少争缠头',
      '(和声伴唱)',
      '一曲红绡不知数',
      '(ooh)',
    ].join('\n'))
  })

  it('复制歌词：歌曲本身无读音与翻译时即使开关启用也保持单换行紧凑排版', async () => {
    const plainLines: LyricLine[] = [
      {
        start: 1000,
        end: 3000,
        words: [{ text: '浔阳江头夜送客', start: 1000, end: 3000 }],
        isDuet: false,
        isBackground: false,
      },
      {
        start: 3500,
        end: 5500,
        words: [{ text: '枫叶荻花秋瑟瑟', start: 3500, end: 5500 }],
        isDuet: false,
        isBackground: false,
      },
    ]
    const copied = await copyLyricsWithOptions({
      lyrics: makeLyrics(plainLines),
      showRomaji: true,
      showTranslation: true,
    })

    expect(copied).toBe('琵琶行 - 白居易\n\n浔阳江头夜送客\n枫叶荻花秋瑟瑟')
  })

  it('复制歌词：仅开启读音时按两行一组排版，无读音的背景行优雅降级不产生多余空行', async () => {
    const copied = await copyLyricsWithOptions({
      showRomaji: true,
      showTranslation: false,
    })

    expect(copied).toBe([
      '琵琶行 - 白居易',
      '',
      '五陵年少争缠头\nwu ling nian shao',
      '',
      '(和声伴唱)',
      '',
      '一曲红绡不知数\nyi qu hong xiao',
    ].join('\n'))
  })

  it('复制歌词：仅开启翻译时按两行一组排版，无翻译的背景行优雅降级不产生多余空行', async () => {
    const copied = await copyLyricsWithOptions({
      showRomaji: false,
      showTranslation: true,
    })

    expect(copied).toBe([
      '琵琶行 - 白居易',
      '',
      '五陵年少争缠头\nNoble youths of Wuling vied',
      '',
      '(和声伴唱)',
      '',
      '一曲红绡不知数\nCountless bolts of red silk for a song',
    ].join('\n'))
  })

  it('复制歌词：同时开启读音与翻译时按三行一组排版，并完整保留背景人声行', async () => {
    const copied = await copyLyricsWithOptions({
      showRomaji: true,
      showTranslation: true,
    })

    expect(copied).toBe([
      '琵琶行 - 白居易',
      '',
      '五陵年少争缠头\nwu ling nian shao\nNoble youths of Wuling vied',
      '',
      '(和声伴唱)',
      '',
      '一曲红绡不知数\nyi qu hong xiao\nCountless bolts of red silk for a song',
    ].join('\n'))
  })

  it('翻译语言二级菜单：访客仅见已生成的或原生存在的译文语言，无触发入口', () => {
    // @ts-expect-error happy-dom 的 WAAPI cancel() 会抛未捕获异常，测试走 Motion JS 动画驱动
    delete Element.prototype.animate
    lyricTranslationActions.refreshTranslations.mockReset()
    lyricTranslationActions.requestLyricTranslationLanguages.mockReset()

    const jaLyrics = makeLyrics([
      {
        start: 1000,
        end: 3000,
        words: [{ text: '君の名前を呼んでいる', start: 1000, end: 3000 }],
        translation: '呼唤着你的名字',
        isDuet: false,
        isBackground: false,
      },
      {
        start: 3200,
        end: 5000,
        words: [{ text: '夜明けの空が染まるまで', start: 3200, end: 5000 }],
        translation: '直至破晓染红天际',
        isDuet: false,
        isBackground: false,
      },
    ])
    const statuses: MusicLyricTranslationLangStatus[] = [
      { lang: 'zh', hasAi: false, hasNative: true, generating: false, sameLanguage: false },
      { lang: 'en', hasAi: true, hasNative: false, generating: false, sameLanguage: false },
      { lang: 'ko', hasAi: false, hasNative: false, generating: false, sameLanguage: false },
      { lang: 'ja', hasAi: false, hasNative: false, generating: false, sameLanguage: true },
    ]
    const setTranslationLang = vi.fn()
    const setShowTranslation = vi.fn()

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
              setShowLyricMoments: vi.fn(),
              showLyricEffects: true,
              setShowLyricEffects: vi.fn(),
              showRomaji: false,
              showTranslation: true,
              setShowTranslation,
              translationLang: null,
              effectiveTranslationLang: 'zh',
              availableTranslationLangs: statuses,
              setTranslationLang,
              isAdmin: false,
              musicAiEnabled: true,
              hdr: false,
              setHdr: vi.fn(),
              hdrDisplay: true,
              currentTrack: sampleTrack,
              lyrics: jaLyrics,
            }),
          }),
        )
      })

      flushSync(() => {
        ;(container.querySelector('button[aria-label="更多控制"]') as HTMLButtonElement).click()
      })
      flushSync(() => {
        ;(container.querySelector('button[aria-label="翻译语言"]') as HTMLButtonElement).click()
      })

      expect(lyricTranslationActions.requestLyricTranslationLanguages).toHaveBeenCalledWith(sampleTrack.id, 'ttml-amll', true)

      const menu = container.querySelector('[role="menu"][aria-label="翻译语言"]')
      expect(menu).not.toBeNull()
      const menuText = menu?.textContent ?? ''
      expect(menuText).toContain('跟随站点语言')
      expect(menuText).toContain('内置')
      expect(menuText).toContain('AI')
      expect(menuText).not.toContain('AI 覆盖')
      expect(menuText).not.toContain('生成新翻译')
      const koLabel = new Intl.DisplayNames(['zh'], { type: 'language' }).of('ko') ?? 'ko'
      const enLabel = new Intl.DisplayNames(['zh'], { type: 'language' }).of('en') ?? 'en'
      expect(menuText).not.toContain(koLabel)
      expect(menuText).toContain(enLabel)

      const enButton = Array.from(menu!.querySelectorAll('button')).find(btn => btn.textContent?.includes(enLabel))
      expect(enButton).toBeDefined()
      flushSync(() => {
        enButton!.click()
      })

      expect(setTranslationLang).toHaveBeenCalledWith('en')
      expect(setShowTranslation).toHaveBeenCalledWith(true)
      expect(lyricTranslationActions.refreshTranslations).not.toHaveBeenCalled()
    }
    finally {
      flushSync(() => root.unmount())
      container.remove()
    }
  })

  it('翻译语言二级菜单：管理员可见 AI 覆盖、重新生成与未翻译语种，点击触发翻译任务', async () => {
    // @ts-expect-error happy-dom 的 WAAPI cancel() 会抛未捕获异常，测试走 Motion JS 动画驱动
    delete Element.prototype.animate
    lyricTranslationActions.refreshTranslations.mockReset()
    lyricTranslationActions.refreshTranslations.mockResolvedValue('started')
    lyricTranslationActions.requestLyricTranslationLanguages.mockReset()

    const jaLyrics = makeLyrics([
      {
        start: 1000,
        end: 3000,
        words: [{ text: '君の名前を呼んでいる', start: 1000, end: 3000 }],
        translation: '呼唤着你的名字',
        isDuet: false,
        isBackground: false,
      },
      {
        start: 3200,
        end: 5000,
        words: [{ text: '夜明けの空が染まるまで', start: 3200, end: 5000 }],
        translation: '直至破晓染红天际',
        isDuet: false,
        isBackground: false,
      },
    ])
    const statuses: MusicLyricTranslationLangStatus[] = [
      { lang: 'zh', hasAi: false, hasNative: true, generating: false, sameLanguage: false },
      { lang: 'en', hasAi: true, hasNative: false, generating: false, sameLanguage: false },
      { lang: 'ko', hasAi: false, hasNative: false, generating: false, sameLanguage: false },
      { lang: 'ja', hasAi: false, hasNative: false, generating: false, sameLanguage: true },
    ]
    const setTranslationLang = vi.fn()
    const setShowTranslation = vi.fn()

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
              setShowLyricMoments: vi.fn(),
              showLyricEffects: true,
              setShowLyricEffects: vi.fn(),
              showRomaji: false,
              showTranslation: true,
              setShowTranslation,
              translationLang: 'en',
              effectiveTranslationLang: 'en',
              availableTranslationLangs: statuses,
              setTranslationLang,
              isAdmin: true,
              musicAiEnabled: true,
              hdr: false,
              setHdr: vi.fn(),
              hdrDisplay: true,
              currentTrack: sampleTrack,
              lyrics: jaLyrics,
            }),
          }),
        )
      })

      flushSync(() => {
        ;(container.querySelector('button[aria-label="更多控制"]') as HTMLButtonElement).click()
      })
      flushSync(() => {
        ;(container.querySelector('button[aria-label="翻译语言"]') as HTMLButtonElement).click()
      })

      const menu = container.querySelector('[role="menu"][aria-label="翻译语言"]')
      expect(menu).not.toBeNull()
      const menuText = menu?.textContent ?? ''
      const koLabel = new Intl.DisplayNames(['zh'], { type: 'language' }).of('ko') ?? 'ko'
      const jaLabel = new Intl.DisplayNames(['zh'], { type: 'language' }).of('ja') ?? 'ja'
      expect(menuText).toContain('AI 覆盖')
      expect(menuText).toContain('生成新翻译')
      expect(menuText).toContain(koLabel)
      expect(menuText).not.toContain(jaLabel)
      expect(menu!.querySelector('button[aria-label="重新生成 AI 翻译"]')).not.toBeNull()

      const overrideBtn = Array.from(menu!.querySelectorAll('button')).find(btn => btn.textContent === 'AI 覆盖')
      expect(overrideBtn).toBeDefined()
      flushSync(() => {
        overrideBtn!.click()
      })
      await waitForCondition(() => lyricTranslationActions.refreshTranslations.mock.calls.length === 1)
      expect(setTranslationLang).toHaveBeenCalledWith('zh')
      expect(setShowTranslation).toHaveBeenCalledWith(true)
      expect(lyricTranslationActions.refreshTranslations).toHaveBeenCalledWith(sampleTrack.id, 'ttml-amll', 'zh')

      const koButton = Array.from(menu!.querySelectorAll('button')).find(btn => btn.textContent?.includes(koLabel))
      expect(koButton).toBeDefined()
      await waitForCondition(() => !koButton!.disabled)
      flushSync(() => {
        koButton!.click()
      })
      await waitForCondition(() => lyricTranslationActions.refreshTranslations.mock.calls.length === 2)
      expect(setTranslationLang).toHaveBeenCalledWith('ko')
      expect(lyricTranslationActions.refreshTranslations).toHaveBeenLastCalledWith(sampleTrack.id, 'ttml-amll', 'ko')
    }
    finally {
      flushSync(() => root.unmount())
      container.remove()
    }
  })
})
