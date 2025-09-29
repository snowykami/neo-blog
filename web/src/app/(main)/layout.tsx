"use client"
import { motion } from 'motion/react'
import { BackgroundProvider } from '@/contexts/background-context'
import Footer from '@/components/layout/footer'
import Navbar from '@/components/layout/nav/navbar-or-side'
import { useSiteInfo } from '@/contexts/site-info-context'

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const { siteInfo } = useSiteInfo();
  return (
    <>
      <motion.nav
        initial={{ y: -64, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: siteInfo.animationDurationSecond, ease: "easeOut" }}>
        <header className="fixed top-0 left-0 h-16 w-full z-50 bg-white/80 dark:bg-slate-900/80 backdrop-blur flex justify-center border-b border-slate-200 dark:border-slate-800">
          <Navbar />
        </header>
      </motion.nav>
      <BackgroundProvider>
        <div className='container mx-auto pt-16 px-4 sm:px-6 lg:px-10 max-w-7xl'>{children}</div>
      </BackgroundProvider>
      <Footer />
    </>
  )
}