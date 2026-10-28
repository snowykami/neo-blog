'use client'

import type { Transition } from 'motion/react'
import { motion } from 'motion/react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import Navbar from '@/components/layout/nav/navbar-or-side'
import { useNav } from '@/contexts/nav-context'
import { cn } from '@/lib/utils'

/**
 * 顶栏收起 / 展开的弹簧：二阶系统（质量-弹簧-阻尼），参数由苹果弹簧动画的「响应时间 0.45 秒、阻尼比 0.825」换算：
 * 刚度 = (2π / 响应时间)²，阻尼 = 4π × 阻尼比 / 响应时间（质量为 1），略带回弹且很快稳定
 */
const TOPBAR_SPRING: Transition = { type: 'spring', mass: 1, stiffness: 195, damping: 23 }
// 鼠标移到视口顶部这一高度内时展开
const HOT_ZONE_PX = 24
// 鼠标离开顶栏后延迟收起，避免划过时来回抖动
const COLLAPSE_DELAY_MS = 450
// Radix 弹出层（下拉菜单、搜索等）渲染在 body 下：其中的指针与焦点视为仍在顶栏内
const POPPER_SELECTOR = '[data-radix-popper-content-wrapper], [role="dialog"]'

const insidePopper = (target: EventTarget | null) => target instanceof Element && !!target.closest(POPPER_SELECTOR)

/**
 * 全屏页面的顶栏：平时向上收起，只在顶部中央留一条手势条（类似 iOS 的 Home 指示条）；
 * 鼠标移到顶部、悬停顶栏、键盘聚焦或点按手势条时展开，离开后收起，Esc 立即收起
 */
function ImmersiveHeader() {
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
      // 顶栏内的菜单仍打开、或焦点仍在顶栏内时不收起
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
        // 弹出层（如从顶栏打开的菜单）只让已展开的顶栏保持展开，不会让收起的顶栏展开（页面自己的菜单、抽屉不受影响）
        if (insidePopper(event.target))
          cancelCollapse()
        else
          scheduleCollapse()
      }
    }
    // 触摸：点按顶栏与弹出层以外的位置收起
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
    <>
      <motion.header
        ref={headerRef}
        initial={false}
        animate={{ y: expanded ? 0 : '-115%' }}
        transition={TOPBAR_SPRING}
        // 键盘用户 Tab 进入顶栏时展开，焦点离开后收起
        onFocusCapture={() => {
          cancelCollapse()
          setExpanded(true)
        }}
        onBlurCapture={(event) => {
          if (!headerRef.current?.contains(event.relatedTarget as Node) && !insidePopper(event.relatedTarget))
            scheduleCollapse()
        }}
        className="fixed inset-x-0 top-0 z-50 mx-auto w-full max-w-[var(--page-w)] px-0 md:px-4"
      >
        {/* 弹簧展开时会略微越过终点（向下回弹），卡片上方接一段同色延伸，回弹时盖住顶部露出的缝隙；收起时它在视口外 */}
        <div className="relative before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-6 before:bg-card">
          <Navbar />
        </div>
      </motion.header>
      {/* 手势条：与背景做差值混合，在浅色与深色页面上都清晰可见 */}
      <motion.button
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
      </motion.button>
    </>
  )
}

/**
 * 站点顶栏：普通页面为吸顶的导航栏；全屏页面（或 immersive 指定时）收起为手势条，按需展开
 */
export function SiteHeader({ immersive = false }: { immersive?: boolean }) {
  const { fullscreen } = useNav()
  if (immersive || fullscreen)
    return <ImmersiveHeader />
  return (
    // 吸顶导航：与正文同宽，首屏入场动画为纯 CSS（见 styles/animation.css），不依赖水合
    <header data-site-header="sticky" className="enter-fade-down sticky top-0 z-40 mx-auto w-full max-w-[var(--page-w)] px-0 md:px-4">
      <Navbar />
    </header>
  )
}
