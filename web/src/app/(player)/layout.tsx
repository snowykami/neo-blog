'use client'

import { MotionConfig } from 'motion/react'
import { SiteHeader } from '@/components/layout/nav/site-header'

/**
 * 全屏页面（播放器页等）：不显示页脚，顶栏收起为顶部的手势条，鼠标移到顶部或点按手势条时展开
 */
export default function PlayerLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // 交互动效遵循系统「减少动态效果」设置
    <MotionConfig reducedMotion="user">
      {children}
      {/* 放在内容之后，叠在全屏页面之上 */}
      <SiteHeader immersive />
    </MotionConfig>
  )
}
