'use client'

import { IconInnerShadowTop } from '@tabler/icons-react'
import {
  ArchiveIcon,
  ContactIcon,
  HouseIcon,
  InfoIcon,
  Link2Icon,
  NewspaperIcon,
  PanelRight,
  PanelsTopLeftIcon,
  RssIcon,
  ShuffleIcon,
  TagsIcon,
} from 'lucide-react'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { useState } from 'react'
import { ThemeModeToggle } from '@/components/common/theme-toggle'
import { AvatarWithDropdownMenu } from '@/components/layout/nav/avatar-with-dropdown-menu'
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
import { mainPath } from '@/utils/common/route'

const navbarMenuComponents = [
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
        title: 'random',
        href: mainPath.random,
        icon: ShuffleIcon,
      },
      {
        title: 'label',
        href: mainPath.label,
        icon: TagsIcon,
      },
    ],
  },
  {
    title: 'page',
    icon: PanelsTopLeftIcon,
    children: [
      {
        title: 'about',
        href: new URL('https://sfkm.me/#profile'),
        icon: InfoIcon,
      },
      {
        title: 'contact',
        href: new URL('https://sfkm.me/#contact'),
        icon: ContactIcon,
      },
      {
        title: 'friends',
        href: new URL('https://sfkm.me/#friends'),
        icon: Link2Icon,
      },
    ],
  },
]

export default function Navbar() {
  const { siteInfo } = useSiteInfo()
  const isMobile = useIsMobile()
  const { navClassName, navTitle } = useNav()
  return (
    <div className={cn(`flex items-center justify-between w-full max-w-screen`, navClassName)}>
      <div className="flex items-center justify-start">
        <span className="font-bold text-lg truncate">
          <Link href="/" className="flex items-center text-primary gap-1">
            <IconInnerShadowTop className="!size-6" />
            {navTitle || siteInfo.metadata.name}
          </Link>
        </span>
      </div>
      <div className="items-center justify-center hidden md:flex">
        <NavMenuCenter />
      </div>
      <div className="flex items-center justify-end-safe gap-2 md:gap-4">
        {[
          <AvatarWithDropdownMenu key="a8d92h1" />,
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
        <SidebarMenu />
      </div>
    </div>
  )
}

function NavMenuCenter() {
  const router = useRouter()
  const routeT = useTranslations('Route')
  return (
    <NavigationMenu viewport={false}>
      <NavigationMenuList className="flex space-x-1" key="navbar-menu">
        {navbarMenuComponents.map(item => (
          <NavigationMenuItem key={item.title} id={item.title}>
            {item.href
              ? (
                // 修复：只在 Link 上应用样式，移除 NavigationMenuLink 上的重复样式
                  <NavigationMenuLink
                    onClick={() => router.push(item.href)}
                    className={cn(
                      navigationMenuTriggerStyle(),
                      'font-extrabold text-lg bg-transparent',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <item.icon className="!w-6 !h-6 text-inherit" />
                      <span>{routeT(item.title)}</span>
                    </div>
                  </NavigationMenuLink>
                )
              : item.children
                ? (
                    <>
                      {/* Trigger 保持不变 */}
                      <NavigationMenuTrigger
                        className={cn(
                          navigationMenuTriggerStyle(),
                          'font-extrabold text-lg bg-transparent',
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <item.icon className="w-6 h-6" />
                          <span>{routeT(item.title)}</span>
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
                                    {routeT(child.title)}
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

function SidebarMenu() {
  const [open, setOpen] = useState(false)
  const routeT = useTranslations('Route')
  return (
    <div className="flex md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-accent/50 transition-all duration-200 text-primary cursor-pointer">
            <PanelRight className="w-6 h-6 text-primary" />
          </button>
        </SheetTrigger>
        <SheetContent side="right" className="pt-6 w-64 z-999999">
          <SheetTitle className="px-4 text-lg font-bold">{routeT('menu')}</SheetTitle>
          <nav className="flex flex-col gap-2 px-2">
            {navbarMenuComponents.map(item =>
              item.href
                ? (
                    <Link
                      key={item.title}
                      href={item.href}
                      className="py-2 px-3 rounded hover:bg-accent font-bold transition-colors"
                      onClick={() => setOpen(false)}
                    >
                      {routeT(item.title)}
                    </Link>
                  )
                : item.children
                  ? (
                      <div key={item.title} className="mb-2">
                        <div className="font-bold px-3 py-2">{routeT(item.title)}</div>
                        <div className="flex flex-col pl-4">
                          {item.children.map(child => (
                            <Link
                              key={child.title}
                              href={child.href}
                              className="py-2 px-3 rounded hover:bg-accent transition-colors"
                              onClick={() => setOpen(false)}
                            >
                              {routeT(child.title)}
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
