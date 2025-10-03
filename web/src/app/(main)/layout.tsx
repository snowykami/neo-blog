"use client"
import { motion } from 'motion/react'
import { BackgroundProvider, useBackground } from '@/contexts/background-context'
import { DEFAULT_NAV_CLASSNAME, useNavPadding } from "@/contexts/nav-context";
import Footer from '@/components/layout/footer'
import Navbar from '@/components/layout/nav/navbar-or-side'
import { useSiteInfo } from '@/contexts/site-info-context'
import { cn } from '@/lib/utils';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { contentAreaMaxWidthClass, contentAreaPaddingClass } from '@/utils/common/layout-size';

const withoutNavPaddingPaths = [
  "/p"
]

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const { siteInfo } = useSiteInfo();
  const { setHasNavPadding, hasNavPadding, navClassName } = useNavPadding();
  const pathname = usePathname();

  useEffect(() => {
    if (withoutNavPaddingPaths.some(p => pathname.startsWith(p))) {
      setHasNavPadding(false);
    } else {
      setHasNavPadding(true);
    }
  }, [
    pathname
  ])

  return (
    <>
      <motion.nav
        initial={{ y: -64, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: siteInfo.animationDurationSecond, ease: "easeOut" }}>
        <header className={cn(DEFAULT_NAV_CLASSNAME, navClassName)}>
          <Navbar />
        </header>
      </motion.nav>
      <BackgroundProvider>
        <div className={`container mx-auto ${contentAreaMaxWidthClass} ${contentAreaPaddingClass} ${hasNavPadding ? 'pt-16' : ''}`}>{children}</div>
      </BackgroundProvider>
      <Footer />
    </>
  )
}