import { beforeEach, describe, expect, it, vi } from 'vitest'

const captured: Record<string, any>[] = []
vi.mock('@sentry/browser', () => ({
  captureEvent: (event: Record<string, any>) => {
    captured.push(event)
    return 'id'
  },
  addEventProcessor: () => {},
  getIsolationScope: () => ({ getScopeData: () => ({ breadcrumbs: [{ timestamp: 1, category: 'ui.click', message: 'button' }] }) }),
}))

const KEY = 'nb_page_alive'

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}

async function start() {
  vi.resetModules()
  const { startCrashDetector } = await import('./crash')
  return startCrashDetector()
}

describe('startCrashDetector', () => {
  beforeEach(() => {
    captured.length = 0
    sessionStorage.clear()
    setVisibility('visible')
  })

  it('上一次没有正常离开时补报：在前台为崩溃，在后台为被系统回收', async () => {
    const previous = { url: 'http://x/p/a', startedAt: 1000, beatAt: 41000, hidden: false, crumbs: [{ category: 'navigation' }], contexts: { music: { track_id: 1 } } }
    sessionStorage.setItem(KEY, JSON.stringify(previous))
    const stop = await start()
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({ level: 'fatal', tags: { kind: 'crash' }, request: { url: 'http://x/p/a' }, contexts: { music: { track_id: 1 }, crash: { uptime_s: 40, hidden: false } } })
    stop()

    captured.length = 0
    sessionStorage.setItem(KEY, JSON.stringify({ ...previous, hidden: true }))
    ;(await start())()
    expect(captured[0]).toMatchObject({ level: 'warning', tags: { kind: 'discarded' } })
  })

  it('正常离开后不再写回状态（pagehide 之后的 visibilitychange 不算），下次打开不补报', async () => {
    const stop = await start()
    expect(JSON.parse(sessionStorage.getItem(KEY)!).crumbs).toHaveLength(1)
    window.dispatchEvent(new Event('pagehide'))
    setVisibility('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(sessionStorage.getItem(KEY)).toBeNull()
    stop()
    ;(await start())()
    expect(captured).toHaveLength(0)
  })
})
