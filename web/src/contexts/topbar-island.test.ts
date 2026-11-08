import { describe, expect, it, vi } from 'vitest'
import { fallbackSiteInfo } from '@/utils/common/siteinfo'

/**
 * 灵动岛提示仲裁的单测（规则见 contexts/topbar-island.ts 的文件头与 docs/island-arbitration-spec.md）。
 * 仓库是模块级单例，所以每个用例用 resetModules 拿一份全新的实例，互不影响。
 */
const settings = { ...fallbackSiteInfo.island!, enabled: true }

async function loadStore() {
  vi.resetModules()
  const store = await import('./topbar-island')
  store.setIslandSettings(settings)
  return store
}

type Store = Awaited<ReturnType<typeof loadStore>>

/** 当前该显示哪条提示的 key */
function shown(store: Store) {
  return store.pickIslandAlert(store.getIslandAlerts())?.key
}

function push(store: Store, key: string, extra: Partial<Parameters<Store['pushIslandAlert']>[0]> = {}) {
  return store.pushIslandAlert({ key, feature: 'feedback', text: key, ...extra })
}

describe('提示的层与排队', () => {
  it('反馈优先于消息：消息正在显示时反馈立刻上位，消息留在队首', async () => {
    const store = await loadStore()
    push(store, 'notice-a', { layer: 'notice' })
    expect(shown(store)).toBe('notice-a')

    push(store, 'like', { layer: 'feedback' })
    expect(shown(store)).toBe('like')

    // 视图层在显示项切换时上报打断：restart 的消息不累计已显示时长，只是被打断次数 +1
    store.interruptIslandAlert(store.getIslandAlerts().notice[0].seq, 800)
    expect(store.getIslandAlerts().notice[0].interrupts).toBe(1)
    expect(store.getIslandAlerts().notice[0].shownMs).toBe(0)

    // 反馈播完，消息自己回来（回到队首，从头计时）
    store.finishIslandAlert(store.getIslandAlerts().feedback[0].seq)
    expect(shown(store)).toBe('notice-a')
  })

  it('同层按到达顺序：两条反馈不会互相插队', async () => {
    const store = await loadStore()
    push(store, 'f1', { layer: 'feedback' })
    push(store, 'f2', { layer: 'feedback' })
    expect(shown(store)).toBe('f1')
    store.finishIslandAlert(store.getIslandAlerts().feedback[0].seq)
    expect(shown(store)).toBe('f2')
  })

  it('resume: drop 的被盖掉后不再出现', async () => {
    const store = await loadStore()
    push(store, 'music-track', { layer: 'notice', resume: 'drop' })
    push(store, 'like', { layer: 'feedback' })
    store.interruptIslandAlert(store.getIslandAlerts().notice[0].seq, 300)
    expect(store.getIslandAlerts().notice).toHaveLength(0)
    store.finishIslandAlert(store.getIslandAlerts().feedback[0].seq)
    expect(shown(store)).toBeUndefined()
  })

  it('resume: continue 累计已显示时长，接着播时扣减并保底最短可见时长', async () => {
    const store = await loadStore()
    push(store, 'greeting', { layer: 'notice', resume: 'continue', duration: 4000 })
    push(store, 'like', { layer: 'feedback' })
    store.interruptIslandAlert(store.getIslandAlerts().notice[0].seq, 1800)

    const notice = store.getIslandAlerts().notice[0]
    expect(notice.shownMs).toBe(1800)
    expect(store.alertDurationOf(notice, false)).toBe(2200)
    // 已经看掉大半时也不至于只剩几百毫秒
    expect(store.alertDurationOf({ ...notice, shownMs: 3900 }, false)).toBe(store.MIN_ALERT_VISIBLE_MS)
  })

  it('被打断超过上限后丢弃，避免一直被插队、永远播不完', async () => {
    const store = await loadStore()
    push(store, 'notice-a', { layer: 'notice' })
    for (let i = 0; i < store.MAX_ALERT_INTERRUPTS + 1; i++) {
      push(store, `like-${i}`, { layer: 'feedback' })
      store.interruptIslandAlert(store.getIslandAlerts().notice[0].seq, 100)
      store.finishIslandAlert(store.getIslandAlerts().feedback[0].seq)
    }
    expect(store.getIslandAlerts().notice).toHaveLength(0)
  })

  it('队列溢出丢队尾：正在显示的那条不受影响', async () => {
    const store = await loadStore()
    for (let i = 0; i < 6; i++)
      push(store, `notice-${i}`, { layer: 'notice' })
    const keys = store.getIslandAlerts().notice.map(alert => alert.key)
    expect(keys[0]).toBe('notice-0')
    expect(keys).toHaveLength(4)
    expect(keys).not.toContain('notice-5')
  })

  it('反馈队列更短：最多留两条', async () => {
    const store = await loadStore()
    for (let i = 0; i < 4; i++)
      push(store, `like-${i}`, { layer: 'feedback' })
    expect(store.getIslandAlerts().feedback).toHaveLength(2)
  })
})

describe('合并、结束与撤销', () => {
  it('同 key 合并成一条：计数加一、重新计时、不前移', async () => {
    const store = await loadStore()
    push(store, 'notice-a', { layer: 'notice' })
    push(store, 'like', { layer: 'feedback', countable: true })
    const first = store.getIslandAlerts().feedback[0].seq
    push(store, 'like', { layer: 'feedback', countable: true })

    const queue = store.getIslandAlerts().feedback
    expect(queue).toHaveLength(1)
    expect(queue[0].count).toBe(2)
    expect(queue[0].seq).not.toBe(first)
  })

  it('只有队首能结束，旧 seq 不会误删新提示', async () => {
    const store = await loadStore()
    push(store, 'like', { layer: 'feedback' })
    const stale = store.getIslandAlerts().feedback[0].seq
    push(store, 'like', { layer: 'feedback' }) // 合并，seq 变了
    store.finishIslandAlert(stale)
    expect(store.getIslandAlerts().feedback).toHaveLength(1)
    store.finishIslandAlert(store.getIslandAlerts().feedback[0].seq)
    expect(shown(store)).toBeUndefined()
  })

  it('dismiss 能撤掉任意层的任意一条（不论是否正在显示）', async () => {
    const store = await loadStore()
    push(store, 'notice-a', { layer: 'notice' })
    push(store, 'music-track', { layer: 'notice' })
    push(store, 'like', { layer: 'feedback' })
    store.dismissIslandAlert('music-track')
    expect(store.getIslandAlerts().notice.map(alert => alert.key)).toEqual(['notice-a'])
    store.dismissIslandAlert('notice-a')
    expect(store.getIslandAlerts().notice).toHaveLength(0)
  })
})

describe('面板展开与时长', () => {
  it('面板展开时反馈不入队（调用方回落 toast），消息仍然排队', async () => {
    const store = await loadStore()
    store.setIslandPanelOpen(true)
    expect(push(store, 'like', { layer: 'feedback' })).toBe(false)
    expect(store.getIslandAlerts().feedback).toHaveLength(0)

    expect(push(store, 'notice-a', { layer: 'notice' })).toBe(true)
    expect(store.getIslandAlerts().notice).toHaveLength(1)
  })

  it('场上有持续活动时消息类更短，反馈不受影响', async () => {
    const store = await loadStore()
    push(store, 'notice-a', { layer: 'notice', duration: 4000 })
    push(store, 'like', { layer: 'feedback' })
    const [notice, feedback] = [store.getIslandAlerts().notice[0], store.getIslandAlerts().feedback[0]]

    expect(store.alertDurationOf(notice, false)).toBe(4000)
    expect(store.alertDurationOf(notice, true)).toBe(store.NOTICE_WITH_ACTIVITY_MAX_MS)
    expect(store.alertDurationOf(feedback, true)).toBe(store.FEEDBACK_ALERT_MS)
  })

  it('开关关闭或顶栏未挂载时不接受提示（调用方回落 toast）', async () => {
    vi.resetModules()
    const store = await import('./topbar-island')
    expect(store.pushIslandAlert({ key: 'like', feature: 'feedback', layer: 'feedback', text: 'like' })).toBe(false)
    store.setIslandSettings({ ...settings, feedback: false })
    expect(store.pushIslandAlert({ key: 'like', feature: 'feedback', layer: 'feedback', text: 'like' })).toBe(false)
  })
})
