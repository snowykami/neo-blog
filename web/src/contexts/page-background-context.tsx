'use client'

import type { ReactNode } from 'react'
import type { ResolvedPageBackground } from '@/utils/common/page-background'
import type { PageBackground } from '@/utils/common/siteinfo'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { useSiteInfo } from '@/contexts/site-info-context'
import { mergePageBackground } from '@/utils/common/page-background'

/**
 * 全站背景系统。
 *
 * 背景不是「一张写死的图」，而是一个可以放任意内容的层：
 * - 站点信息里配的底色 / 背景图 / 高斯模糊 / 遮罩（后台可调，见 Console → 全局设置 → 外观）；
 * - 页面级覆盖：任意页面调 `setPageBackground({ image, blur })` 或直接塞 `slots`；
 * - 节日主题的装饰（两侧留白插画）也由这一层统一渲染，因此**所有前台页面**都能享受，
 *   不再只挂在文章页上。
 *
 * 层的绘制顺序（从后到前）：
 *   底色 → base 槽位（任意内容）→ 背景图 → 遮罩 → 节日装饰 → left / right 槽位 → overlay 槽位
 * 全部 `pointer-events: none`，不参与布局，内容区的宽度与不铺背景时完全一致。
 */

export interface PageBackgroundSlots {
  /** 最底层，遮在底色之上、背景图之下：适合放渐变 div、色块、视频等任意内容 */
  base?: ReactNode
  /** 背景图与遮罩之上：适合放噪点、暗角等整屏覆盖层 */
  overlay?: ReactNode
  /** 左侧留白轨道，追加在节日装饰之后 */
  left?: ReactNode
  /** 右侧留白轨道，追加在节日装饰之后 */
  right?: ReactNode
}

interface PageBackgroundContextValue {
  /** 合并站点配置与页面覆盖后的最终结果 */
  background: ResolvedPageBackground
  slots: PageBackgroundSlots
  /** 页面级覆盖；传 null 表示清除本页覆盖、重新跟随站点配置 */
  setPageBackground: (patch: Partial<PageBackground> | null) => void
  setSlots: (patch: PageBackgroundSlots) => void
}

const PageBackgroundContext = createContext<PageBackgroundContextValue>({
  background: mergePageBackground(),
  slots: {},
  setPageBackground: () => {},
  setSlots: () => {},
})

export function PageBackgroundProvider({
  config,
  slots: initialSlots,
  children,
}: {
  /** 布局层给的初始覆盖（可选），页面内还可以再改 */
  config?: Partial<PageBackground>
  slots?: PageBackgroundSlots
  children: React.ReactNode
}) {
  const { siteInfo } = useSiteInfo()
  const [patch, setPatch] = useState<Partial<PageBackground> | null>(config ?? null)
  const [slots, setSlotsState] = useState<PageBackgroundSlots>(initialSlots ?? {})

  const background = useMemo(
    // 站点默认 ← 布局覆盖 ← 页面内覆盖
    () => mergePageBackground(siteInfo.pageBackground, config, patch),
    [siteInfo.pageBackground, config, patch],
  )

  const setPageBackground = useCallback((next: Partial<PageBackground> | null) => {
    setPatch(current => (next === null ? null : { ...current, ...next }))
  }, [])

  const setSlots = useCallback((next: PageBackgroundSlots) => {
    setSlotsState(current => ({ ...current, ...next }))
  }, [])

  const value = useMemo(
    () => ({ background, slots, setPageBackground, setSlots }),
    [background, slots, setPageBackground, setSlots],
  )

  return (
    <PageBackgroundContext.Provider value={value}>
      {children}
    </PageBackgroundContext.Provider>
  )
}

export function usePageBackground() {
  return useContext(PageBackgroundContext)
}

/** 只需要读背景配置时的便捷入口（比如让某个组件跟随遮罩强度调整自身透明度） */
export function usePageBackgroundConfig() {
  return useContext(PageBackgroundContext).background
}
