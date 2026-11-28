'use client'

import type { NavMenuItem } from './nav-shared'
import { PaletteIcon, SparklesIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import {
  ColorSchemeCircles,
  ThemePackSection,
  useColorScheme,
} from '@/components/common/color-scheme-picker'
import { ScrollAffordance } from '@/components/common/scroll-affordance'
import { ThemeModeToggle } from '@/components/common/theme-toggle'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useTheme } from '@/contexts/theme-context'
import { useColorSchemeName } from '@/hooks/use-color-scheme-name'
import { usePathname } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import { isActivePath, NavItemLink } from './nav-shared'

/**
 * 移动端侧边菜单（抽屉）：由顶栏的菜单按钮在第一次点按时按需加载（见 navbar-or-side.tsx 的 SidebarMenu），
 * 抽屉、配色与明暗切换的代码不进首屏包。触发按钮在顶栏里，关闭时把焦点还给它
 */
export function MobileNavSheet({ items, open, setOpen, triggerRef }: {
  items: NavMenuItem[]
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: React.RefObject<HTMLButtonElement | null>
}) {
  const routeT = useTranslations('Route')
  const pathname = usePathname() || '/'
  const [canScrollDown, setCanScrollDown] = useState(false)

  // 所有一级链接与分组子项统一使用相同 44px（h-11）盒模型与 shrink-0，配合显式 grid-cols-1 防止溢出挤压或超长标题撑宽
  const linkClass = (href: string) => cn(
    'flex h-11 min-w-0 shrink-0 items-center gap-3 rounded-lg px-3 text-base font-medium text-foreground/75 transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    isActivePath(pathname, href) && 'bg-primary/10 font-semibold text-secondary-foreground hover:text-secondary-foreground',
  )

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        className="z-999999 w-76 max-w-[calc(100vw-2.5rem)] gap-0 pt-6"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          triggerRef.current?.focus()
        }}
      >
        <SheetTitle className="shrink-0 px-5 pb-2 text-lg font-bold">{routeT('menu')}</SheetTitle>

        <ScrollAffordance
          surface="background"
          overscrollContain
          moreHintLabel={routeT('scroll_more')}
          onStateChange={s => setCanScrollDown(s.canScrollDown)}
          className="min-h-0 flex-1"
          viewportClassName="h-full px-3"
        >
          <nav aria-label={routeT('menu')} className="grid grid-cols-1 gap-1 py-1 pb-3">
            {items.map(item =>
              item.href
                ? (
                    <NavItemLink
                      key={item.title}
                      href={item.href}
                      external={item.external}
                      openInNewTab={item.openInNewTab}
                      noPrefetch={item.noPrefetch}
                      aria-current={isActivePath(pathname, item.href) ? 'page' : undefined}
                      className={linkClass(item.href)}
                      onClick={() => setOpen(false)}
                    >
                      {item.icon && <item.icon aria-hidden className="size-5 shrink-0" />}
                      <span className="truncate">{item.label ?? routeT(item.title)}</span>
                    </NavItemLink>
                  )
                : item.children
                  ? (
                      <div key={item.title} className="mt-2 grid min-w-0 grid-cols-1 gap-1">
                        <div className="px-3 py-1 text-xs font-medium text-muted-foreground">{item.label ?? routeT(item.title)}</div>
                        {item.children.map(child => (
                          <NavItemLink
                            key={child.title}
                            href={child.href}
                            external={child.external}
                            openInNewTab={child.openInNewTab}
                            noPrefetch={child.noPrefetch}
                            aria-current={isActivePath(pathname, child.href) ? 'page' : undefined}
                            className={linkClass(child.href)}
                            onClick={() => setOpen(false)}
                          >
                            {child.icon && <child.icon aria-hidden className="size-5 shrink-0" />}
                            <span className="truncate">{child.label ?? routeT(child.title)}</span>
                          </NavItemLink>
                        ))}
                      </div>
                    )
                  : null,
            )}
          </nav>
        </ScrollAffordance>

        <div
          className={cn(
            'shrink-0 border-t border-border/80 bg-background px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-shadow duration-150',
            canScrollDown && 'shadow-[0_-6px_16px_-6px_rgba(15,23,42,0.08)] dark:shadow-[0_-8px_20px_-6px_rgba(0,0,0,0.45)]',
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <MobileColorSchemeButton sheetOpen={open} />
            <ThemeModeToggle showSegmented compact className="shrink-0" />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/**
 * 移动端侧边栏紧凑颜色主题触发按钮：
 * - 常态仅展示「当前主题圆点 + 配色名称 + 调色盘图标」单按钮，释放纵向菜单可视高度
 * - 点击使用项目内建 Popover 组件向上弹出完整色板与节日主题开关（z-index 高于抽屉）
 */
function MobileColorSchemeButton({ sheetOpen }: { sheetOpen: boolean }) {
  const t = useTranslations('ColorScheme')
  const schemeName = useColorSchemeName()
  const { color, colorSchemes, selectColor } = useColorScheme()
  const { theme } = useTheme()
  const [popoverOpen, setPopoverOpen] = useState(false)

  useEffect(() => {
    if (!sheetOpen)
      setPopoverOpen(false)
  }, [sheetOpen])

  const currentLabel = schemeName(color)

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${t('title')}: ${currentLabel}`}
          title={`${t('title')}: ${currentLabel}`}
          className="inline-flex h-11 min-w-0 flex-1 cursor-pointer items-center justify-between gap-1.5 rounded-lg bg-muted px-2.5 text-xs font-medium text-foreground/85 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              data-user-color={color}
              aria-hidden
              className="size-4 shrink-0 rounded-full bg-primary ring-2 ring-card shadow-xs"
            />
            <span className="truncate">{currentLabel}</span>
          </span>
          {theme
            ? <SparklesIcon aria-hidden className="size-3.5 shrink-0 text-primary" />
            : <PaletteIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={10}
        collisionPadding={12}
        className="z-1000000 w-64 max-w-[calc(100vw-1.5rem)] rounded-2xl p-3.5 shadow-xl"
      >
        <div className="pb-2.5 text-xs font-medium text-muted-foreground">{t('title')}</div>
        <ColorSchemeCircles
          color={color}
          colorSchemes={colorSchemes}
          onSelect={selectColor}
        />
        <ThemePackSection />
      </PopoverContent>
    </Popover>
  )
}
