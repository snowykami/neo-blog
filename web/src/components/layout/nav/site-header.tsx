'use client'

import dynamic from 'next/dynamic'
import Navbar from '@/components/layout/nav/navbar-or-side'
import { useNav } from '@/contexts/nav-context'

const ImmersiveHeader = dynamic(
  () => import('./immersive-header').then(m => m.ImmersiveHeader),
  { ssr: false },
)

/**
 * 站点顶栏：普通页面为吸顶的导航栏；全屏页面（或 immersive 指定时）按需懒加载手势顶栏
 */
export function SiteHeader({ immersive = false }: { immersive?: boolean }) {
  const { fullscreen } = useNav()
  if (immersive || fullscreen)
    return <ImmersiveHeader />
  return (
    // 吸顶导航：与正文同宽，首屏入场动画为纯 CSS（见 styles/animation.css），不依赖水合
    <header data-site-header="sticky" className="enter-fade-down sticky top-0 z-40 mx-auto w-full max-w-[var(--page-w)] px-3 md:px-4">
      <Navbar />
    </header>
  )
}
