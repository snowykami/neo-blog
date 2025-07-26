'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { usePathname } from 'next/navigation'
import { Navbar } from '@/components/navbar'

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
      <AnimatePresence mode="wait">
        <motion.main
          key={pathname}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{
            type: 'tween',
            ease: 'easeOut',
            duration: 0.18,
          }}
          className="pt-16"
        >
          {children}
        </motion.main>
      </AnimatePresence>
    </>
  )
}
