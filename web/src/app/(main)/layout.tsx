'use client'
import { MotionConfig } from 'motion/react'
import { useTranslations } from 'next-intl'
import { VisitReporter } from '@/components/common/visit-reporter'
import Footer from '@/components/layout/footer'
import Navbar from '@/components/layout/nav/navbar-or-side'

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const commonT = useTranslations('Common')
  return (
    // 交互动效遵循系统「减少动态效果」设置
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-screen flex-col">
        {/* 访问上报；文章 / 自定义页面详情页带 ID 自行上报 */}
        <VisitReporter skipPrefixes={['/p/', '/page/']} />

        {/* 键盘用户可跳过导航直达正文 */}
        <a
          href="#main-content"
          className="sr-only rounded-lg bg-card px-4 py-2 font-medium text-primary focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-60"
        >
          {commonT('skip_to_content')}
        </a>

        {/* 吸顶导航：与正文同宽，首屏入场动画为纯 CSS（见 styles/animation.css），不依赖水合 */}
        <header className="enter-fade-down sticky top-0 z-40 mx-auto w-full max-w-[var(--page-w)] px-0 md:px-4">
          <Navbar />
        </header>

        <main id="main-content" className="w-full min-w-0 flex-1">
          {children}
        </main>
        <Footer />
      </div>
    </MotionConfig>
  )
}
