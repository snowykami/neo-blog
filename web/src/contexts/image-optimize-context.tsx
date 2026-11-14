'use client'

import React, { createContext, useContext, useEffect } from 'react'
import { IMAGE_OPTIMIZE_HOSTS, setRuntimeImageOptimizeHosts } from '@/utils/common/image'

const ImageOptimizeHostsContext = createContext<readonly string[]>(IMAGE_OPTIMIZE_HOSTS)

/**
 * 下发服务端运行时读取的图片优化域名白名单，确保 SSR 与客户端水合拿到完全一致的域名列表
 */
export function ImageOptimizeProvider({
  hosts,
  children,
}: {
  hosts: readonly string[]
  children: React.ReactNode
}) {
  useEffect(() => {
    setRuntimeImageOptimizeHosts(hosts)
  }, [hosts])

  return (
    <ImageOptimizeHostsContext.Provider value={hosts}>
      {children}
    </ImageOptimizeHostsContext.Provider>
  )
}

/** 读取当前生效的图片优化域名白名单 */
export function useImageOptimizeHosts(): readonly string[] {
  return useContext(ImageOptimizeHostsContext)
}
