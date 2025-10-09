'use client'

import type { SiteInfo } from '@/utils/common/siteinfo'
import React, { createContext, useContext, useEffect, useState } from 'react'
import { fallbackSiteInfo } from '@/utils/common/siteinfo'

interface SiteInfoContextValue {
  siteInfo: SiteInfo
  setSiteInfo: (info: SiteInfo) => void
  isLoaded: boolean
}

const SiteInfoContext = createContext<SiteInfoContextValue | undefined>(undefined)

/**
 * 深度合并两个对象，用 fallback 填补 initial 中缺失的字段
 */
function mergeWithFallback<T extends object>(initial: T, fallback: T): T {
  const result = { ...initial } as T
  for (const key of Object.keys(fallback) as (keyof T)[]) {
    const initialValue = (initial as any)[key]
    const fallbackValue = (fallback as any)[key]

    if (initialValue === undefined || initialValue === null) {
      // 如果 initial 中没有这个字段，直接使用 fallback
      result[key] = fallbackValue as T[typeof key]
    }
    else if (
      typeof initialValue === 'object'
      && initialValue !== null
      && !Array.isArray(initialValue)
      && typeof fallbackValue === 'object'
      && fallbackValue !== null
      && !Array.isArray(fallbackValue)
    ) {
      // 如果都是对象（非数组），递归合并
      result[key] = mergeWithFallback(
        initialValue as any,
        fallbackValue as any,
      ) as T[typeof key]
    }
    // 否则保持 initial 的值不变
  }

  return result
}

export const SiteInfoProvider: React.FC<{
  initialData?: SiteInfo
  children: React.ReactNode
}> = ({ initialData, children }) => {
  const mergedInitialData = initialData
    ? mergeWithFallback(initialData, fallbackSiteInfo)
    : fallbackSiteInfo

  const [siteInfo, setSiteInfo] = useState<SiteInfo>(mergedInitialData)
  const [isLoaded, setIsLoaded] = useState<boolean>(Boolean(initialData))

  useEffect(() => {
    if (initialData)
      return
    let mounted = true;
    (async () => {
      try {
        const res = await fetch('/api/siteinfo')
        if (!mounted)
          return
        if (res.ok) {
          const data = await res.json()
          // 同样对客户端获取的数据进行合并
          const mergedData = mergeWithFallback(data, fallbackSiteInfo)
          setSiteInfo(mergedData)
        }
      }
      catch (e) {
        // swallow — siteInfo stays with fallback
        console.error('fetch siteinfo failed', e)
      }
      finally {
        if (mounted)
          setIsLoaded(true)
      }
    })()
    return () => {
      mounted = false
    }
  }, [initialData])

  useEffect(() => {
    if (initialData) {
      const mergedData = mergeWithFallback(initialData, fallbackSiteInfo)
      setSiteInfo(mergedData)
      setIsLoaded(true)
    }
  }, [initialData])

  return (
    <SiteInfoContext.Provider
      value={{
        siteInfo,
        setSiteInfo: (info: SiteInfo) => {
          // 当手动设置 siteInfo 时也进行合并
          const mergedInfo = mergeWithFallback(info, fallbackSiteInfo)
          setSiteInfo(mergedInfo)
        },
        isLoaded,
      }}
    >
      {children}
    </SiteInfoContext.Provider>
  )
}

export function useSiteInfo() {
  const ctx = useContext(SiteInfoContext)
  if (!ctx)
    throw new Error('useSiteInfo must be used within SiteInfoProvider')
  return ctx
}

export default SiteInfoContext
