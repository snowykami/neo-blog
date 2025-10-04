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
        className='transition-none w-full' // 禁用全局动画，使用motion.div单独控制动画
        initial={{ y: -64 }}
        animate={{ y: 0 }}
        transition={{ duration: siteInfo.animationDurationSecond, ease: "easeOut" }}>
        <div className={`fixed top-0 left-0 h-${navHeight} w-full z-50 flex justify-center`}>
          <div className={`mx-auto container ${contentAreaMaxWidthClass} px-0 md:${contentAreaPaddingClass} flex items-center w-full`}>
            <Navbar />
          </div>
        </div>
      </motion.nav>
      <BackgroundProvider>
        <div className={`transition-none container mx-auto ${contentAreaMaxWidthClass} ${contentAreaPaddingClass} ${hasNavPadding ? 'pt-16' : ''}`}>{children}</div>
      </BackgroundProvider>
      <Footer />
    </>
  )
}