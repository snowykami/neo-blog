import * as React from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PostActivityTracker, PostHeavySubtree } from './post-activity-guard'
import { createPostMemoryLru, DEFAULT_POST_MEMORY_LRU_CAPACITY, postMemoryLru } from './post-memory-lru'

describe('createPostMemoryLru', () => {
  it('retains recently visited articles within window and evicts older inactive ones across 25+ navigations', () => {
    const lru = createPostMemoryLru(3)

    // 模拟连续阅读 25 篇文章（每次离开上一篇后进入下一篇）
    for (let id = 1; id <= 25; id++) {
      if (id > 1)
        lru.deactivate(id - 1)
      lru.activate(id)
    }

    expect(lru.getRetainedIds()).toEqual([25, 24, 23])
    expect(lru.isRetained(25)).toBe(true)
    expect(lru.isRetained(24)).toBe(true)
    expect(lru.isRetained(23)).toBe(true)
    expect(lru.isRetained(22)).toBe(false)
    expect(lru.isRetained(1)).toBe(false)
  })

  it('never evicts an article while it is currently active (visible)', () => {
    const lru = createPostMemoryLru(2)
    lru.activate(10)
    lru.deactivate(10)
    lru.activate(20)
    // 20 仍处于 active 状态，即使再激活 30，20 也受保护不被移除，而是淘汰非活跃的 10
    lru.activate(30)

    expect(lru.isRetained(30)).toBe(true)
    expect(lru.isRetained(20)).toBe(true)
    expect(lru.isRetained(10)).toBe(false)

    // 当 20 变为非活跃且再激活 40 时，20 滑出窗口被淘汰
    lru.deactivate(20)
    lru.deactivate(30)
    lru.activate(40)
    expect(lru.getRetainedIds()).toEqual([40, 30])
    expect(lru.isRetained(20)).toBe(false)
  })

  it('promotes a revisited article back to MRU head', () => {
    const lru = createPostMemoryLru(2)
    lru.activate(1)
    lru.deactivate(1)
    lru.activate(2)
    lru.deactivate(2)
    expect(lru.getRetainedIds()).toEqual([2, 1])

    // 重新切回文章 1，文章 1 升至队首；随后访问文章 3 时淘汰的是更久未访问的文章 2
    lru.activate(1)
    lru.deactivate(1)
    lru.activate(3)
    expect(lru.getRetainedIds()).toEqual([3, 1])
    expect(lru.isRetained(2)).toBe(false)
  })
})

describe('postActivityTracker + PostHeavySubtree under React <Activity>', () => {
  afterEach(() => {
    postMemoryLru.reset()
    window.location.hash = ''
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('unmounts heavy subtrees inside <Activity mode="hidden"> even when RSC child elements preserve referential identity, and cleans up subscriptions on deletion', async () => {
    expect(DEFAULT_POST_MEMORY_LRU_CAPACITY).toBeGreaterThanOrEqual(2)
    expect(DEFAULT_POST_MEMORY_LRU_CAPACITY).toBeLessThanOrEqual(4)

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const NavTickContext = React.createContext(0)

    function MockPost({ id }: { id: number }) {
      return React.createElement('section', { 'data-post-shell': id }, [
        React.createElement(PostActivityTracker, { key: 'tracker', postId: id }),
        React.createElement('h1', { key: 'title' }, `Title ${id}`),
        React.createElement(PostHeavySubtree, {
          key: 'body',
          postId: id,
          preserveHeight: true,
          children: React.createElement('article', { 'data-heavy-body': id }, [
            React.createElement('h2', { key: 'anchor', id: `sec-${id}` }, `Section ${id}`),
            `Heavy Content ${id}`,
          ]),
        }),
      ])
    }

    // 复刻 Next.js App Router BFCache (renderTree.data.rsc)：同一路由条目的 ReactElement 引用完全恒定，触发父级 Fiber bailout
    const cachedRscElements = new Map<number, React.ReactElement>()
    const getCachedRscElement = (id: number) => {
      let el = cachedRscElements.get(id)
      if (!el) {
        el = React.createElement(MockPost, { id })
        cachedRscElements.set(id, el)
      }
      return el
    }

    let navTick = 0
    const renderPosts = (activeId: number, mountedIds: number[]) => {
      navTick += 1
      flushSync(() => {
        root.render(
          React.createElement(
            NavTickContext.Provider,
            { value: navTick },
            mountedIds.map(id =>
              React.createElement(React.Activity, {
                key: id,
                mode: id === activeId ? 'visible' : 'hidden',
                children: getCachedRscElement(id),
              }),
            ),
          ),
        )
      })
    }

    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})

    try {
      // 1. 阅读文章 1 -> 文章 2（均在默认 2 篇窗口内，重子树全部保活）
      renderPosts(1, [1])
      expect(container.querySelector('[data-heavy-body="1"]')).not.toBeNull()

      renderPosts(2, [1, 2])
      await new Promise(resolve => setTimeout(resolve, 40))
      expect(container.querySelector('[data-heavy-body="2"]')).not.toBeNull()
      expect(container.querySelector('[data-heavy-body="1"]')).not.toBeNull()

      // 2. 继续阅读文章 3：尽管文章 1 的 RSC 元素引用恒定不变且处于 <Activity mode="hidden">，
      //    useInsertionEffect 仍能接收淘汰通知并在 OffscreenLane 卸载重子树，同时保留轻外壳标题与占位容器
      renderPosts(3, [1, 2, 3])
      await vi.waitFor(() => {
        expect(container.querySelector('[data-heavy-body="1"]')).toBeNull()
      })
      expect(container.querySelector('[data-heavy-body="3"]')).not.toBeNull()
      expect(container.querySelector('[data-heavy-body="2"]')).not.toBeNull()
      expect(container.querySelector('[data-post-shell="1"] h1')?.textContent).toBe('Title 1')
      expect(container.querySelector('[data-post-shell="1"] [data-post-lru-evicted]')).not.toBeNull()

      // 3. 通过带 #hash 的链接再次进入曾被淘汰的文章 1：同步恢复重子树并补齐锚点滚动，且将滑出窗口的隐藏文章 2 卸载
      scrollToSpy.mockClear()
      window.location.hash = '#sec-1'
      renderPosts(1, [1, 2, 3])
      await vi.waitFor(() => {
        expect(container.querySelector('[data-heavy-body="2"]')).toBeNull()
      })
      expect(container.querySelector('[data-heavy-body="1"]')).not.toBeNull()
      expect(container.querySelector('[data-heavy-body="3"]')).not.toBeNull()
      expect(scrollToSpy).toHaveBeenCalled()

      // 4. 继续访问文章 4 且 Next.js <Activity> BFCache 真正移除旧路由 2：
      //    最近窗口更新为 [4, 1]，隐藏态文章 3 滑出窗口并卸载重子树，被移除的路由 2 订阅正常清理不抛错
      renderPosts(4, [1, 3, 4])
      await vi.waitFor(() => {
        expect(container.querySelector('[data-heavy-body="3"]')).toBeNull()
      })
      expect(container.querySelector('[data-heavy-body="4"]')).not.toBeNull()
      expect(container.querySelector('[data-heavy-body="1"]')).not.toBeNull()
      expect(container.querySelector('[data-post-shell="2"]')).toBeNull()
    }
    finally {
      flushSync(() => root.unmount())
      container.remove()
    }
  })
})
