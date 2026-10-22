'use client'

import type { TocHeading } from '@/models/toc'
import { ListTreeIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { navHeightPx } from '@/utils/common/layout-size'

// 滚动到标题时预留导航栏高度与一点间距
const SCROLL_OFFSET = navHeightPx + 16

/**
 * 文章目录：标题 id 由服务端注入，这里负责高亮当前阅读位置与平滑滚动
 * 少于 2 个标题时不显示
 */
export function PostToc({ headings }: { headings: TocHeading[] }) {
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
      let current = elements[0].id
      for (const el of elements) {
        if (el.getBoundingClientRect().top - SCROLL_OFFSET - 1 <= 0)
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
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - SCROLL_OFFSET, behavior: 'smooth' })
    window.history.replaceState(null, '', `#${encodeURIComponent(id)}`)
    setActiveId(id)
  }

  return (
    <Card className="hidden lg:flex">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListTreeIcon className="w-5 h-5 text-primary" />
          {t('table_of_contents')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <nav aria-label={t('table_of_contents')} className="max-h-[50vh] overflow-y-auto hide-scrollbar">
          <ul className="grid gap-1 text-sm">
            {headings.map(heading => (
              <li key={heading.id} style={{ paddingLeft: `${(heading.level - minLevel) * 0.75}rem` }}>
                <a
                  href={`#${heading.id}`}
                  onClick={e => scrollTo(e, heading.id)}
                  aria-current={activeId === heading.id ? 'location' : undefined}
                  className={cn(
                    'block truncate rounded-md border-l-2 px-2 py-1 transition-colors hover:bg-accent/50 hover:text-primary',
                    activeId === heading.id
                      ? 'border-primary text-primary font-medium'
                      : 'border-transparent text-muted-foreground',
                  )}
                  title={heading.text}
                >
                  {heading.text}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </CardContent>
    </Card>
  )
}
