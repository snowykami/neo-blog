import type { MusicTrack } from '@/models/music'
import type { SiteInfo } from '@/utils/common/siteinfo'
import { NextIntlClientProvider } from 'next-intl'
import * as React from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_LYRICS } from '@/lib/lyrics/types'
import zhMessages from '@/locales/zh.json'
import { fallbackSiteInfo } from '@/utils/common/siteinfo'

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ref, ...props }: React.ComponentProps<'a'>) =>
    React.createElement('a', { ...props, href: String(href), ref }, children),
  usePathname: () => '/',
}))

const testSiteInfo: SiteInfo = {
  ...fallbackSiteInfo,
  metadata: { ...fallbackSiteInfo.metadata, name: 'Snowykami\'s Blog' },
  island: {
    ...fallbackSiteInfo.island!,
    enabled: true,
    music: false,
    network: false,
    greeting: false,
    holiday: false,
  },
}

describe('topbarIsland 站名与胶囊互斥渲染', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('在 React Activity 隐藏期间状态切换并重新可见后，站名与胶囊不会同时残留并排显示', async () => {
    // happy-dom 的 Web Animations cancel() 会抛未捕获的 AbortError，测试中走 motion 的 JS 动画驱动
    const origAnimate = Element.prototype.animate
    // @ts-expect-error 测试环境屏蔽不完整的 WAAPI
    delete Element.prototype.animate

    vi.resetModules()
    const [{ SiteInfoProvider }, store, { TopbarIsland }] = await Promise.all([
      import('@/contexts/site-info-context'),
      import('@/contexts/topbar-island'),
      import('./topbar-island'),
    ])

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    const renderWithMode = (mode: 'visible' | 'hidden') => {
      flushSync(() => {
        root.render(
          React.createElement(React.Activity, {
            mode,
            children: React.createElement(NextIntlClientProvider, {
              locale: 'zh',
              messages: zhMessages,
              children: React.createElement(SiteInfoProvider, {
                initialData: testSiteInfo,
                children: React.createElement(TopbarIsland),
              }),
            }),
          }),
        )
      })
    }

    try {
      // 1. 初始可见：只显示站名
      renderWithMode('visible')
      await new Promise(resolve => setTimeout(resolve, 60))
      expect(container.querySelector('[data-island-site]')).not.toBeNull()
      expect(container.querySelector('[data-island-capsule]')).toBeNull()

      // 2. 模拟切去后台/播放器：Activity 置为 hidden，期间全局活动登记
      renderWithMode('hidden')
      const dispose = store.showIslandActivity({
        id: 'test-activity',
        feature: 'reading',
        priority: 50,
        label: '阅读中',
        compact: React.createElement('span', null, '阅读进度 50%'),
      })
      await new Promise(resolve => setTimeout(resolve, 60))

      // 3. 切回前台：Activity 恢复 visible，应当只存在胶囊，站名不应残留并排
      renderWithMode('visible')
      expect(container.querySelector('[data-island-capsule]')).not.toBeNull()
      expect(container.querySelector('[data-island-site]')).toBeNull()

      // 4. 反向：胶囊在场时切走隐藏并撤下活动，再切回前台，应当只存在站名
      renderWithMode('hidden')
      dispose()
      await new Promise(resolve => setTimeout(resolve, 60))
      renderWithMode('visible')
      expect(container.querySelector('[data-island-site]')).not.toBeNull()
      expect(container.querySelector('[data-island-capsule]')).toBeNull()
    }
    finally {
      flushSync(() => root.unmount())
      container.remove()
      if (origAnimate)
        Element.prototype.animate = origAnimate
    }
  })
})

describe('musicIsland 按需加载', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    localStorage.clear()
    vi.restoreAllMocks()
    vi.doUnmock('./music-island-compact')
    vi.doUnmock('@/components/common/mini-player')
    vi.doUnmock('@/api/music')
    vi.doUnmock('@/contexts/song-lyrics')
    vi.doUnmock('@/contexts/song-chorus')
    vi.doUnmock('@/contexts/song-meta-translations')
    vi.doUnmock('@/contexts/lyric-annotations')
    vi.doUnmock('@/lib/lyrics/rhythm/source')
  })

  it('仅恢复曲目但未开始播放时不加载胶囊与迷你播放器模块，开始播放后才按需加载', async () => {
    const origAnimate = Element.prototype.animate
    // @ts-expect-error 测试环境屏蔽不完整的 WAAPI
    delete Element.prototype.animate

    vi.resetModules()
    const compactFactory = vi.fn(() => ({ MusicCompact: () => null }))
    const miniPlayerFactory = vi.fn(() => ({ MiniPlayer: () => null }))
    vi.doMock('./music-island-compact', compactFactory)
    vi.doMock('@/components/common/mini-player', miniPlayerFactory)
    vi.doMock('@/api/music', () => ({
      fetchSongAudioURL: vi.fn(() => Promise.resolve('')),
      fetchSongHotComment: vi.fn(() => Promise.resolve(null)),
      fetchSongChorus: vi.fn(() => Promise.resolve(null)),
      fetchSongTranslationMeta: vi.fn(() => Promise.resolve(null)),
      fetchLyricSingers: vi.fn(() => Promise.resolve(null)),
      fetchLyricPronunciations: vi.fn(() => Promise.resolve(null)),
      fetchLyricTranslations: vi.fn(() => Promise.resolve(null)),
    }))
    vi.doMock('@/lib/lyrics/rhythm/source', () => ({ requestRhythm: vi.fn() }))
    vi.doMock('@/contexts/song-chorus', () => ({ useSongChorus: () => [] }))
    vi.doMock('@/contexts/song-meta-translations', () => ({ useCachedSongMetaTranslation: () => null }))
    vi.doMock('@/contexts/song-lyrics', () => {
      const empty = { lyrics: EMPTY_LYRICS, candidates: [], kind: null, pending: false, status: 'none', siteKind: null, isSiteVersion: true }
      return { refreshSongLyrics: vi.fn(), useResolvedSongLyrics: () => empty }
    })
    vi.doMock('@/contexts/lyric-annotations', () => ({
      requestLyricAnnotations: vi.fn(),
      useLyricAnnotations: () => null,
      useLyricAnnotationsGenerating: () => false,
    }))

    const [
      { SiteInfoProvider },
      { MusicProvider, useMusicActions },
      { MusicIsland },
    ] = await Promise.all([
      import('@/contexts/site-info-context'),
      import('@/contexts/music-context'),
      import('./music-island'),
    ])

    let actions!: ReturnType<typeof useMusicActions>
    function Probe() {
      actions = useMusicActions()
      return null
    }

    const musicIslandSettings = {
      ...testSiteInfo.island!,
      enabled: true,
      music: true,
    }
    const musicSiteInfo: SiteInfo = {
      ...testSiteInfo,
      island: musicIslandSettings,
    }
    const sampleTrack: MusicTrack = {
      id: 42,
      name: '测试歌曲',
      artists: ['测试歌手'],
      album: '测试专辑',
      albumPic: '',
      audio: '/api/v1/music/song/42/audio',
      lyric: '',
      link: '',
      aliases: [],
    }

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    try {
      flushSync(() => {
        root.render(
          React.createElement(NextIntlClientProvider, {
            locale: 'zh',
            messages: zhMessages,
            children: React.createElement(SiteInfoProvider, {
              initialData: musicSiteInfo,
              children: React.createElement(MusicProvider, null, [
                React.createElement(Probe, { key: 'probe' }),
                React.createElement(MusicIsland, { key: 'island', settings: musicIslandSettings }),
              ]),
            }),
          }),
        )
      })
      await new Promise(resolve => setTimeout(resolve, 60))

      // 仅恢复当前曲目但不播放：不应触发重模块加载
      flushSync(() => {
        actions.replacePlaylist([sampleTrack], 0)
      })
      await new Promise(resolve => setTimeout(resolve, 60))
      expect(compactFactory).not.toHaveBeenCalled()
      expect(miniPlayerFactory).not.toHaveBeenCalled()

      // 开始播放后：触发 music-island-compact 与 mini-player 按需加载
      const audio = actions.getAudio()
      expect(audio).not.toBeNull()
      flushSync(() => {
        audio!.dispatchEvent(new Event('play'))
      })
      await new Promise(resolve => setTimeout(resolve, 60))
      expect(compactFactory).toHaveBeenCalledTimes(1)
      expect(miniPlayerFactory).toHaveBeenCalledTimes(1)
    }
    finally {
      flushSync(() => root.unmount())
      container.remove()
      if (origAnimate)
        Element.prototype.animate = origAnimate
    }
  })
})
