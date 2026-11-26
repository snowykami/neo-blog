import type { SiteInfo } from '@/utils/common/siteinfo'
import { NextIntlClientProvider } from 'next-intl'
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import zhMessages from '@/locales/zh.json'
import { fallbackSiteInfo } from '@/utils/common/siteinfo'

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children }: { children: unknown }) => children,
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe('music-context 壳核分离与零主动加载', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    localStorage.clear()
    vi.restoreAllMocks()
    vi.doUnmock('@/contexts/music-runtime-controller')
    vi.doUnmock('@/components/common/music-player')
    vi.doUnmock('@/components/common/mini-player')
    vi.doUnmock('@/components/common/desktop-island-bridge')
  })

  it('无持久化会话且未交互时零下载零建 <audio>；悬停仅预热运行时不拉歌单不写 localStorage，点击同一按钮无缝打开面板并同步歌单', async () => {
    vi.resetModules()

    const runtimeLoader = vi.fn()
    const runtimeMount = vi.fn()
    const playerLoader = vi.fn()
    const playerMount = vi.fn()
    const miniPlayerLoader = vi.fn()
    const miniPlayerMount = vi.fn()
    const bridgeLoader = vi.fn()

    vi.doMock('@/contexts/music-runtime-controller', () => {
      runtimeLoader()
      return {
        MusicRuntimeController: () => {
          runtimeMount()
          return null
        },
      }
    })
    vi.doMock('@/components/common/music-player', () => {
      playerLoader()
      return {
        MusicPlayer: () => {
          playerMount()
          return React.createElement('div', { 'data-active-music-player': '' })
        },
      }
    })
    vi.doMock('@/components/common/mini-player', () => {
      miniPlayerLoader()
      return {
        MiniPlayer: () => {
          miniPlayerMount()
          return React.createElement('div', { 'data-active-mini-player': '' })
        },
      }
    })
    vi.doMock('@/components/common/desktop-island-bridge', () => {
      bridgeLoader()
      return { DesktopIslandBridge: () => null }
    })

    const [
      { SiteInfoProvider },
      { hasPersistedMusicSession, MusicProvider, resetMusicSessionForTests, useMusicActions, useMusicPlaylistSyncActive, useMusicRuntimeActive },
      { FloatingWidgets },
    ] = await Promise.all([
      import('@/contexts/site-info-context'),
      import('@/contexts/music-context'),
      import('./main-floating-widgets'),
    ])

    let getAudioFn!: () => HTMLAudioElement | null
    let isActive = false
    let isPlaylistSyncActive = false
    function Probe() {
      getAudioFn = useMusicActions().getAudio
      isActive = useMusicRuntimeActive()
      isPlaylistSyncActive = useMusicPlaylistSyncActive()
      return null
    }

    const siteInfo: SiteInfo = {
      ...fallbackSiteInfo,
      musicEnabled: true,
      enableThirdPartyScript: false,
    }

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    try {
      vi.useFakeTimers()
      await act(async () => {
        root.render(
          React.createElement(NextIntlClientProvider, {
            locale: 'zh',
            messages: zhMessages,
            children: React.createElement(SiteInfoProvider, {
              initialData: siteInfo,
              children: React.createElement(MusicProvider, {
                musicEnabled: true,
                children: [
                  React.createElement(Probe, { key: 'probe' }),
                  React.createElement(FloatingWidgets, { key: 'widgets' }),
                ],
              }),
            }),
          }),
        )
      })

      // 推进过空闲挂载阈值（1.2s ~ 3s），验证静默访客仍不加载任何重模块
      await act(async () => {
        vi.advanceTimersByTime(3500)
      })
      vi.useRealTimers()
      await new Promise(resolve => setTimeout(resolve, 30))

      expect(isActive).toBe(false)
      expect(isPlaylistSyncActive).toBe(false)
      expect(getAudioFn()).toBeNull()
      expect(runtimeLoader).not.toHaveBeenCalled()
      expect(playerLoader).not.toHaveBeenCalled()
      expect(miniPlayerLoader).not.toHaveBeenCalled()
      expect(bridgeLoader).not.toHaveBeenCalled()

      // 1. 悬停悬浮球：激活运行时与预热面板 chunk，但不挂载 MusicPlayer（不拉歌单）、不污染 localStorage、不重建按钮节点
      const triggerBtn = container.querySelector<HTMLButtonElement>(
        `button[aria-label="${zhMessages.MusicPlayer.floating_player}"]`,
      )
      expect(triggerBtn).not.toBeNull()

      await act(async () => {
        triggerBtn!.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
      })
      await vi.waitFor(() => {
        expect(isActive).toBe(true)
        expect(runtimeLoader).toHaveBeenCalledTimes(1)
        expect(runtimeMount).toHaveBeenCalledTimes(1)
        expect(playerLoader).toHaveBeenCalledTimes(1)
        expect(miniPlayerLoader).toHaveBeenCalledTimes(1)
      })
      expect(triggerBtn!.isConnected).toBe(true)
      expect(isPlaylistSyncActive).toBe(false)
      expect(hasPersistedMusicSession()).toBe(false)
      expect(playerMount).not.toHaveBeenCalled()
      expect(miniPlayerMount).not.toHaveBeenCalled()
      expect(bridgeLoader).not.toHaveBeenCalled()
      expect(localStorage.getItem('music-current-track-id')).toBeNull()
      expect(localStorage.getItem('music-current-index')).toBeNull()

      // 2. 点击同一个持久按钮节点：W3C click 不丢失，同步挂载歌单加载器并打开 MiniPlayer 弹层
      await act(async () => {
        triggerBtn!.click()
      })
      await vi.waitFor(() => {
        expect(isPlaylistSyncActive).toBe(true)
        expect(playerMount).toHaveBeenCalledTimes(1)
        expect(miniPlayerMount).toHaveBeenCalledTimes(1)
        expect(container.querySelector('[data-active-music-player]')).not.toBeNull()
        expect(document.querySelector('[data-active-mini-player]')).not.toBeNull()
      })
      expect(triggerBtn!.isConnected).toBe(true)
    }
    finally {
      vi.useRealTimers()
      await act(async () => root.unmount())
      resetMusicSessionForTests()
      container.remove()
    }
  })

  it('本地存在断点续播会话（music-current-track-id）时自动激活 MusicRuntimeController 与歌单同步', async () => {
    vi.resetModules()
    localStorage.setItem('music-current-track-id', '42')

    const runtimeLoader = vi.fn()
    const runtimeMount = vi.fn()
    vi.doMock('@/contexts/music-runtime-controller', () => {
      runtimeLoader()
      return {
        MusicRuntimeController: () => {
          runtimeMount()
          return null
        },
      }
    })

    const { MusicProvider, resetMusicSessionForTests, useMusicPlaylistSyncActive, useMusicRuntimeActive } = await import('@/contexts/music-context')

    let isActive = false
    let isPlaylistSync = false
    function Probe() {
      isActive = useMusicRuntimeActive()
      isPlaylistSync = useMusicPlaylistSyncActive()
      return null
    }

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(
          React.createElement(MusicProvider, {
            musicEnabled: true,
            children: React.createElement(Probe),
          }),
        )
      })
      await vi.waitFor(() => {
        expect(isActive).toBe(true)
        expect(isPlaylistSync).toBe(true)
        expect(runtimeLoader).toHaveBeenCalledTimes(1)
        expect(runtimeMount).toHaveBeenCalledTimes(1)
      })
    }
    finally {
      await act(async () => root.unmount())
      resetMusicSessionForTests()
      container.remove()
    }
  })

  it('冷启动首次点击文章内嵌歌曲（控制器 chunk 尚未挂载完成前）立即遵循本地保存的静音与音量偏好', async () => {
    vi.resetModules()
    localStorage.setItem('music-muted', 'true')
    localStorage.setItem('music-volume', '0.15')

    vi.doMock('@/contexts/music-runtime-controller', () => ({
      MusicRuntimeController: () => null,
    }))

    const { MusicProvider, resetMusicSessionForTests, useMusicActions, useMusicPlaylistSyncActive } = await import('@/contexts/music-context')

    let actions!: ReturnType<typeof useMusicActions>
    let isPlaylistSync = false
    function Probe() {
      actions = useMusicActions()
      isPlaylistSync = useMusicPlaylistSyncActive()
      return null
    }

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(
          React.createElement(MusicProvider, {
            musicEnabled: true,
            children: React.createElement(Probe),
          }),
        )
      })

      await act(async () => {
        actions.playSong({
          id: 99,
          name: 'Quiet Song',
          artists: ['Artist'],
          album: 'Album',
          albumPic: '',
          audio: 'https://example.com/quiet.mp3',
          lyric: '',
          link: '',
          aliases: [],
        })
      })

      const audio = actions.getAudio()
      expect(audio).not.toBeNull()
      expect(audio!.muted).toBe(true)
      expect(audio!.volume).toBeCloseTo(0.15, 5)
      expect(isPlaylistSync).toBe(true)
    }
    finally {
      await act(async () => root.unmount())
      resetMusicSessionForTests()
      container.remove()
    }
  })
})
