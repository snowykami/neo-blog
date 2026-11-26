/**
 * 最近访问文章客户端内存 LRU 队列（首页始终在路由上层独立保活，不参与本队列淘汰）：
 *
 * 背景：
 * Next.js 16.4 开启 `cacheComponents: true` 后，`OuterLayoutRouter`（`bfcache-state-manager.js`）
 * 在路由树的每一层按固定上限保留最近访问段，并将其余非当前段包裹在 `<Activity mode="hidden">`（`display: none`）中。
 * - 在 `(main)` 层：首页（`__PAGE__`）与文章路由段（`p`）分属兄弟槽位，连续浏览任意多篇文章都不会淘汰首页；
 * - 在 `p/[id]` 层：多个隐藏文章实例同时驻留于文档树内，若不主动裁剪，长图已解码位图、代码块高亮 DOM 节点、
 *   正文组件岛 Portal 与已展开的评论区树会持续占用渲染器内存。
 *
 * 策略：
 * - 维护容量为 `DEFAULT_POST_MEMORY_LRU_CAPACITY`（默认 2 篇，位于 2~4 篇窗口内）的最近访问文章队列；
 * - 当前处于 `visible` 活跃态的文章始终受保护不可淘汰；
 * - 当某篇已隐藏（非活跃）的文章滑出最近窗口时，`isRetained(postId)` 变为 `false`，通知 `<PostHeavySubtree>`
 *   主动卸载正文多媒体/代码高亮、组件岛、目录与评论区等重子树，仅保留带原高度占位的轻外壳；
 * - 用户再次切回该文章时，`useLayoutEffect` 在浏览器绘制前同步重新激活并挂载正文，零白屏闪烁。
 */

export const DEFAULT_POST_MEMORY_LRU_CAPACITY = 2

export interface PostMemoryLru {
  readonly capacity: number
  /** 标记文章进入可见活跃态，置于最近访问队首并裁剪超出窗口的非活跃文章 */
  activate: (postId: number) => void
  /** 标记文章离开可见态（进入 Activity hidden 或卸载），并裁剪超出窗口的非活跃文章 */
  deactivate: (postId: number) => void
  /** 当前文章是否应保留重子树（处于活跃态，或位于最近访问 LRU 窗口内） */
  isRetained: (postId: number) => boolean
  /** 当前文章是否处于可见活跃态 */
  isActive: (postId: number) => boolean
  /** 获取当前保留窗口中的文章 ID 顺序（队首为最近访问，仅供调试与单测断言） */
  getRetainedIds: () => readonly number[]
  /** 订阅状态变更（供 useSyncExternalStore 使用） */
  subscribe: (listener: () => void) => () => void
  /** 清空队列（仅供测试重置） */
  reset: () => void
}

export function createPostMemoryLru(capacity = DEFAULT_POST_MEMORY_LRU_CAPACITY): PostMemoryLru {
  const maxEntries = Math.max(1, Math.floor(capacity))
  let order: number[] = []
  const activeIds = new Set<number>()
  const listeners = new Set<() => void>()

  const notify = () => {
    listeners.forEach(listener => listener())
  }

  /** 从队尾向前移除超出容量且当前非活跃的文章 ID；返回是否有变更 */
  const evictOverflowInactive = (): boolean => {
    if (order.length <= maxEntries)
      return false
    let changed = false
    for (let i = order.length - 1; i >= 0 && order.length > maxEntries; i--) {
      const candidateId = order[i]
      if (!activeIds.has(candidateId)) {
        order.splice(i, 1)
        changed = true
      }
    }
    return changed
  }

  return {
    capacity: maxEntries,

    activate(postId: number) {
      if (!Number.isFinite(postId) || postId <= 0)
        return
      const wasActive = activeIds.has(postId)
      const prevIdx = order.indexOf(postId)
      activeIds.add(postId)

      let changed = !wasActive
      if (prevIdx !== 0) {
        if (prevIdx > 0)
          order.splice(prevIdx, 1)
        order = [postId, ...order]
        changed = true
      }
      if (evictOverflowInactive())
        changed = true
      if (changed)
        notify()
    },

    deactivate(postId: number) {
      if (!activeIds.delete(postId))
        return
      evictOverflowInactive()
      notify()
    },

    isRetained(postId: number): boolean {
      return activeIds.has(postId) || order.includes(postId)
    },

    isActive(postId: number): boolean {
      return activeIds.has(postId)
    },

    getRetainedIds(): readonly number[] {
      return order
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    reset() {
      order = []
      activeIds.clear()
      notify()
    },
  }
}

/** 全局文章内存 LRU 单例（默认保留最近 2 篇文章的重子树；首页不在本队列中，始终豁免保留） */
export const postMemoryLru = createPostMemoryLru(DEFAULT_POST_MEMORY_LRU_CAPACITY)
