'use client'

import type { Transition } from 'motion/react'
import { LazyMotion, m } from 'motion/react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import Navbar from '@/components/layout/nav/navbar-or-side'
import { getMotionFeatures } from '@/lib/motion'
import { cn } from '@/lib/utils'

const TOPBAR_SPRING: Transition = { type: 'spring', mass: 1, stiffness: 195, damping: 23 }
const HOT_ZONE_PX = 24
const COLLAPSE_DELAY_MS = 450
const POPPER_SELECTOR = '[data-radix-popper-content-wrapper], [role="dialog"]'

const insidePopper = (target: EventTarget | null) => target instanceof Element && !!target.closest(POPPER_SELECTOR)

export function ImmersiveHeader() {
  const t = useTranslations('Nav')
  const [expanded, setExpanded] = useState(false)
  const headerRef = useRef<HTMLElement>(null)
  const timerRef = useRef<number | null>(null)

  const cancelCollapse = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const scheduleCollapse = useCallback(() => {
    if (timerRef.current != null)
      return
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      if (document.querySelector(POPPER_SELECTOR) || headerRef.current?.contains(document.activeElement))
        return
      setExpanded(false)
    }, COLLAPSE_DELAY_MS)
  }, [])

  useEffect(() => cancelCollapse, [cancelCollapse])

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse')
        return
      if (event.clientY <= HOT_ZONE_PX || headerRef.current?.contains(event.target as Node)) {
        cancelCollapse()
        setExpanded(true)
      }
      else if (expanded) {
        if (insidePopper(event.target))
          cancelCollapse()
        else
          scheduleCollapse()
      }
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' || !expanded)
        return
      if (!headerRef.current?.contains(event.target as Node) && !insidePopper(event.target))
        setExpanded(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && expanded && !document.querySelector(POPPER_SELECTOR))
        setExpanded(false)
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerdown', onPointerDown, { passive: true })
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [cancelCollapse, expanded, scheduleCollapse])

  return (
    <LazyMotion features={getMotionFeatures()} strict>
      <m.header
        ref={headerRef}
        initial={false}
        animate={{ y: expanded ? 0 : '-115%' }}
        transition={TOPBAR_SPRING}
        onFocusCapture={() => {
          cancelCollapse()
          setExpanded(true)
        }}
        onBlurCapture={(event) => {
          if (!headerRef.current?.contains(event.relatedTarget as Node) && !insidePopper(event.relatedTarget))
            scheduleCollapse()
        }}
        className="fixed inset-x-0 top-0 z-50 mx-auto w-full max-w-[var(--page-w)] px-3 md:px-4"
      >
        <div className="relative before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-6 before:bg-card">
          <Navbar />
        </div>
      </m.header>
      <m.button
        type="button"
        aria-label={t('expand_topbar')}
        aria-expanded={expanded}
        tabIndex={expanded ? -1 : 0}
        initial={false}
        animate={{ opacity: expanded ? 0 : 1, y: expanded ? -12 : 0 }}
        transition={TOPBAR_SPRING}
        onClick={() => {
          cancelCollapse()
          setExpanded(true)
        }}
        className={cn(
          'group fixed top-0 left-1/2 z-50 flex h-6 w-32 -translate-x-1/2 items-center justify-center mix-blend-difference focus-visible:outline-none',
          expanded && 'pointer-events-none',
        )}
      >
        <span className="h-1.5 w-14 rounded-full bg-white/70 transition-[width,background-color] duration-200 group-hover:w-20 group-hover:bg-white/90 group-focus-visible:w-20 group-focus-visible:bg-white" />
      </m.button>
    </LazyMotion>
  )
}
