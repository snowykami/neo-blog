'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import axiosClient from '@/api/client'
import { useAuth } from '@/contexts/auth-context'

/**
 * 后台页面的取数缓存（stale-while-revalidate）：回到刚看过的页面时先显示上次的数据，同时在后台重新取一次。
 *
 * - 缓存放在模块里，同一个标签页内跨页面共享；键为「当前用户 + key」，最多保留 MAX_ENTRIES 条（先进先出）
 * - 每次挂载、key 变化或被 Activity 重新显示时都会重新请求，缓存只负责「先有东西可看」，不会因此少取一次
 * - 任何写操作（经 axiosClient 发出的非 GET 请求，含登录、登出；占用编辑会话除外）发出与完成时都清空整个缓存：
 *   删除、编辑之后切到别的页面不会先闪出旧数据；当前页面照常自己刷新。写操作开始前已经发出的读请求，结果不再写回缓存
 * - 没有用 @snowykami/use-async-task 的共享状态：它按 taskKey 共享、保留数据，但缓存表不对外，无法在写操作、换账号时清空，
 *   cacheTime 内也不会重新请求
 */

type QueryKey = readonly unknown[]

const MAX_ENTRIES = 60
const cache = new Map<string, unknown>()
// 每次清空加一：请求开始时记下，结束时不一致就说明期间有写操作，结果不写回缓存
let generation = 0

function readCache<T>(key: string | null): T | undefined {
  return key === null ? undefined : cache.get(key) as T | undefined
}

function writeCache(key: string, data: unknown) {
  cache.delete(key)
  cache.set(key, data)
  while (cache.size > MAX_ENTRIES)
    cache.delete(cache.keys().next().value as string)
}

/** 清空全部后台取数缓存 */
export function clearConsoleQueryCache() {
  cache.clear()
  generation++
}

const READ_METHODS = new Set(['get', 'head', 'options'])
// 不改动内容的非 GET 请求：打开编辑器时占用编辑会话（POST .../edit-session），只是「谁在编辑」，列表不显示，不清缓存
const NON_CONTENT_WRITES = [/\/edit-session$/]
let interceptorInstalled = false

interface RequestLike { method?: string, url?: string }

function isContentWrite(config?: RequestLike) {
  if (READ_METHODS.has((config?.method ?? 'get').toLowerCase()))
    return false
  const path = (config?.url ?? '').split('?', 1)[0]
  return !NON_CONTENT_WRITES.some(pattern => pattern.test(path))
}

// 写操作发出与完成（无论成败）时各清空一次：完成后清空，覆盖写操作期间别处取回的旧数据
function installWriteInterceptor() {
  if (interceptorInstalled || typeof window === 'undefined')
    return
  interceptorInstalled = true
  axiosClient.interceptors.request.use((config) => {
    if (isContentWrite(config))
      clearConsoleQueryCache()
    return config
  })
  axiosClient.interceptors.response.use(
    (response) => {
      if (isContentWrite(response.config))
        clearConsoleQueryCache()
      return response
    },
    (error: { config?: RequestLike }) => {
      if (isContentWrite(error?.config))
        clearConsoleQueryCache()
      return Promise.reject(error)
    },
  )
}

interface QueryState<T> {
  key: string | null
  data: T | undefined
  // data 属于哪个 key：key 变化且新 key 没有缓存时，先保留上一个 key 的数据
  dataKey: string | null
  error: unknown
  loading: boolean
}

export interface ConsoleQuery<T> {
  /** 数据：有缓存时挂载即有；key 变化且新 key 没有缓存时保留上一个 key 的数据（翻页、筛选时不闪空） */
  data: T | undefined
  error: unknown
  /** 请求进行中（含有缓存时的后台刷新） */
  loading: boolean
  /** 当前显示的是上一个 key 的数据（翻页、切换筛选后新数据还没到） */
  isPreviousData: boolean
  /** 重新请求（写操作之后刷新当前页面用） */
  refresh: () => Promise<void>
  /** 就地修改数据（乐观更新），同时写回缓存 */
  setData: (updater: (prev: T | undefined) => T | undefined) => void
}

/**
 * 后台取数：key 为 null 时不请求。key 里放齐影响结果的全部参数（页码、筛选、排序…），第一个元素写接口名便于辨认。
 * onError 在每次请求失败时调用（如弹出提示）
 */
export function useConsoleQuery<T>(
  key: QueryKey | null,
  fetcher: () => Promise<T>,
  options: { onError?: (error: unknown) => void } = {},
): ConsoleQuery<T> {
  installWriteInterceptor()
  const { user } = useAuth()
  const cacheKey = key && user ? JSON.stringify([user.id, ...key]) : null
  const [state, setState] = useState<QueryState<T>>(() => ({
    key: cacheKey,
    data: readCache<T>(cacheKey),
    dataKey: cacheKey,
    error: null,
    loading: cacheKey !== null,
  }))
  // key 变化：渲染期间就换成新 key 的缓存，避免先用旧 key 的状态画一帧
  if (state.key !== cacheKey) {
    const cached = readCache<T>(cacheKey)
    setState(cached !== undefined
      ? { key: cacheKey, data: cached, dataKey: cacheKey, error: null, loading: cacheKey !== null }
      : { key: cacheKey, data: state.data, dataKey: state.dataKey, error: null, loading: cacheKey !== null })
  }

  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const onErrorRef = useRef(options.onError)
  onErrorRef.current = options.onError
  // 只采用最后一次请求的结果
  const seqRef = useRef(0)

  const refresh = useCallback(async () => {
    if (cacheKey === null)
      return
    const seq = ++seqRef.current
    const startGeneration = generation
    setState(s => (s.key === cacheKey && !s.loading ? { ...s, loading: true } : s))
    try {
      const data = await fetcherRef.current()
      if (startGeneration === generation)
        writeCache(cacheKey, data)
      if (seq === seqRef.current)
        setState(s => (s.key === cacheKey ? { key: cacheKey, data, dataKey: cacheKey, error: null, loading: false } : s))
    }
    catch (error) {
      if (seq !== seqRef.current)
        return
      setState(s => (s.key === cacheKey ? { ...s, error, loading: false } : s))
      onErrorRef.current?.(error)
    }
  }, [cacheKey])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const setData = useCallback((updater: (prev: T | undefined) => T | undefined) => {
    setState((s) => {
      if (s.key !== cacheKey)
        return s
      const data = updater(s.data)
      if (cacheKey !== null && data !== undefined)
        writeCache(cacheKey, data)
      return { ...s, data }
    })
  }, [cacheKey])

  return {
    data: state.data,
    error: state.error,
    loading: state.loading,
    isPreviousData: state.data !== undefined && state.dataKey !== state.key,
    refresh,
    setData,
  }
}
