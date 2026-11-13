'use client'
import type { PageModel } from '@/models/page'
import { MotionConfig } from 'motion/react'
import { useTranslations } from 'next-intl'
import { VisitReporter } from '@/components/common/visit-reporter'
import { WebVitalsReporter } from '@/components/common/web-vitals-reporter'
import Footer from '@/components/layout/footer'
import { NavPagesProvider } from '@/components/layout/nav/nav-pages-context'
import { SiteHeader } from '@/components/layout/nav/site-header'
import { PageBackground } from '@/components/layout/page-background'
import { useNav } from '@/contexts/nav-context'
import { PageBackgroundProvider } from '@/contexts/page-background-context'

// reportVisits：后台的文章预览也套这层外壳（见 console/posts/preview/[id]），预览不上报访问与性能数据
// navPages：布局服务端预取的顶栏导航页面，没有时顶栏挂载后自己获取
export function MainShell({
  children,
  reportVisits = true,
  navPages,
}: Readonly<{
  children: React.ReactNode
  reportVisits?: boolean
  navPages?: PageModel[]
}>) {
  const commonT = useTranslations('Common')
  // 全屏页面：顶栏收起为手势条、不显示页脚
  const { fullscreen } = useNav()
  return (
    // 交互动效遵循系统「减少动态效果」设置
    <MotionConfig reducedMotion="user">
      {/* 全站背景层：底色 / 背景图 / 节日装饰；内容区压在其上（z-10），因此永不遮挡点击 */}
      <PageBackgroundProvider>
        <PageBackground />
        <div className="relative z-10 flex min-h-screen flex-col">
          {/* 访问上报；文章 / 自定义页面详情页带 ID 自行上报 */}
          {reportVisits && (
            <>
              <VisitReporter skipPrefixes={['/p/', '/page/']} />
              <WebVitalsReporter />
            </>
          )}

          {/* 键盘用户可跳过导航直达正文 */}
          <a
            href="#main-content"
            className="sr-only rounded-lg bg-card px-4 py-2 font-medium text-primary focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-60"
          >
            {commonT('skip_to_content')}
          </a>

          <NavPagesProvider pages={navPages}>
            <SiteHeader />
          </NavPagesProvider>

          <main id="main-content" className="w-full min-w-0 flex-1">
            {children}
          </main>
          {!fullscreen && <div data-site-footer><Footer /></div>}
        </div>
      </PageBackgroundProvider>
    </MotionConfig>
  )
}
