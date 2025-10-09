'use client'

import { useEffect, useState } from 'react'
import { useBackground } from '@/contexts/background-context'
import { useNav } from '@/contexts/nav-context'
import { blogPostWithTransparentNavScrollMaxHeight } from '@/utils/common/layout-size'

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const { setBackground, resetBackground } = useBackground()
  const { setNavStyle, resetNavStyle, setHasNavPadding } = useNav()
  const [scrollY, setScrollY] = useState(typeof window !== 'undefined' ? window.scrollY : 0)

  useEffect(() => {
    setBackground(
      <div className="absolute inset-0 -z-10 bg-primary/10">
      </div>,
    )
    return () => resetBackground()
  }, [setBackground, resetBackground])

  useEffect(() => {
    setHasNavPadding(false)
    return () => setHasNavPadding(true)
  }, [setHasNavPadding])

  useEffect(() => {
    const handleScroll = () => {
      setScrollY(window.scrollY)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()

    return () => {
      window.removeEventListener('scroll', handleScroll)
      resetNavStyle()
    }
  }, [resetNavStyle])

  useEffect(() => {
    const maxGradientScroll = blogPostWithTransparentNavScrollMaxHeight
    if (scrollY <= maxGradientScroll) {
      setNavStyle(`bg-transparent backdrop-blur-none border-none shadow-none !text-white [&_.text-primary]:text-white`)
    }
    else {
      resetNavStyle()
    }
  }, [scrollY, setNavStyle, resetNavStyle])

  return (
    <div>
      {children}
    </div>
  )
}
