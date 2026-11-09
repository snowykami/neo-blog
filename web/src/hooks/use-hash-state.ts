'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * 用 URL hash 表达「当前选中的标签」（/u/leo_dev#comments 这种），标签状态因此可以直接分享、
 * 也可以从别的页面带 hash 进来（评论区点作者 → 默认打开评论标签）
 *
 * - 首帧尽量从 location.hash 取值，服务端渲染时退回默认值
 * - 写入走 history.replaceState：切换标签不产生历史记录，也不触发锚点滚动
 * - 监听 hashchange：页面里的 #xxx 链接、浏览器前进后退都能同步
 *
 * tabs 必须是模块级常量，否则每次渲染都是新数组会让监听器反复重建
 */
export function useHashState<T extends string>(tabs: readonly T[], defaultValue: T) {
  const read = useCallback((): T => {
    if (typeof window === 'undefined')
      return defaultValue
    const raw = decodeURIComponent(window.location.hash.replace(/^#/, ''))
    return tabs.find(tab => tab === raw) ?? defaultValue
  }, [tabs, defaultValue])

  const [value, setValue] = useState<T>(read)

  useEffect(() => {
    const onHashChange = () => setValue(read())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [read])

  // 默认标签不带 hash，地址尽量干净：/u/leo_dev 就是文章，/u/leo_dev#comments 才是评论
  const set = useCallback((next: T) => {
    setValue(next)
    const { pathname, search } = window.location
    const hash = next === defaultValue ? '' : `#${next}`
    window.history.replaceState(window.history.state, '', `${pathname}${search}${hash}`)
  }, [defaultValue])

  return [value, set] as const
}
