'use client'

import type { LucideIcon } from 'lucide-react'
import type { PageModel } from '@/models/page'
import {
  ArchiveIcon,
  FileTextIcon,
  FolderIcon,
  HouseIcon,
  MenuIcon,
  NewspaperIcon,
  PanelsTopLeftIcon,
  RssIcon,
  ShuffleIcon,
  TagsIcon,
} from 'lucide-react'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { listPages } from '@/api/page'
import { ThemeModeToggle } from '@/components/common/theme-toggle'
import { AvatarWithDropdownMenu } from '@/components/layout/nav/avatar-with-dropdown-menu'
import { NavSearch } from '@/components/layout/nav/nav-search'
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from '@/components/ui/navigation-menu'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useNav } from '@/contexts/nav-context'
import { useSiteInfo } from '@/contexts/site-info-context'
import { cn } from '@/lib/utils'
import { getPageUrl, mainPath } from '@/utils/common/route'

// 菜单项：title 为 Route 命名空间下的翻译键；label 为已确定的显示文本（如自定义页面标题），优先于 title
interface NavLinkItem {
  title: string
  label?: string
  href: string
  icon: LucideIcon
}

// 一级菜单：带 href 的直接跳转，带 children 的展开子菜单
interface NavMenuItem extends Omit<NavLinkItem, 'href'> {
  href?: string
  children?: NavLinkItem[]
}

const staticMenuItems: NavMenuItem[] = [
  {
    title: 'homepage',
    href: '/',
    icon: HouseIcon,
  },
  {
    title: 'post',
    icon: NewspaperIcon,
    children: [
      {
        title: 'archive',
        href: mainPath.archive,
        icon: ArchiveIcon,
      },
      {
        title: 'category',
        href: mainPath.category,
        icon: FolderIcon,
      },
      {
        title: 'label',
        href: mainPath.label,
        icon: TagsIcon,
      },
      {
        title: 'random',
        href: mainPath.random,
        icon: ShuffleIcon,
      },
    ],
  },
]

// 导航中展示的自定义页面：只取公开且勾选了「导航展示」的页面，按导航排序升序
function useNavPages() {
  const [pages, setPages] = useState<PageModel[]>([])
  useEffect(() => {
    let cancelled = false
    listPages({ onlyNav: true, noContent: true, page: 1, size: 50 })
      .then((res) => {
        if (cancelled)
          return
        const navPages = (res.data.pages || [])
          .filter(page => page.showInNav && !page.isPrivate)
          .sort((a, b) => a.navOrder - b.navOrder || a.id - b.id)
        setPages(navPages)
      })
      .catch(() => { })
    return () => {
      cancelled = true
    }
  }, [])
  return pages
}

// 合并静态菜单与自定义页面菜单；没有页面时不显示「页面」菜单
function useNavMenuItems(): NavMenuItem[] {
  const pages = useNavPages()
  return useMemo(() => {
    if (pages.length === 0)
      return staticMenuItems
    return [
      ...staticMenuItems,
      {
        title: 'page',
        icon: PanelsTopLeftIcon,
        children: pages.map(page => ({
          title: `page-${page.id}`,
          label: page.title,
          href: getPageUrl(page),
          icon: FileTextIcon,
        })),
      },
    ]
  }, [pages])
}

// 导航中的图标按钮：移动端点击区域 ≥ 44px，悬停浅主色底
const navIconButtonClass = 'inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-foreground/75 transition-[color,background-color,transform] duration-150 hover:bg-primary/10 hover:text-primary active:scale-[.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer'

// 一级菜单项：当前路由高亮
const navItemClass = 'inline-flex h-11 items-center gap-2 rounded-lg px-4 font-medium text-foreground/75 transition-[color,background-color,transform] duration-150 hover:bg-primary/10 hover:text-primary active:scale-[.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer'
const navItemActiveClass = 'bg-primary/10 text-primary'

// 判断菜单项是否对应当前路由：首页精确匹配，其余按路径前缀匹配
function isActivePath(pathname: string, href: string) {
  if (href === '/')
    return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

// 页面滚动后导航卡片加一点阴影，与正文区分
function useScrolled(threshold = 8) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > threshold)
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [threshold])
  return scrolled
}

export default function Navbar() {
  const { siteInfo } = useSiteInfo()
  const routeT = useTranslations('Route')
  const { navTitle, navIcon } = useNav()
  const menuItems = useNavMenuItems()
  const scrolled = useScrolled()
  const navTitleKey = typeof navTitle === 'string' ? navTitle || siteInfo.metadata.name : 'custom-nav-title'
  return (
    <nav
      className={cn(
        'flex h-[var(--nav-h)] w-full items-center gap-2 rounded-b-2xl bg-card px-2 md:px-4',
        scrolled && 'shadow-sm',
      )}
    >
      {/* 左侧：站名，min-w-0 保证在 flex 收缩时文本能 truncate */}
      <div className="flex min-w-0 flex-1 items-center">
        <Link
          href="/"
          className="flex h-11 min-w-0 items-center gap-2 rounded-lg px-2 text-lg font-bold max-[359px]:text-base sm:px-3 text-primary transition-[background-color,transform] duration-150 hover:bg-primary/10 active:scale-[.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* 窄屏省略图标，把空间留给站名 */}
          <span className="nav-fade hidden shrink-0 items-center justify-center sm:flex">
            {navIcon}
          </span>
          {/* 移动端不限制宽度，尽量完整显示站名；空间仍不足时再省略 */}
          <span key={navTitleKey} className="nav-fade truncate md:max-w-[28ch] lg:max-w-[36ch]">
            {navTitle || siteInfo.metadata.name}
          </span>
        </Link>
        {/* 标题变化时（如音乐播放器替换为歌词）重新挂载并淡入，仅透明度过渡 */}
        <style>
          {`
          @keyframes navFade { from { opacity: 0; } to { opacity: 1; } }
          @media (prefers-reduced-motion: no-preference) { .nav-fade { animation: navFade 300ms ease-out; } }
          `}
        </style>
      </div>

      {/* 中间：主菜单，仅 md 及以上显示 */}
      <div className="hidden shrink-0 items-center md:flex">
        <NavMenuCenter items={menuItems} />
      </div>

      {/* 右侧：搜索、明暗切换、RSS、用户；明暗切换与 RSS 在移动端收进侧边菜单
       * 移动端只占按钮所需宽度，把剩余空间让给站名；md 及以上与左侧等分，保证主菜单居中 */}
      <div className="flex flex-none items-center justify-end md:min-w-0 md:flex-1">
        <NavSearch className={navIconButtonClass} />
        <ThemeModeToggle className={cn(navIconButtonClass, 'hidden md:inline-flex')} />
        <Link
          href={mainPath.feed}
          className={cn(navIconButtonClass, 'hidden md:inline-flex')}
          target="_blank"
          aria-label={routeT('rss')}
          title={routeT('rss')}
        >
          <RssIcon aria-hidden className="size-5" />
        </Link>
        <AvatarWithDropdownMenu className={navIconButtonClass} />
        <SidebarMenu items={menuItems} />
      </div>
    </nav>
  )
}

function NavMenuCenter({ items }: { items: NavMenuItem[] }) {
  const routeT = useTranslations('Route')
  const pathname = usePathname() || '/'
  // 受控的当前展开菜单：悬停打开后再点击触发器不应把子菜单关掉（Radix 默认点击会切换开关）
  const [openMenu, setOpenMenu] = useState('')
  return (
    <NavigationMenu viewport={false} value={openMenu} onValueChange={setOpenMenu}>
      <NavigationMenuList className="gap-1" key="navbar-menu">
        {items.map((item) => {
          const active = item.href
            ? isActivePath(pathname, item.href)
            : !!item.children?.some(child => isActivePath(pathname, child.href))
          return (
            <NavigationMenuItem key={item.title} id={item.title} value={item.title}>
              {item.href
                ? (
                  // 使用带 href 的真实链接：可点击光标、支持中键/新标签页打开与预取；
                  // 不包 NavigationMenuLink，避免其默认样式与这里的样式冲突
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(navItemClass, active && navItemActiveClass)}
                    >
                      <item.icon aria-hidden className="size-5" />
                      <span>{item.label ?? routeT(item.title)}</span>
                    </Link>
                  )
                : item.children
                  ? (
                      <>
                        <NavigationMenuTrigger
                          className={cn(
                            navItemClass,
                            'bg-transparent text-base focus:bg-primary/10 focus:text-primary data-[state=open]:bg-primary/10 data-[state=open]:text-primary data-[state=open]:hover:bg-primary/10 data-[state=open]:focus:bg-primary/10',
                            active && navItemActiveClass,
                          )}
                          onClick={(e) => {
                          // 鼠标点击已展开的菜单时保持展开；键盘触发（detail 为 0）仍可切换
                            if (e.detail > 0 && openMenu === item.title)
                              e.preventDefault()
                          }}
                        >
                          <item.icon aria-hidden className="size-5" />
                          <span>{item.label ?? routeT(item.title)}</span>
                        </NavigationMenuTrigger>
                        <NavigationMenuContent className="rounded-xl! p-1.5 shadow-lg!">
                          <ul className="grid min-w-40 gap-0.5">
                            {item.children.map((child) => {
                              const childActive = isActivePath(pathname, child.href)
                              return (
                                <li key={child.title}>
                                  <NavigationMenuLink asChild>
                                    <Link
                                      href={child.href}
                                      aria-current={childActive ? 'page' : undefined}
                                      className={cn(
                                        'flex-row! items-center gap-2! rounded-lg! px-3 py-2 text-sm font-medium text-foreground/75 hover:bg-primary/10! hover:text-primary! focus:bg-primary/10! focus:text-primary!',
                                        childActive && 'bg-primary/10 text-primary',
                                      )}
                                    >
                                      <child.icon aria-hidden className="size-4 text-current!" />
                                      <span className="truncate">{child.label ?? routeT(child.title)}</span>
                                    </Link>
                                  </NavigationMenuLink>
                                </li>
                              )
                            })}
                          </ul>
                        </NavigationMenuContent>
                      </>
                    )
                  : null}
            </NavigationMenuItem>
          )
        })}
      </NavigationMenuList>
    </NavigationMenu>
  )
}

function SidebarMenu({ items }: { items: NavMenuItem[] }) {
  const [open, setOpen] = useState(false)
  const routeT = useTranslations('Route')
  const pathname = usePathname() || '/'
  const linkClass = (href: string) => cn(
    'flex h-11 items-center gap-3 rounded-lg px-3 font-medium text-foreground/75 transition-colors hover:bg-primary/10 hover:text-primary',
    isActivePath(pathname, href) && 'bg-primary/10 text-primary',
  )
  return (
    <div className="flex md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button
            type="button"
            aria-label={routeT('menu')}
            title={routeT('menu')}
            className={navIconButtonClass}
          >
            <MenuIcon aria-hidden className="size-5" />
          </button>
        </SheetTrigger>
        <SheetContent side="right" className="z-999999 w-72 gap-0 pt-6">
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
                        <div className="px-3 py-1 text-sm font-medium text-foreground/50">{item.label ?? routeT(item.title)}</div>
                        {item.children.map(child => (
                          <Link
                            key={child.title}
                            href={child.href}
                            aria-current={isActivePath(pathname, child.href) ? 'page' : undefined}
                            className={linkClass(child.href)}
                            onClick={() => setOpen(false)}
                          >
                            <child.icon aria-hidden className="size-5" />
                            <span className="truncate">{child.label ?? routeT(child.title)}</span>
                          </Link>
                        ))}
                      </div>
                    )
                  : null,
            )}
            <div className="mt-2 grid gap-1 border-t border-dashed pt-3">
              <Link href={mainPath.feed} className={linkClass(mainPath.feed)} onClick={() => setOpen(false)}>
                <RssIcon aria-hidden className="size-5" />
                {routeT('rss')}
              </Link>
            </div>
          </nav>

          <div className="flex items-center justify-center border-t p-4">
            <ThemeModeToggle showSegmented={true} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
