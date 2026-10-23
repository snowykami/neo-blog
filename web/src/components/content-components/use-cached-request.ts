'use client'

import { useEffect, useState } from 'react'

// 同一页面内相同 key 的请求共用结果（例如同一仓库出现多次、编辑器中反复重渲染）；失败的请求不缓存
const requestCache = new Map<string, Promise<unknown>>()

export type CachedRequestState<T> = { status: 'loading' } | { status: 'success', data: T } | { status: 'error', error: unknown }

export function useCachedRequest<T>(key: string | null, fetcher: () => Promise<T>): CachedRequestState<T> {
  const [state, setState] = useState<{ key: string | null, value: CachedRequestState<T> }>({ key, value: { status: 'loading' } })

  useEffect(() => {
    if (!key)
      return
    let cancelled = false
    let promise = requestCache.get(key) as Promise<T> | undefined
    if (!promise) {
      promise = fetcher()
      requestCache.set(key, promise)
      promise.catch(() => requestCache.delete(key))
    }
    promise.then(
      data => !cancelled && setState({ key, value: { status: 'success', data } }),
      error => !cancelled && setState({ key, value: { status: 'error', error } }),
    )
    return () => {
      cancelled = true
    }
    // fetcher 由 key 唯一确定，只在 key 变化时请求
  }, [key])

  // key 变化后、新结果返回前视为加载中
  return state.key === key ? state.value : { status: 'loading' }
}
