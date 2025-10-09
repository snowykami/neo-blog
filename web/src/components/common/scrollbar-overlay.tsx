'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useIsMobile } from '@/hooks/use-mobile'

export function DesktopScrollbarOverlay() {
  const thumbRef = useRef<HTMLDivElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const hideTimer = useRef<number | null>(null)
  const dragging = useRef(false)
  const dragStartY = useRef(0)
  const dragStartTop = useRef(0)

  const getNavTopOffset = () => {
    const nav = document.querySelector('nav')
    return nav ? Math.max(0, Math.round(nav.getBoundingClientRect().height)) : 0
  }

  const updateThumb = useCallback(() => {
    const doc = document.documentElement
    const body = document.body
    const scrollTop = window.scrollY || doc.scrollTop || body.scrollTop || 0
    const winH = window.innerHeight
    const scrollH = Math.max(doc.scrollHeight, body.scrollHeight)
    const navOffset = getNavTopOffset()
    const bottomOffset = 8 // leave some bottom margin
    const trackHeight = Math.max(winH - navOffset - bottomOffset, 0)

    if (!thumbRef.current)
      return
    if (scrollH <= winH) {
      thumbRef.current.style.opacity = '0'
      return
    }

    const ratio = winH / scrollH
    const h = Math.max(Math.round(winH * ratio), 32)
    const maxTop = Math.max(trackHeight - h, 0)
    const topInTrack = Math.round((scrollTop / (scrollH - winH)) * maxTop)
    const top = navOffset + topInTrack

    const t = thumbRef.current
    t.style.height = `${h}px`
    t.style.transform = `translateY(${top}px)`
  }, [])

  useEffect(() => {
    // keep native scrolling but hide native visuals via CSS class
    document.documentElement.classList.add('hide-native-scrollbar')
    updateThumb()

    const onScroll = () => {
      if (rafRef.current)
        cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        updateThumb()
        if (!thumbRef.current)
          return
        thumbRef.current.style.opacity = '1'
        if (hideTimer.current)
          window.clearTimeout(hideTimer.current)
        hideTimer.current = window.setTimeout(() => {
          if (thumbRef.current && !dragging.current)
            thumbRef.current.style.opacity = '0'
        }, 600)
      })
    }

    const onResize = () => onScroll()

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize, { passive: true })

    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      if (rafRef.current)
        cancelAnimationFrame(rafRef.current)
      if (hideTimer.current)
        window.clearTimeout(hideTimer.current)
      document.documentElement.classList.remove('hide-native-scrollbar')
    }
  }, [updateThumb])

  // click on track -> jump
  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay)
      return

    const onClick = (e: MouseEvent) => {
      // ignore clicks on thumb itself (thumb handles drag)
      const target = e.target as HTMLElement
      if (target === thumbRef.current)
        return

      const navOffset = getNavTopOffset()
      const rect = overlay.getBoundingClientRect()
      const y = e.clientY - rect.top
      const winH = window.innerHeight
      const doc = document.documentElement
      const body = document.body
      const scrollH = Math.max(doc.scrollHeight, body.scrollHeight)
      const bottomOffset = 8
      const trackHeight = Math.max(winH - navOffset - bottomOffset, 0)

      // position within track (clamp)
      const rel = Math.max(0, Math.min(y - navOffset, trackHeight))
      const thumbEl = thumbRef.current
      const thumbH = thumbEl ? thumbEl.getBoundingClientRect().height : Math.max(Math.round(winH * (winH / scrollH)), 32)
      const maxTop = Math.max(trackHeight - thumbH, 0)
      const ratio = Math.max(0, Math.min(rel, maxTop)) / Math.max(1, maxTop)

      const targetScroll = Math.round(ratio * (scrollH - winH))
      window.scrollTo({ top: targetScroll, behavior: 'auto' })
    }

    overlay.addEventListener('click', onClick)
    return () => overlay.removeEventListener('click', onClick)
  }, [])

  // drag support for the thumb
  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging.current)
        return
      e.preventDefault()
      const navOffset = getNavTopOffset()
      const overlay = overlayRef.current
      const thumbEl = thumbRef.current
      if (!overlay || !thumbEl)
        return

      const winH = window.innerHeight
      const doc = document.documentElement
      const body = document.body
      const scrollH = Math.max(doc.scrollHeight, body.scrollHeight)
      const bottomOffset = 8
      const trackHeight = Math.max(winH - navOffset - bottomOffset, 0)

      const deltaY = e.clientY - dragStartY.current
      let newTopInTrack = dragStartTop.current + deltaY
      const thumbH = thumbEl.getBoundingClientRect().height
      const maxTop = Math.max(trackHeight - thumbH, 0)
      newTopInTrack = Math.max(0, Math.min(newTopInTrack, maxTop))

      // compute scroll position
      const ratio = newTopInTrack / Math.max(1, maxTop)
      const newScroll = Math.round(ratio * (scrollH - winH))
      window.scrollTo({ top: newScroll, behavior: 'auto' })
    }

    const onPointerUp = () => {
      dragging.current = false
      if (thumbRef.current && hideTimer.current) {
        window.clearTimeout(hideTimer.current)
        hideTimer.current = window.setTimeout(() => {
          if (thumbRef.current)
            thumbRef.current.style.opacity = '0'
        }, 600)
      }
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }

    const thumb = thumbRef.current
    if (!thumb)
      return

    const onPointerDown = (e: PointerEvent) => {
      dragging.current = true
      dragStartY.current = e.clientY
      const rect = thumb.getBoundingClientRect()
      const navOffset = getNavTopOffset()
      dragStartTop.current = rect.top - navOffset
      thumb.style.opacity = '1'
      window.addEventListener('pointermove', onPointerMove, { passive: false })
      window.addEventListener('pointerup', onPointerUp, { passive: true })
    }

    thumb.addEventListener('pointerdown', onPointerDown)
    return () => {
      thumb.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [])

  return (
    <div ref={overlayRef} className="scrollbar-overlay" aria-hidden>
      <div
        ref={thumbRef}
        className="scrollbar-overlay__thumb"
        style={{ height: 80, transform: 'translateY(0)', opacity: 0 }}
      />
    </div>
  )
}

export function ScrollbarOverlay() {
  const isMobile = useIsMobile()
  if (isMobile)
    return null
  return <DesktopScrollbarOverlay />
}
