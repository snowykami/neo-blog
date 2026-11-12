'use client'

import { ArrowUpIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { CommentIcon } from '@/contexts/theme-context'
import { usePathname } from '@/i18n/navigation'
import { isConsolePath } from '@/i18n/routing'
import { cn } from '@/lib/utils'
import { getRenderedElementById, getScrollOffset, measureArticleReading } from '@/utils/client/dom'
import { isConsolePreviewPath } from '@/utils/common/route'

interface QuickNavState {
  showTop: boolean
  hasComments: boolean
  showComments: boolean
  inComments: boolean
  percent: number
}

const INITIAL_STATE: QuickNavState = {
  showTop: false,
  hasComments: false,
  showComments: false,
  inComments: false,
  percent: 0,
}

function preferInstantScroll(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 右下角快捷定位双按钮（上下排布）：
 * - 上：回到顶部 + 同心阅读进度环（正文页复用灵动岛 #blog-content / #page-content 阅读进度算法，列表页回退整页滚动比例）
 * - 下：跳转到评论区（当前页面存在可见 #comments 时显示，进入评论区后高亮）
 */
export default function ScrollToTopButton({
  threshold = 0.08,
  positionClass = 'right-4 bottom-5',
  className = '',
  showProgress = true,
  size = 38,
}: {
  threshold?: number
  positionClass?: string
  className?: string
  showProgress?: boolean
  size?: number
}) {
  const pathname = usePathname()
  const t = useTranslations('Common')
  const [mounted, setMounted] = useState(false)
  const [state, setState] = useState<QuickNavState>(INITIAL_STATE)

  // 独立播放器页与后台管理页（不含文章 / 页面预览）不显示悬浮快捷按钮，避免遮挡控制栏与保存栏
  const hiddenByRoute = pathname === '/music' || (isConsolePath(pathname) && !isConsolePreviewPath(pathname))

  useEffect(() => {
    setMounted(true)
    if (hiddenByRoute) {
      setState(INITIAL_STATE)
      return
    }

    let frame = 0
    const observed = new Set<Element>()
    let observer: ResizeObserver | null = null

    const ensureObserved = (el: Element | null) => {
      if (!el || !observer || observed.has(el))
        return
      observed.add(el)
      observer.observe(el)
    }

    const measure = () => {
      frame = 0
      const doc = document.documentElement
      const scrollTop = window.scrollY || doc.scrollTop || 0
      const vh = window.innerHeight || 1
      const docHeight = Math.max(doc.scrollHeight, document.body.scrollHeight, vh)
      const maxScroll = Math.max(0, docHeight - vh)
      const docProgress = maxScroll > 0 ? Math.min(1, Math.max(0, scrollTop / maxScroll)) : 0

      const article = getRenderedElementById('blog-content') ?? getRenderedElementById('page-content')
      ensureObserved(article)
      const rawProgress = article ? measureArticleReading(article).progress : docProgress
      const percent = Math.min(100, Math.max(0, Math.round(rawProgress * 100)))

      // 只比一屏略长的页面（如登录 / 注册页）不弹回到顶部，避免压住底部表单操作按钮
      const showTop = maxScroll > vh * 0.65 && docProgress > threshold && scrollTop > Math.min(vh * 0.75, 420)

      const commentsEl = getRenderedElementById('comments')
      ensureObserved(commentsEl)
      const hasComments = commentsEl !== null
      let showComments = false
      let inComments = false
      if (commentsEl) {
        const offset = getScrollOffset()
        const rect = commentsEl.getBoundingClientRect()
        inComments = rect.top <= offset + 48 && rect.bottom > offset
        showComments = maxScroll > 80 && (scrollTop > 80 || rect.top > vh * 0.72)
      }

      setState((prev) => {
        if (
          prev.showTop === showTop
          && prev.hasComments === hasComments
          && prev.showComments === showComments
          && prev.inComments === inComments
          && prev.percent === percent
        ) {
          return prev
        }
        return { showTop, hasComments, showComments, inComments, percent }
      })
    }

    const schedule = () => {
      if (!frame)
        frame = requestAnimationFrame(measure)
    }

    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(schedule)
      ensureObserved(document.body)
    }

    measure()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)

    return () => {
      if (frame)
        cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      observer?.disconnect()
    }
  }, [hiddenByRoute, pathname, threshold])

  if (!mounted || hiddenByRoute || typeof document === 'undefined')
    return null

  const { showTop, hasComments, showComments, inComments, percent } = state

  const handleScrollTop = () => {
    window.scrollTo({ top: 0, behavior: preferInstantScroll() ? 'auto' : 'smooth' })
  }

  const handleScrollComments = () => {
    const el = getRenderedElementById('comments')
    if (!el)
      return
    window.scrollTo({
      top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - getScrollOffset()),
      behavior: preferInstantScroll() ? 'auto' : 'smooth',
    })
  }

  const stroke = 2.25
  const center = size / 2
  const r = Math.max(4, center - 3)
  const circumference = 2 * Math.PI * r
  const dashOffset = circumference * (1 - percent / 100)
  const topLabel = showProgress && percent > 0 ? `${t('back_to_top')} (${percent}%)` : t('back_to_top')
  const commentsLabel = t('to_comments')

  const baseButtonClass = cn(
    'group relative flex cursor-pointer items-center justify-center rounded-full select-none',
    'bg-card/85 backdrop-blur-xl supports-[backdrop-filter]:bg-card/75 dark:bg-neutral-900/80',
    'ring-1 ring-foreground/[0.08] dark:ring-white/[0.12]',
    'shadow-[0_6px_18px_-3px_rgb(0_0_0/0.12),0_2px_5px_-2px_rgb(0_0_0/0.06)] dark:shadow-[0_8px_22px_-4px_rgb(0_0_0/0.5)]',
    'transition-[opacity,transform,background-color,box-shadow,color] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
    'hover:-translate-y-0.5 hover:bg-card hover:text-primary hover:ring-primary/35 hover:shadow-[0_8px_22px_-3px_color-mix(in_oklab,var(--primary)_26%,rgb(0_0_0/0.12))] dark:hover:bg-neutral-900',
    'active:translate-y-0 active:scale-95',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  )

  return (
    <div
      className={cn(
        // 层级低于 Popover / Dropdown / Dialog 等浮层（z-50），外层透传点击事件以免空白区域挡住正文
        'pointer-events-none fixed z-40 flex flex-col items-center gap-2',
        positionClass,
        className,
      )}
    >
      <button
        onClick={handleScrollTop}
        type="button"
        aria-label={topLabel}
        title={topLabel}
        aria-hidden={!showTop}
        tabIndex={showTop ? 0 : -1}
        style={{ width: size, height: size }}
        className={cn(
          baseButtonClass,
          showProgress && percent >= 100 && 'ring-primary/30',
          showTop
            ? 'pointer-events-auto translate-y-0 scale-100 opacity-100'
            : 'pointer-events-none translate-y-2 scale-90 opacity-0',
        )}
      >
        {showProgress && (
          <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            aria-hidden
            className="pointer-events-none absolute inset-0 size-full -rotate-90"
          >
            <circle
              cx={center}
              cy={center}
              r={r}
              fill="none"
              stroke="currentColor"
              strokeWidth={stroke}
              className="text-foreground/[0.08] dark:text-white/[0.1]"
            />
            <circle
              cx={center}
              cy={center}
              r={r}
              fill="none"
              stroke="var(--primary)"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              className={cn(
                'transition-[stroke-dashoffset,opacity] duration-150 ease-out motion-reduce:transition-none',
                percent <= 0 && 'opacity-0',
              )}
            />
          </svg>
        )}
        <ArrowUpIcon
          aria-hidden
          className="size-4 stroke-[2.25] text-primary transition-transform duration-200 group-hover:-translate-y-0.5 motion-reduce:transition-none"
        />
      </button>

      {hasComments && (
        <button
          onClick={handleScrollComments}
          type="button"
          aria-label={commentsLabel}
          title={commentsLabel}
          aria-hidden={!showComments}
          tabIndex={showComments ? 0 : -1}
          style={{ width: size, height: size }}
          className={cn(
            baseButtonClass,
            inComments ? 'text-primary ring-primary/30' : 'text-foreground/75',
            showComments
              ? 'pointer-events-auto translate-y-0 scale-100 opacity-100'
              : 'pointer-events-none translate-y-2 scale-90 opacity-0',
          )}
        >
          <CommentIcon className="size-4 stroke-[2.1] transition-transform duration-200 group-hover:scale-105 motion-reduce:transition-none" />
        </button>
      )}
    </div>
  )
}
