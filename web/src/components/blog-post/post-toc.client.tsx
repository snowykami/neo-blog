'use client'

import type { TocHeading } from '@/models/toc'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { getScrollOffset, getVisibleElementById, isElementRendered } from '@/utils/client/dom'
import { TocCard } from './toc-card'

export { getScrollOffset }

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 文章目录：标题 id 由服务端注入，这里负责高亮当前阅读位置与平滑滚动
 * 少于 2 个标题时不显示
 */
export function PostToc({ headings, className }: { headings: TocHeading[], className?: string }) {
  const t = useTranslations('Common')
  const [activeId, setActiveId] = useState<string | null>(headings[0]?.id ?? null)
  const cardRef = useRef<HTMLElement>(null)
  // 点击目录后锁定高亮，直到平滑滚动停止，避免途经的标题依次闪烁
  const lockedRef = useRef(false)
  const unlockTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (headings.length < 2)
      return

    const mql = window.matchMedia('(min-width: 1024px)')
    let elements: HTMLElement[] = []
    let attached = false
    let rafId = 0

    // 取最后一个已滚过视口顶部（含偏移）的标题作为当前项
    const update = () => {
      if (cardRef.current && !isElementRendered(cardRef.current))
        return
      if (elements.length === 0)
        return
      const offset = getScrollOffset()
      let current = elements[0].id
      for (const el of elements) {
        if (el.getBoundingClientRect().top - offset - 1 <= 0)
          current = el.id
        else
          break
      }
      setActiveId(prev => (prev === current ? prev : current))
    }

    const onScroll = () => {
      if (lockedRef.current) {
        // 滚动仍在进行，顺延解锁；停止滚动 150ms 后才恢复跟随
        clearTimeout(unlockTimerRef.current)
        unlockTimerRef.current = setTimeout(() => {
          lockedRef.current = false
        }, 150)
        return
      }
      if (rafId !== 0)
        return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        update()
      })
    }

    // 用户手动滚动时立即解除锁定，恢复跟随阅读位置
    const unlock = () => {
      lockedRef.current = false
    }

    const detach = () => {
      if (!attached)
        return
      attached = false
      if (rafId !== 0) {
        cancelAnimationFrame(rafId)
        rafId = 0
      }
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      window.removeEventListener('wheel', unlock)
      window.removeEventListener('touchstart', unlock)
    }

    const syncListeners = () => {
      const visible = mql.matches && (!cardRef.current || isElementRendered(cardRef.current))
      if (!visible) {
        detach()
        return
      }
      if (attached)
        return
      elements = headings
        .map(heading => getVisibleElementById(heading.id))
        .filter((el): el is HTMLElement => !!el)
      if (elements.length === 0)
        return
      attached = true
      update()
      window.addEventListener('scroll', onScroll, { passive: true })
      window.addEventListener('resize', onScroll, { passive: true })
      window.addEventListener('wheel', unlock, { passive: true })
      window.addEventListener('touchstart', unlock, { passive: true })
    }

    syncListeners()
    mql.addEventListener('change', syncListeners)
    return () => {
      mql.removeEventListener('change', syncListeners)
      detach()
      clearTimeout(unlockTimerRef.current)
      lockedRef.current = false
    }
  }, [headings])

  if (headings.length < 2)
    return null

  const scrollTo = (event: React.MouseEvent<HTMLElement>, id: string) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
      return
    const el = getVisibleElementById(id)
    if (!el)
      return
    event.preventDefault()
    setActiveId(id)
    lockedRef.current = true
    // 目标已在当前位置时不会触发滚动事件，兜底解锁
    clearTimeout(unlockTimerRef.current)
    unlockTimerRef.current = setTimeout(() => {
      lockedRef.current = false
    }, 300)
    window.scrollTo({
      top: el.getBoundingClientRect().top + window.scrollY - getScrollOffset(),
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
    window.history.replaceState(null, '', `#${encodeURIComponent(id)}`)
  }

  const label = t('table_of_contents')

  return (
    <TocCard
      ref={cardRef}
      title={label}
      ariaLabel={label}
      headings={headings}
      activeId={activeId}
      getItemHref={heading => `#${heading.id}`}
      onSelect={(heading, _index, event) => scrollTo(event, heading.id)}
      className={className}
    />
  )
}
