"use client"
import { motion } from 'motion/react';
import { BackgroundProvider } from '@/contexts/background-context'
import { useNav } from "@/contexts/nav-context";
import Footer from '@/components/layout/footer'
import Navbar from '@/components/layout/nav/navbar-or-side'
import { useSiteInfo } from '@/contexts/site-info-context'
import { contentAreaMaxWidthClass, contentAreaPaddingClass, navHeight } from '@/utils/common/layout-size';


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const { siteInfo } = useSiteInfo();
  const { hasNavPadding } = useNav();

  return (
    <>
      <motion.nav
        className='w-full fixed inset-x-0 z-5' // 禁用全局动画，使用motion.div单独控制动画
        initial={{ y: -64 }}
        animate={{ y: 0 }}
        transition={{ duration: siteInfo.animationDurationSecond, ease: "easeOut" }}>
        <div className={`top-0 left-0 h-${navHeight} w-full flex justify-center`}>
          <div className={`${contentAreaMaxWidthClass} px-0 md:${contentAreaPaddingClass} flex items-center w-full`}>
            <Navbar />
          </div>
        </div>
      </motion.nav>
      <BackgroundProvider defaultBackground={
        <div className="absolute inset-0 -z-10 bg-primary/20" />
      }>
        <div className={`mx-auto ${contentAreaMaxWidthClass} ${contentAreaPaddingClass} ${hasNavPadding ? 'pt-16' : ''}`}>{children}</div>
      </BackgroundProvider>
      <Footer />
    </>
  )
}