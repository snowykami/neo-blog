'use client'
import { motion } from 'motion/react'
import { FloatingWidgets } from '@/components/common/main-floating-widgets'
import Footer from '@/components/layout/footer'
import Navbar from '@/components/layout/nav/navbar-or-side'
import { BackgroundProvider } from '@/contexts/background-context'
import { useNav } from '@/contexts/nav-context'
import { useSiteInfo } from '@/contexts/site-info-context'
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
  const { siteInfo } = useSiteInfo()
  const { hasNavPadding } = useNav()

  const FOOTER_HEIGHT = 80
  const minMainHeight = `calc(100vh - ${FOOTER_HEIGHT}px)`

  return (
    <div className="flex flex-col min-h-screen">
      <FloatingWidgets />
      <motion.nav
        className="w-full fixed inset-x-0 z-5"
        initial={{ y: -64 }}
        animate={{ y: 0 }}
        transition={{
          duration: siteInfo.animationDurationSecond,
          ease: 'easeOut',
        }}
      >
        <div className={`top-0 left-0 h-${navHeight} w-full flex justify-center`}>
          <div className={`${contentAreaMaxWidthClass} flex items-center w-full`}>
            <Navbar />
          </div>
        </div>
      </motion.nav>
      <BackgroundProvider
        defaultBackground={<div className="absolute inset-0 -z-10 bg-primary/20" />}
      >
        <main
          style={{ minHeight: minMainHeight }}
          className={`mx-auto ${contentAreaMaxWidthClass} ${contentAreaPaddingClass} ${hasNavPadding ? 'pt-16' : ''} min-h-0`}
        >
          {children}
        </main>
      </BackgroundProvider>
      <Footer height={FOOTER_HEIGHT} />
    </div>
  )
}
