'use client'
import { MotionConfig } from 'motion/react'
import { VisitReporter } from '@/components/common/visit-reporter'
import Footer from '@/components/layout/footer'
import Navbar from '@/components/layout/nav/navbar-or-side'
import { BackgroundProvider } from '@/contexts/background-context'
import { useNav } from '@/contexts/nav-context'
import {
  contentAreaMaxWidthClass,
  contentAreaPaddingClass,
  navHeight,
} from '@/utils/common/layout-size'

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const { hasNavPadding } = useNav()

  const FOOTER_HEIGHT = 80
  const minMainHeight = `calc(100vh - ${FOOTER_HEIGHT}px)`

  return (
    // 交互动效遵循系统「减少动态效果」设置
    <MotionConfig reducedMotion="user">
      <div className="flex flex-col min-h-screen">
        {/* 访问上报；文章 / 自定义页面详情页带 ID 自行上报 */}
        <VisitReporter skipPrefixes={['/p/', '/page/']} />

        {/* 首屏入场动画为纯 CSS（见 styles/animation.css），不依赖水合 */}
        <nav className="w-full fixed inset-x-0 z-5 enter-fade-down">
          <div className={`top-0 left-0 h-${navHeight} w-full flex justify-center`}>
            <div className={`${contentAreaMaxWidthClass} flex items-center w-full`}>
              <Navbar />
            </div>
          </div>
        </nav>
        <BackgroundProvider
          defaultBackground={<div className="absolute inset-0 -z-10 bg-primary/20" />}
        >
          <main
            style={{ minHeight: minMainHeight }}
            className={`mx-auto ${contentAreaMaxWidthClass} ${contentAreaPaddingClass} ${hasNavPadding ? 'pt-16' : ''} min-h-0 `}
          >
            {children}
          </main>
        </BackgroundProvider>
        <Footer height={FOOTER_HEIGHT} />
      </div>
    </MotionConfig>
  )
}
