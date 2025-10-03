"use client"

import React, { createContext, useContext, useEffect, useState } from "react";

export type SiteInfo = {
  colorSchemes: string[];
  baseUrl?: string;
  metadata: {
    name?: string;
    icon?: string;
    description?: string;
  };
  defaultCover: string;
  owner: {
    name: string;
    description?: string;
    motto?: string;
    avatar?: string;
    gravatarEmail?: string;
  };
  postsPerPage: number;
  commentsPerPage: number;
  verifyCodeCoolDown: number;
  animationDurationSecond: number;
  copyright?: string;
  copyrightLink?: string;
  footer: {
    text?: string;
    links?: {
      text: string;
      href: string;
    }[];
  };
};

// 这里不写类型定义，是让编辑器根据实际内容推断类型
export const fallbackSiteInfo: SiteInfo = {
  colorSchemes: ["blue", "green", "orange", "red", "rose", "violet", "yellow"],
  metadata: {
    name: "Failed to Fetch",
    icon: "",
    description: "Failed to fetch site info from server.",
  },
  defaultCover: "https://cdn.liteyuki.org/blog/background.png",
  owner: {
    name: "Site Owner",
    description: "The owner of this site",
    motto: "This is a default motto.",
    avatar: "",
    gravatarEmail: "",
  },
  postsPerPage: 10,
  commentsPerPage: 10,
  verifyCodeCoolDown: 60,
  animationDurationSecond: 0.3,
  copyright: "CC BY-NC-SA 4.0",
  copyrightLink: "https://creativecommons.org/licenses/by/4.0/",
  footer: {
    text: "Default footer text",
    links: [
      { text: "Home", href: "/" },
      { text: "About", href: "/about" },
    ],
  },
};

type SiteInfoContextValue = {
  siteInfo: SiteInfo;
  setSiteInfo: (info: SiteInfo) => void;
  isLoaded: boolean;
};

const SiteInfoContext = createContext<SiteInfoContextValue | undefined>(undefined);

/**
 * 深度合并两个对象，用 fallback 填补 initial 中缺失的字段
 */
function mergeWithFallback<T extends Record<string, unknown>>(initial: T, fallback: T): T {
  const result = { ...initial } as T;
  
  for (const key in fallback) {
    if (fallback.hasOwnProperty(key)) {
      const initialValue = initial[key];
      const fallbackValue = fallback[key];
      
      if (initialValue === undefined || initialValue === null) {
        // 如果 initial 中没有这个字段，直接使用 fallback
        result[key] = fallbackValue;
      } else if (
        typeof initialValue === 'object' && 
        !Array.isArray(initialValue) && 
        typeof fallbackValue === 'object' && 
        !Array.isArray(fallbackValue)
      ) {
        // 如果都是对象（非数组），递归合并
        result[key] = mergeWithFallback(initialValue as Record<string, unknown>, fallbackValue as Record<string, unknown>) as T[typeof key];
      }
      // 否则保持 initial 的值不变
    }
  }
  
  return result;
}

export const SiteInfoProvider: React.FC<{ initialData?: SiteInfo; children: React.ReactNode }> = ({ initialData, children }) => {
  // 合并初始数据和 fallback，确保所有字段都有值
  const mergedInitialData = initialData ? mergeWithFallback(initialData, fallbackSiteInfo) : fallbackSiteInfo;
  
  const [siteInfo, setSiteInfo] = useState<SiteInfo>(mergedInitialData);
  const [isLoaded, setIsLoaded] = useState<boolean>(Boolean(initialData));
  
  // If initialData is not provided (rare), you can fetch on client as fallback.
  useEffect(() => {
    if (initialData) return;
    let mounted = true;
    (async () => {
      try {
        const res = await fetch('/api/siteinfo');
        if (!mounted) return;
        if (res.ok) {
          const data = await res.json();
          // 同样对客户端获取的数据进行合并
          const mergedData = mergeWithFallback(data, fallbackSiteInfo);
          setSiteInfo(mergedData);
        }
      } catch (e) {
        // swallow — siteInfo stays with fallback
        console.error('fetch siteinfo failed', e);
      } finally {
        if (mounted) setIsLoaded(true);
      }
    })();
    return () => { mounted = false };
  }, [initialData]);

  useEffect(() => {
    if (initialData) {
      const mergedData = mergeWithFallback(initialData, fallbackSiteInfo);
      setSiteInfo(mergedData);
      setIsLoaded(true);
    }
  }, [initialData]);

  return (
    <SiteInfoContext.Provider value={{ 
      siteInfo, 
      setSiteInfo: (info: SiteInfo) => {
        // 当手动设置 siteInfo 时也进行合并
        const mergedInfo = mergeWithFallback(info, fallbackSiteInfo);
        setSiteInfo(mergedInfo);
      }, 
      isLoaded 
    }}>
      {children}
    </SiteInfoContext.Provider>
  );
};

export function useSiteInfo() {
  const ctx = useContext(SiteInfoContext);
  if (!ctx) throw new Error('useSiteInfo must be used within SiteInfoProvider');
  return ctx;
}

export default SiteInfoContext;