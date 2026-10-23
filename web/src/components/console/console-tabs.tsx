'use client'

import type { SidebarItem } from './data'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * 同一菜单下多个页面之间的切换：每个 Tab 对应一个路由，切换即跳转，书签与浏览器后退保持可用
 */
export function ConsoleTabs({ items, activeId }: { items: SidebarItem[], activeId: string }) {
  const consoleT = useTranslations('Console')
  return (
    <Tabs value={activeId} className="mb-4">
      {/* 窄屏时横向滚动 */}
      <TabsList variant="underline" className="w-full justify-start overflow-x-auto">
        {items.map(item => (
          <TabsTrigger key={item.id} value={item.id} className="flex-none px-3" asChild>
            <Link href={item.url}>
              <item.icon />
              {consoleT(item.tabTitle ?? item.title)}
            </Link>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
