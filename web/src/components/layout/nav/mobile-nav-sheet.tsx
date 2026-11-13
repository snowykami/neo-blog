'use client'

import type { NavMenuItem } from './nav-shared'
import { useTranslations } from 'next-intl'
import {
  ColorSchemeCircles,
  ThemePackSection,
  useColorScheme,
} from '@/components/common/color-scheme-picker'
import { ThemeModeToggle } from '@/components/common/theme-toggle'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Link, usePathname } from '@/i18n/navigation'
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
  const linkClass = (href: string) => cn(
    'flex h-11 items-center gap-3 rounded-lg px-3 font-medium text-foreground/75 transition-colors hover:bg-primary/10 hover:text-primary',
    isActivePath(pathname, href) && 'bg-primary/10 text-primary',
  )
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        className="z-999999 w-72 gap-0 pt-6"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          triggerRef.current?.focus()
        }}
      >
        <SheetTitle className="px-5 pb-2 text-lg font-bold">{routeT('menu')}</SheetTitle>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3">
          {items.map(item =>
            item.href
              ? (
                  <Link
                    key={item.title}
                    href={item.href}
                    aria-current={isActivePath(pathname, item.href) ? 'page' : undefined}
                    className={linkClass(item.href)}
                    onClick={() => setOpen(false)}
                  >
                    <item.icon aria-hidden className="size-5" />
                    {item.label ?? routeT(item.title)}
                  </Link>
                )
              : item.children
                ? (
                    <div key={item.title} className="mt-2 grid gap-1">
                      <div className="px-3 py-1 text-sm font-medium text-muted-foreground">{item.label ?? routeT(item.title)}</div>
                      {item.children.map(child => (
                        <NavItemLink
                          key={child.title}
                          href={child.href}
                          external={child.external}
                          aria-current={isActivePath(pathname, child.href) ? 'page' : undefined}
                          className={linkClass(child.href)}
                          onClick={() => setOpen(false)}
                        >
                          <child.icon aria-hidden className="size-5" />
                          <span className="truncate">{child.label ?? routeT(child.title)}</span>
                        </NavItemLink>
                      ))}
                    </div>
                  )
                : null,
          )}
        </nav>

        <div className="grid gap-4 border-t p-4">
          <SidebarColorSchemes />
          <div className="flex items-center justify-center">
            <ThemeModeToggle showSegmented={true} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// 移动端侧边菜单内的配色切换：直接展示圆形色块，避免弹层套弹层
function SidebarColorSchemes() {
  const t = useTranslations('ColorScheme')
  const { color, colorSchemes, selectColor } = useColorScheme()
  return (
    <div className="grid gap-2">
      <div className="text-xs font-medium text-muted-foreground">{t('title')}</div>
      <ColorSchemeCircles color={color} colorSchemes={colorSchemes} onSelect={selectColor} />
      <ThemePackSection />
    </div>
  )
}
