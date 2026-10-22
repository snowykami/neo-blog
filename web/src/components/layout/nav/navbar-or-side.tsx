'use client'

import type { LucideIcon } from 'lucide-react'
import type { PageModel } from '@/models/page'
import {
  ArchiveIcon,
  FileTextIcon,
  FolderIcon,
  HouseIcon,
  NewspaperIcon,
  PanelRight,
  PanelsTopLeftIcon,
  RssIcon,
  ShuffleIcon,
  TagsIcon,
} from 'lucide-react'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
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
  navigationMenuTriggerStyle,
} from '@/components/ui/navigation-menu'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useNav } from '@/contexts/nav-context'
import { useSiteInfo } from '@/contexts/site-info-context'
import { useIsMobile } from '@/hooks/use-mobile'
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
      .catch(() => {})
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

export default function Navbar() {
  const { siteInfo } = useSiteInfo()
  const isMobile = useIsMobile()
  const { navClassName, navTitle, navIcon } = useNav()
  const menuItems = useNavMenuItems()
  const navTitleKey = typeof navTitle === 'string' ? navTitle || siteInfo.metadata.name : 'custom-nav-title'
  return (
    <div className={cn('flex items-center w-full max-w-screen px-4', navClassName)}>
      {/* 左侧：等分 1/3，min-w-0 保证在 flex 收缩时文本能 truncate */}
      <div className="flex-1 min-w-0 flex items-center ">
        <span className="font-bold text-lg">
          <Link href="/" className="flex items-center text-primary gap-1">
            <span
              className="flex items-center justify-center"
              style={{ animation: 'navFade 500ms ease' }}
            >
              {navIcon}
            </span>
            <span
              key={navTitleKey}
              className="inline-block truncate max-w-[20ch] md:max-w-[28ch] lg:max-w-[36ch]"
              style={{ animation: 'navFade 500ms ease' }}
            >

              {navTitle || siteInfo.metadata.name}
            </span>
          </Link>
        </span>

        {/* 局部 keyframes：每次 key 变化都会触发新的元素挂载，从而执行动画（仅透明度过渡） */}
        <style>
          {`
          @keyframes navFade {
          from { opacity: 0; }
          to   { opacity: 1; }
          }
          `}
        </style>
      </div>

      {/* 中间：等分 1/3，内容居中；在小屏隐藏（内部再用 hidden md:flex） */}
      <div className="flex-1 flex items-center justify-center">
        <div className="hidden md:flex items-center">
          <NavMenuCenter items={menuItems} />
        </div>
      </div>

      {/* 右侧：等分 1/3，min-w-0，内容靠右 */}
      <div className="flex-1 min-w-0 flex items-center justify-end gap-2 md:gap-4">
        {[
          <AvatarWithDropdownMenu key="a8d92h1" />,
          <NavSearch key="a8d92h0" />,
          ...(isMobile
            ? []
            : [
                <ThemeModeToggle key="a8d92h2" />,
                <Link href="/rss.xml" className="flex items-center justify-center" key="a8d92h3">
                  <RssIcon className="w-6 h-6 text-primary" />
                </Link>,
              ]),
        ].map((Comp, index) => (
          <div
            key={index}
            className="flex items-center gap-2 justify-center h-8 w-8 rounded-lg hover:bg-accent/50 text-primary cursor-pointer"
          >
            {Comp}
          </div>
        ))}
        <SidebarMenu items={menuItems} />
      </div>
    </div>
  )
}

function NavMenuCenter({ items }: { items: NavMenuItem[] }) {
  const routeT = useTranslations('Route')
  // 受控的当前展开菜单：悬停打开后再点击触发器不应把子菜单关掉（Radix 默认点击会切换开关）
  const [openMenu, setOpenMenu] = useState('')
  return (
    <NavigationMenu viewport={false} value={openMenu} onValueChange={setOpenMenu}>
      <NavigationMenuList className="flex space-x-1" key="navbar-menu">
        {items.map(item => (
          <NavigationMenuItem key={item.title} id={item.title} value={item.title}>
            {item.href
              ? (
                // 使用带 href 的真实链接：可点击光标、支持中键/新标签页打开与预取
                  <NavigationMenuLink asChild>
                    <Link
                      href={item.href}
                      className={cn(
                        navigationMenuTriggerStyle(),
                        'font-extrabold text-lg bg-transparent',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <item.icon className="!w-6 !h-6 text-inherit" />
                        <span>{item.label ?? routeT(item.title)}</span>
                      </div>
                    </Link>
                  </NavigationMenuLink>
                )
              : item.children
                ? (
                    <>
                      {/* Trigger 是 button，Tailwind v4 默认不再给 button 设置可点击光标 */}
                      <NavigationMenuTrigger
                        className={cn(
                          navigationMenuTriggerStyle(),
                          'font-extrabold text-lg bg-transparent cursor-pointer',
                        )}
                        onClick={(e) => {
                          // 鼠标点击已展开的菜单时保持展开；键盘触发（detail 为 0）仍可切换
                          if (e.detail > 0 && openMenu === item.title)
                            e.preventDefault()
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <item.icon className="w-6 h-6" />
                          <span>{item.label ?? routeT(item.title)}</span>
                        </div>
                      </NavigationMenuTrigger>
                      <NavigationMenuContent>
                        <ul className="grid gap-2 p-0 min-w-auto max-w-[600px] grid-cols-[repeat(auto-fit,minmax(120px,1fr))]">
                          {item.children.map(child => (
                            <li key={child.title}>
                              <NavigationMenuLink asChild>
                                <Link
                                  href={child.href}
                                  className={cn(
                                    navigationMenuTriggerStyle(),
                                    'font-extrabold bg-transparent',
                                    'flex flex-col items-center text-center w-full',
                                  )}
                                >
                                  <div className="flex items-center gap-2">
                                    <child.icon className="w-6 h-6" />
                                    {child.label ?? routeT(child.title)}
                                  </div>
                                </Link>
                              </NavigationMenuLink>
                            </li>
                          ))}
                        </ul>
                      </NavigationMenuContent>
                    </>
                  )
                : null}
          </NavigationMenuItem>
        ))}
      </NavigationMenuList>
    </NavigationMenu>
  )
}

function SidebarMenu({ items }: { items: NavMenuItem[] }) {
  const [open, setOpen] = useState(false)
  const routeT = useTranslations('Route')
  return (
    <div className="flex md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button
            type="button"
            aria-label={routeT('menu')}
            className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-accent/50 transition-all duration-200 text-primary cursor-pointer"
          >
            <PanelRight aria-hidden className="w-6 h-6 text-primary" />
          </button>
        </SheetTrigger>
        <SheetContent side="right" className="pt-6 w-64 z-999999">
          <SheetTitle className="px-4 text-lg font-bold">{routeT('menu')}</SheetTitle>
          <nav className="flex flex-col gap-2 px-2">
            {items.map(item =>
              item.href
                ? (
                    <Link
                      key={item.title}
                      href={item.href}
                      className="py-2 px-3 rounded hover:bg-accent font-bold transition-colors"
                      onClick={() => setOpen(false)}
                    >
                      {item.label ?? routeT(item.title)}
                    </Link>
                  )
                : item.children
                  ? (
                      <div key={item.title} className="mb-2">
                        <div className="font-bold px-3 py-2">{item.label ?? routeT(item.title)}</div>
                        <div className="flex flex-col pl-4">
                          {item.children.map(child => (
                            <Link
                              key={child.title}
                              href={child.href}
                              className="py-2 px-3 rounded hover:bg-accent transition-colors"
                              onClick={() => setOpen(false)}
                            >
                              {child.label ?? routeT(child.title)}
                            </Link>
                          ))}
                        </div>
                      </div>
                    )
                  : null,
            )}
            {/* 小物件区 */}
            <div className="flex gap-2 mt-2 justify-center">
              <Link
                href="/rss.xml"
                className="flex items-center gap-2 py-2 px-3 rounded-xl hover:bg-accent transition-colors"
              >
                <RssIcon className="w-5 h-5 text-primary" />
              </Link>
            </div>
          </nav>

          <div className="flex items-center justify-center p-4 border-t border-border">
            <ThemeModeToggle showSegmented={true} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
