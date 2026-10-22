'use client'

import type { TocHeading } from '@/models/toc'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { SidebarCard } from '@/components/blog-sidebar/sidebar-card'
import { cn } from '@/lib/utils'

// 滚动到标题时预留导航栏高度（CSS 变量 --nav-h）与 1rem 间距
function getScrollOffset() {
  const style = getComputedStyle(document.documentElement)
  const rem = Number.parseFloat(style.fontSize) || 16
  const navH = Number.parseFloat(style.getPropertyValue('--nav-h')) || 4.5
  return (navH + 1) * rem
}

/**
 * 文章目录：标题 id 由服务端注入，这里负责高亮当前阅读位置与平滑滚动
 * 少于 2 个标题时不显示
 */
export function PostToc({ headings, className }: { headings: TocHeading[], className?: string }) {
  const t = useTranslations('Common')
  const [activeId, setActiveId] = useState<string | null>(headings[0]?.id ?? null)

  useEffect(() => {
    if (headings.length < 2)
      return
    const elements = headings
      .map(heading => document.getElementById(heading.id))
      .filter((el): el is HTMLElement => !!el)
    if (elements.length === 0)
      return

    // 取最后一个已滚过视口顶部（含偏移）的标题作为当前项
    const update = () => {
      const offset = getScrollOffset()
      let current = elements[0].id
      for (const el of elements) {
        if (el.getBoundingClientRect().top - offset - 1 <= 0)
          current = el.id
        else
          break
      }
      setActiveId(current)
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [headings])

  if (headings.length < 2)
    return null

  // 以最浅的标题层级为基准缩进
  const minLevel = Math.min(...headings.map(heading => heading.level))

  const scrollTo = (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    const el = document.getElementById(id)
    if (!el)
      return
    event.preventDefault()
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - getScrollOffset(), behavior: 'smooth' })
    window.history.replaceState(null, '', `#${encodeURIComponent(id)}`)
    setActiveId(id)
  }

  // 顶层标题编号，便于在长目录中定位
  let topIndex = 0
  return (
    <SidebarCard title={t('table_of_contents')} className={className}>
      <nav aria-label={t('table_of_contents')} className="-mx-1 max-h-[calc(100dvh-var(--nav-h)-8rem)] overflow-y-auto px-1 hide-scrollbar">
        <ul className="grid gap-0.5 text-sm">
          {headings.map((heading) => {
            const isTop = heading.level === minLevel
            if (isTop)
              topIndex += 1
            const active = activeId === heading.id
            return (
              <li key={heading.id} style={{ paddingLeft: `${(heading.level - minLevel) * 0.75}rem` }}>
                <a
                  href={`#${heading.id}`}
                  onClick={e => scrollTo(e, heading.id)}
                  aria-current={active ? 'location' : undefined}
                  className={cn(
                    'flex min-h-9 items-center gap-2 rounded-lg px-2 py-1.5 transition-colors duration-150 hover:bg-primary/10 hover:text-primary',
                    active ? 'bg-primary/10 font-medium text-primary' : 'text-foreground/75',
                  )}
                  title={heading.text}
                >
                  {isTop
                    ? (
                        <span
                          aria-hidden
                          className={cn(
                            'flex size-5 shrink-0 items-center justify-center rounded-md text-xs font-bold tabular-nums',
                            active ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground',
                          )}
                        >
                          {topIndex}
                        </span>
                      )
                    : <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', active ? 'bg-primary' : 'bg-foreground/20')} />}
                  <span className="truncate">{heading.text}</span>
                </a>
              </li>
            )
          })}
        </ul>
      </nav>
    </SidebarCard>
  )
}
