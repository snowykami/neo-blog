'use client'

import type { NavMenuItem } from './nav-shared'
import type { PageModel } from '@/models/page'
import {
  ArchiveIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FolderIcon,
  HouseIcon,
  LinkIcon,
  MenuIcon,
  NewspaperIcon,
  PanelsTopLeftIcon,
  ShuffleIcon,
  TagsIcon,
} from 'lucide-react'

import { useTranslations } from 'next-intl'
import dynamic from 'next/dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import { listPages } from '@/api/page'
import { ColorSchemePicker } from '@/components/common/color-scheme-picker'
import { ThemeModeToggle } from '@/components/common/theme-toggle'
import { AvatarWithDropdownMenu } from '@/components/layout/nav/avatar-with-dropdown-menu'
import { NavSearch } from '@/components/layout/nav/nav-search'
import { TopbarIsland } from '@/components/layout/topbar-island/topbar-island'
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from '@/components/ui/navigation-menu'
import { Link, usePathname } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import { NAV_PAGES_QUERY, toNavPages } from '@/utils/common/nav-pages'
import { getPageUrl, mainPath } from '@/utils/common/route'
import { useInitialNavPages } from './nav-pages-context'
import { isActivePath, navIconButtonClass, NavItemLink } from './nav-shared'

/** 站外地址：http(s) 绝对地址（链接页面的站内路径以 / 开头） */
const isExternalHref = (href: string) => /^https?:\/\//i.test(href)

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

// 导航中展示的自定义页面（只取公开且勾选了「导航展示」的页面，按导航排序升序）：布局在服务端预取并随顶栏渲染（见 api/nav-pages.server.ts）；
// 没有预取到时挂载后获取。标签页重新可见时再取一次，在其他标签页（如后台）修改了页面设置后切回来即可看到
function useNavPages() {
  const initialPages = useInitialNavPages()
  const [pages, setPages] = useState<PageModel[]>(initialPages ?? [])
  const hasInitial = initialPages !== undefined
  useEffect(() => {
    let cancelled = false
    const load = () => {
      listPages(NAV_PAGES_QUERY)
        .then((res) => {
          if (!cancelled)
            setPages(toNavPages(res.data.pages))
        })
        .catch(() => { })
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible')
        load()
    }
    if (!hasInitial)
      load()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [hasInitial])
  // 服务端给了新的预取结果（站内跳转后布局重新渲染、router.refresh）时换上
  const [syncedInitial, setSyncedInitial] = useState(initialPages)
  if (initialPages !== syncedInitial) {
    setSyncedInitial(initialPages)
    if (initialPages)
      setPages(initialPages)
  }
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
        // 链接页面直接跳转到其地址：站内路径用路由切换，站外地址新窗口打开
        children: pages.map((page) => {
          const isLink = page.kind === 'link' && !!page.linkUrl
          const external = isLink && isExternalHref(page.linkUrl)
          return {
            title: `page-${page.id}`,
            label: page.title,
            href: isLink ? page.linkUrl : getPageUrl(page),
            icon: external ? ExternalLinkIcon : isLink ? LinkIcon : FileTextIcon,
            external,
          }
        }),
      },
    ]
  }, [pages])
}

// 一级菜单项：当前路由高亮
const navItemClass = 'inline-flex h-11 items-center gap-2 rounded-lg px-4 font-medium text-foreground/75 transition-[color,background-color,transform] duration-150 hover:bg-primary/10 hover:text-primary active:scale-[.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer'
const navItemActiveClass = 'bg-primary/10 text-primary'

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
  const menuItems = useNavMenuItems()
  const scrolled = useScrolled()
  return (
    <nav
      className={cn(
        'flex h-[var(--nav-h)] w-full items-center gap-2 rounded-b-2xl bg-card px-2 md:px-4',
        scrolled && 'shadow-sm',
      )}
    >
      {/* 左侧：站名与灵动岛（按情境显示音乐、阅读进度、提示等），min-w-0 保证在 flex 收缩时文本能 truncate */}
      <TopbarIsland />

      {/* 中间：主菜单，仅 md 及以上显示 */}
      <div className="hidden shrink-0 items-center md:flex">
        <NavMenuCenter items={menuItems} />
      </div>

      {/* 右侧：搜索、明暗切换、配色切换、用户；明暗切换与配色切换在移动端收进侧边菜单
       * 移动端只占按钮所需宽度，把剩余空间让给站名；md 及以上与左侧等分，保证主菜单居中 */}
      <div className="flex flex-none items-center justify-end md:min-w-0 md:flex-1">
        <NavSearch className={navIconButtonClass} />
        <ThemeModeToggle className={cn(navIconButtonClass, 'hidden md:inline-flex')} />
        <ColorSchemePicker className={cn(navIconButtonClass, 'hidden md:inline-flex')} />
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
                                    <NavItemLink
                                      href={child.href}
                                      external={child.external}
                                      aria-current={childActive ? 'page' : undefined}
                                      className={cn(
                                        'flex-row! items-center gap-2! rounded-lg! px-3 py-2 text-sm font-medium text-foreground/75 hover:bg-primary/10! hover:text-primary! focus:bg-primary/10! focus:text-primary!',
                                        childActive && 'bg-primary/10 text-primary',
                                      )}
                                    >
                                      <child.icon aria-hidden className="size-4 text-current!" />
                                      <span className="truncate">{child.label ?? routeT(child.title)}</span>
                                    </NavItemLink>
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

// 移动端侧边菜单的抽屉第一次点开时才加载（见 mobile-nav-sheet.tsx）
const MobileNavSheet = dynamic(() => import('./mobile-nav-sheet').then(m => m.MobileNavSheet), { ssr: false })

function SidebarMenu({ items }: { items: NavMenuItem[] }) {
  const routeT = useTranslations('Route')
  const [open, setOpen] = useState(false)
  const [everOpened, setEverOpened] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  return (
    <div className="flex md:hidden">
      <button
        ref={triggerRef}
        type="button"
        aria-label={routeT('menu')}
        title={routeT('menu')}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={navIconButtonClass}
        // 按下时就开始下载抽屉代码，松手时通常已经就绪
        onPointerDown={() => void import('./mobile-nav-sheet')}
        onClick={() => {
          setEverOpened(true)
          setOpen(true)
        }}
      >
        <MenuIcon aria-hidden className="size-5" />
      </button>
      {everOpened && <MobileNavSheet items={items} open={open} setOpen={setOpen} triggerRef={triggerRef} />}
    </div>
  )
}
