'use client'

import type { TocHeading } from '@/models/toc'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { SidebarCard } from '@/components/blog-sidebar/sidebar-card'
import { cn } from '@/lib/utils'

// 滚动到标题时预留导航栏高度（CSS 变量 --nav-h）与 1rem 间距；顶栏灵动岛的阅读进度与迷你目录也用它
export function getScrollOffset() {
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
  // 点击目录后锁定高亮，直到平滑滚动停止，避免途经的标题依次闪烁
  const lockedRef = useRef(false)
  const unlockTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

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
      if (lockedRef.current) {
        // 滚动仍在进行，顺延解锁；停止滚动 150ms 后才恢复跟随
        clearTimeout(unlockTimerRef.current)
        unlockTimerRef.current = setTimeout(() => {
          lockedRef.current = false
        }, 150)
        return
      }
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
    // 用户手动滚动时立即解除锁定，恢复跟随阅读位置
    const unlock = () => {
      lockedRef.current = false
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    window.addEventListener('wheel', unlock, { passive: true })
    window.addEventListener('touchstart', unlock, { passive: true })
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      window.removeEventListener('wheel', unlock)
      window.removeEventListener('touchstart', unlock)
      clearTimeout(unlockTimerRef.current)
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
    setActiveId(id)
    lockedRef.current = true
    // 目标已在当前位置时不会触发滚动事件，兜底解锁
    clearTimeout(unlockTimerRef.current)
    unlockTimerRef.current = setTimeout(() => {
      lockedRef.current = false
    }, 300)
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - getScrollOffset(), behavior: 'smooth' })
    window.history.replaceState(null, '', `#${encodeURIComponent(id)}`)
  }

  // 顶层标题编号，便于在长目录中定位
  let topIndex = 0
  return (
    <SidebarCard title={t('table_of_contents')} className={className}>
      {/* 目录只上下滚动：grid 的隐式列默认按内容的最宽处撑开（长标题是一整段不换行的文本），列宽要显式夹在卡片内，
          否则整块目录能左右滑、长标题也省略不掉；触摸时横向的拖动不交给浏览器 */}
      <nav aria-label={t('table_of_contents')} className="-mx-1 max-h-[calc(100dvh-var(--nav-h)-8rem)] touch-pan-y overflow-x-hidden overflow-y-auto overscroll-x-none px-1 hide-scrollbar">
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-0.5 text-sm">
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
                    'flex w-full items-start gap-2 rounded-lg px-2 py-2 transition-colors duration-150 hover:bg-primary/10 hover:text-primary',
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
                    : <span aria-hidden className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', active ? 'bg-primary' : 'bg-foreground/20')} />}
                  {/* 侧栏窄，一行只放得下十来个汉字：留两行再省略，既不会一条标题占满整块目录，也不用只靠 title 提示 */}
                  <span className="line-clamp-2 min-w-0">{heading.text}</span>
                </a>
              </li>
            )
          })}
        </ul>
      </nav>
    </SidebarCard>
  )
}
