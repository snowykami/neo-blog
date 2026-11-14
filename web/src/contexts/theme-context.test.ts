import type { ThemeDefinition } from '@/themes/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let mockActiveTheme: ThemeDefinition | null = null
const loadEffectStyles = vi.fn()

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ user: null }),
}))

vi.mock('@/themes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/themes')>()
  return {
    ...actual,
    resolveActiveTheme: () => mockActiveTheme,
  }
})

function makeTheme(effect?: ThemeDefinition['effect']): ThemeDefinition {
  return {
    id: effect ? `theme-${effect}` : 'theme-plain',
    tokens: { hue: 340 },
    ...(effect ? { effect } : {}),
  }
}

describe('theme-context 动效样式按需加载', () => {
  let host: HTMLDivElement
  let unmountCurrent: (() => void) | null = null

  beforeEach(() => {
    vi.resetModules()
    loadEffectStyles.mockClear()
    vi.doMock('@/themes/effect-styles', () => {
      loadEffectStyles()
      return {}
    })
    mockActiveTheme = null
    localStorage.clear()
    document.cookie = ''
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-theme-effect')
    document.documentElement.removeAttribute('data-theme-mode')
    host = document.createElement('div')
    document.body.appendChild(host)
  })

  afterEach(() => {
    if (unmountCurrent) {
      unmountCurrent()
      unmountCurrent = null
    }
    host.remove()
  })

  async function mountProvider(initialTheme: ThemeDefinition | null) {
    if (unmountCurrent) {
      unmountCurrent()
      unmountCurrent = null
    }
    const [React, { createRoot }, { ThemeProvider, useTheme }] = await Promise.all([
      import('react'),
      import('react-dom/client'),
      import('./theme-context'),
    ])
    let api: ReturnType<typeof useTheme> | null = null
    function Probe() {
      api = useTheme()
      return null
    }
    const root = createRoot(host)
    unmountCurrent = () => {
      React.act(() => {
        root.unmount()
      })
    }
    await React.act(async () => {
      root.render(
        React.createElement(ThemeProvider, {
          theme: initialTheme,
          children: React.createElement(Probe),
        }),
      )
    })
    await vi.dynamicImportSettled()
    return {
      act: React.act,
      getApi: () => api!,
    }
  }

  it('无主题或未配置 effect 时不加载动效样式', async () => {
    await mountProvider(null)
    expect(loadEffectStyles).not.toHaveBeenCalled()

    vi.resetModules()
    vi.doMock('@/themes/effect-styles', () => {
      loadEffectStyles()
      return {}
    })
    mockActiveTheme = makeTheme(undefined)
    await mountProvider(mockActiveTheme)
    expect(loadEffectStyles).not.toHaveBeenCalled()
  })

  it('用户关闭主题偏好时首屏不加载动效样式，重新开启后按需加载', async () => {
    const sakura = makeTheme('sakura')
    mockActiveTheme = sakura
    localStorage.setItem('theme-pack', 'off')

    const { act, getApi } = await mountProvider(sakura)
    expect(loadEffectStyles).not.toHaveBeenCalled()
    expect(getApi().enabled).toBe(false)
    expect(document.documentElement.getAttribute('data-theme-effect')).toBeNull()

    await act(async () => {
      getApi().setEnabled(true)
    })
    await vi.dynamicImportSettled()
    expect(loadEffectStyles).toHaveBeenCalledTimes(1)
    expect(getApi().enabled).toBe(true)
    expect(document.documentElement.getAttribute('data-theme-effect')).toBe('sakura')
  })

  it('启用带 effect 的主题时自动加载动效样式且幂等不重复触发', async () => {
    const flicker = makeTheme('flicker')
    mockActiveTheme = flicker

    const { act, getApi } = await mountProvider(flicker)
    expect(loadEffectStyles).toHaveBeenCalledTimes(1)
    expect(document.documentElement.getAttribute('data-theme-effect')).toBe('flicker')

    await act(async () => {
      getApi().refreshTheme()
      getApi().setEnabled(true)
    })
    await vi.dynamicImportSettled()
    expect(loadEffectStyles).toHaveBeenCalledTimes(1)
  })
})
