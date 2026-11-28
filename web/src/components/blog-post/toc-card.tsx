'use client'

import type { TocHeading } from '@/models/toc'
import { useEffect, useRef } from 'react'
import { SidebarCard } from '@/components/blog-sidebar/sidebar-card'
import { cn } from '@/lib/utils'
import { isElementRendered } from '@/utils/client/dom'

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export interface TocCardProps {
  ref?: React.Ref<HTMLElement>
  title: React.ReactNode
  ariaLabel: string
  headings: TocHeading[]
  activeId: string | null
  onSelect: (heading: TocHeading, index: number, event: React.MouseEvent<HTMLElement>) => void
  /** 提供时渲染为 `<a href=...>`（前台文章页保留原生锚点与右键复制链接），不提供时渲染为 `<button type="button">`（编辑器内跳转） */
  getItemHref?: (heading: TocHeading, index: number) => string | undefined
  className?: string
  navClassName?: string
}

/**
 * 文章与编辑器共用的目录卡片视图：
 * 复用 SidebarCard 外壳、顶层标题编号徽标、子级圆点缩进、两行截断与当前激活项在目录容器内的自动居中滚动。
 * 少于 2 个标题时不渲染。
 */
export function TocCard({
  ref,
  title,
  ariaLabel,
  headings,
  activeId,
  onSelect,
  getItemHref,
  className,
  navClassName = 'max-h-[calc(100dvh-var(--nav-h)-8rem)]',
}: TocCardProps) {
  const navRef = useRef<HTMLElement>(null)

  // 当前激活项变化时，在可见的目录容器内柔和滚入可视区（只滚目录自身，不干扰正文或编辑区滚动）
  useEffect(() => {
    if (!activeId)
      return
    const nav = navRef.current
    if (!nav || !isElementRendered(nav))
      return
    const activeItem = nav.querySelector<HTMLElement>('[aria-current="location"]')
    if (!activeItem)
      return
    const navRect = nav.getBoundingClientRect()
    const itemRect = activeItem.getBoundingClientRect()
    const padding = 24
    if (itemRect.top >= navRect.top + padding && itemRect.bottom <= navRect.bottom - padding)
      return
    const targetTop = nav.scrollTop + (itemRect.top - navRect.top) - (nav.clientHeight - itemRect.height) / 2
    nav.scrollTo({
      top: Math.max(0, targetTop),
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
  }, [activeId])

  if (headings.length < 2)
    return null

  // 以最浅的标题层级为基准缩进
  const minLevel = Math.min(...headings.map(heading => heading.level))

  // 顶层标题编号，便于在长目录中定位
  let topIndex = 0

  return (
    <SidebarCard ref={ref} title={title} className={className}>
      {/* 目录只上下滚动：grid 的隐式列默认按内容的最宽处撑开，列宽显式夹在卡片内，防止长标题撑宽横向滚动 */}
      <nav
        ref={navRef}
        aria-label={ariaLabel}
        className={cn(
          '-mx-1 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-x-none px-1 hide-scrollbar',
          navClassName,
        )}
      >
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-0.5 text-sm">
          {headings.map((heading, index) => {
            const isTop = heading.level === minLevel
            if (isTop)
              topIndex += 1
            const active = activeId === heading.id
            const href = getItemHref?.(heading, index)
            const itemClassName = cn(
              'flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors duration-150 hover:bg-primary/10 hover:text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active ? 'bg-primary/10 font-semibold text-secondary-foreground' : 'text-foreground/75',
            )
            const content = (
              <>
                {isTop
                  ? (
                      <span
                        aria-hidden
                        className={cn(
                          'flex size-5 shrink-0 items-center justify-center rounded-md text-xs font-bold tabular-nums',
                          active ? 'bg-primary text-white dark:text-primary-foreground' : 'bg-secondary text-secondary-foreground',
                        )}
                      >
                        {topIndex}
                      </span>
                    )
                  : <span aria-hidden className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', active ? 'bg-primary' : 'bg-foreground/20')} />}
                {/* 侧栏窄，一行只放得下十来个汉字：留两行再省略，既不会一条标题占满整块目录，也不用只靠 title 提示 */}
                <span className="line-clamp-2 min-w-0">{heading.text}</span>
              </>
            )

            return (
              <li key={heading.id} style={{ paddingLeft: `${(heading.level - minLevel) * 0.75}rem` }}>
                {href !== undefined
                  ? (
                      <a
                        href={href}
                        onClick={e => onSelect(heading, index, e)}
                        aria-current={active ? 'location' : undefined}
                        className={itemClassName}
                        title={heading.text}
                      >
                        {content}
                      </a>
                    )
                  : (
                      <button
                        type="button"
                        onClick={e => onSelect(heading, index, e)}
                        aria-current={active ? 'location' : undefined}
                        className={itemClassName}
                        title={heading.text}
                      >
                        {content}
                      </button>
                    )}
              </li>
            )
          })}
        </ul>
      </nav>
    </SidebarCard>
  )
}
