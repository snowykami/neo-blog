'use client'

import { useEffect } from 'react'
import axiosClient from '@/api/client'
import { useRouter } from '@/i18n/navigation'

/**
 * 后台改了前台可见的内容（发布、改文章 / 页面的公开字段、分类标签、置顶、站点配置）后，清掉浏览器里的路由缓存：
 * 不然回到前台时，路由缓存（staleTimes.dynamic、cacheLife 的 stale）与后退用的缓存还会给出改之前的页面，最长 5 分钟。
 *
 * - 用 router.refresh()：Next 16 里它让浏览器的 Segment Cache 与 BFCache 整体换代（segment-cache/cache.js 的
 *   invalidateSegmentCacheEntries、bfcache.js 的 invalidateBfCache 都是全局版本号），不只是当前路由；
 *   之后无论点链接还是浏览器后退回到前台，都会向服务端重新取。被 Activity 保留的前台页面再次显示时同样按新数据渲染
 * - 服务端的页面缓存按后端缓存标签的版本号失效，前端服务每 3 秒才轮询一次（cache-tag-versions.mjs 的 SYNC_INTERVAL_MS），
 *   保存后立刻回到前台可能还拿到旧页面并重新存进浏览器缓存：保存成功时立刻清一次，等服务端确定已得知修改后再清一次
 * - 在 axiosClient 的拦截器里统一判断，不在各个保存按钮里分别调用：编辑器离开页面前的保存（keepalive）在页面切走后才完成，
 *   组件已经卸载，也要能清掉。拦截器装上后一直保留，路由实例在 ConsoleShell 里登记（全站只有一个 App Router 实例）
 * - 只改草稿的自动保存不清：读者看不到草稿，写作期间每次自动保存都刷新当前路由没有必要
 */

// 服务端得知修改的最长时间：轮询间隔 3 秒，再留出一次轮询请求的时间
const SERVER_SYNC_DELAY_MS = 4500

// 前台可见内容的写接口（路径相对 /api/v1）
const PUBLIC_CONTENT_WRITES: RegExp[] = [
  // 文章 / 页面的创建、修改（含发布、私密、slug、分类、标签等元信息）、删除；只改草稿的保存见 isDraftOnlySave
  /^\/(?:post|page)\/p(?:\/\d+)?$/,
  // 恢复历史版本：草稿之外还会恢复标题、slug、私密等元信息
  /^\/(?:post|page)\/p\/\d+\/revisions\/\d+\/restore$/,
  // 独立 HTML 页面上传新版本、切换生效版本
  /^\/page\/p\/\d+\/html\/versions(?:\/\d+)?$/,
  // 分类、标签的创建、改名、删除
  /^\/post\/c(?:\/\d+)?$/,
  /^\/label\/l(?:\/\d+)?$/,
  // 首页置顶
  /^\/admin\/posts\/\d+\/pin$/,
  // 站点配置（全局配置与高级 KV）
  /^\/admin\/config$/,
  /^\/admin\/kv(?:\/.*)?$/,
]

const READ_METHODS = new Set(['get', 'head', 'options'])
// 只改草稿时请求体里的字段（请求层会转成 snake_case，两种写法都认）
const DRAFT_ONLY_KEYS = new Set(['id', 'draftContent', 'draft_content', 'baseDraftVersion', 'base_draft_version'])

interface RequestLike { method?: string, url?: string, data?: unknown }

function isDraftOnlySave(data: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data))
    return false
  const keys = Object.keys(data)
  return keys.length > 0 && keys.every(key => DRAFT_ONLY_KEYS.has(key))
}

/** 这个请求会不会改动前台可见的内容 */
export function isPublicContentWrite(config?: RequestLike): boolean {
  const method = (config?.method ?? 'get').toLowerCase()
  if (READ_METHODS.has(method))
    return false
  const path = (config?.url ?? '').split('?', 1)[0]
  if (!PUBLIC_CONTENT_WRITES.some(pattern => pattern.test(path)))
    return false
  return !(method === 'put' && isDraftOnlySave(config?.data))
}

let refreshRouter: (() => void) | null = null
let delayedTimer: ReturnType<typeof setTimeout> | null = null
let interceptorInstalled = false
// 请求发出时判断（此时请求体还是对象），响应成功后才清缓存；响应里的 config 与请求时是同一个对象
const pendingWrites = new WeakSet<object>()

/** 清掉浏览器路由缓存：立刻一次，服务端得知修改后再一次（多次保存合并成最后一次之后的那一次） */
export function invalidateRouterCache() {
  refreshRouter?.()
  if (delayedTimer)
    clearTimeout(delayedTimer)
  delayedTimer = setTimeout(() => {
    delayedTimer = null
    refreshRouter?.()
  }, SERVER_SYNC_DELAY_MS)
}

function installInterceptor() {
  if (interceptorInstalled || typeof window === 'undefined')
    return
  interceptorInstalled = true
  axiosClient.interceptors.request.use((config) => {
    if (isPublicContentWrite(config))
      pendingWrites.add(config)
    return config
  })
  axiosClient.interceptors.response.use((response) => {
    if (pendingWrites.has(response.config)) {
      pendingWrites.delete(response.config)
      invalidateRouterCache()
    }
    return response
  })
}

/** 登记路由实例并装上拦截器；在后台外壳里调用一次 */
export function usePublicContentRefresh() {
  const router = useRouter()
  useEffect(() => {
    refreshRouter = () => router.refresh()
    installInterceptor()
  }, [router])
}
