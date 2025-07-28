'use client'

import { motion } from 'framer-motion'
import { usePathname } from 'next/navigation'
import { Navbar } from '@/components/navbar'
import { BackgroundProvider } from '@/contexts/background-context'
import Footer from '@/components/footer'

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const pathname = usePathname()
  return (
    <>
    <header className="fixed top-0 left-0 w-full z-50 bg-white/80 dark:bg-slate-900/80 backdrop-blur flex justify-center border-b border-slate-200 dark:border-slate-800">
          <Navbar />
        </header>
      <motion.main
        key={pathname}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{
          type: 'tween',
          ease: 'easeOut',
          duration: 0.30,
        }}
        className="pt-16"
      >
        
        <BackgroundProvider>
          <div className='container mx-auto px-4 sm:px-6 lg:px-10 max-w-7xl'>{children}</div>
        </BackgroundProvider>
      </motion.main>
      <Footer />
    </>
  )
}