"use client"

import * as React from "react"
import Link from "next/link"

import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu"
import { useDevice } from "@/contexts/device-context"
import config from "@/config"
import { useState } from "react"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Menu } from "lucide-react"
import { ThemeModeToggle } from "../common/theme-toggle"
import { AvatarWithDropdownMenu } from "./avatar-with-dropdown-menu"

const navbarMenuComponents = [
  {
    title: "首页",
    href: "/"
  },
  {
    title: "文章",
    children: [
      { title: "归档", href: "/archives" },
      { title: "标签", href: "/labels" },
      { title: "随机", href: "/random" }
    ]
  },
  {
    title: "页面",
    children: [
      { title: "关于我", href: "/about" },
      { title: "联系我", href: "/contact" },
      { title: "友链", href: "/links" },
      { title: "隐私政策", href: "/privacy-policy" },
    ]
  }
]

export function Navbar() {
  const { navbarAdditionalClassName, setMode, mode } = useDevice()
  return (
    <nav className={`grid grid-cols-[1fr_auto_1fr] items-center gap-4 h-full px-4 w-full ${navbarAdditionalClassName}`}>
      <div className="flex items-center justify-start">
        <span className="font-bold truncate"><Link href="/">{config.metadata.name}</Link></span>
      </div>
      <div className="flex items-center justify-center">
        <NavMenuCenter />
      </div>
      <div className="flex items-center justify-end space-x-2">
        <AvatarWithDropdownMenu />
        <ThemeModeToggle className="hidden md:block" />
        <SidebarMenuClientOnly />
      </div>
    </nav>
  )
}

function NavMenuCenter() {
  return (
    <NavigationMenu viewport={false} className="hidden md:block">
      <NavigationMenuList className="flex space-x-1">
        {navbarMenuComponents.map((item) => (
          <NavigationMenuItem key={item.title}>
            {item.href ? (
              <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
                <Link href={item.href} className="flex items-center gap-1 font-extrabold">
                  <span>{item.title}</span>
                </Link>
              </NavigationMenuLink>
            ) : item.children ? (
              <>
                <NavigationMenuTrigger className="flex items-center gap-1 font-extrabold">
                  <span>{item.title}</span>
                </NavigationMenuTrigger>
                <NavigationMenuContent>
                  <ul className="grid gap-2 p-0 min-w-[200px] max-w-[600px] grid-cols-[repeat(auto-fit,minmax(120px,1fr))]">
                    {item.children.map((child) => (
                      <ListItem
                        key={child.title}
                        title={child.title}
                        href={child.href}
                      />
                    ))}
                  </ul>
                </NavigationMenuContent>
              </>
            ) : null}
          </NavigationMenuItem>
        ))}
      </NavigationMenuList>
    </NavigationMenu>
  )
}

function ListItem({
  title,
  children,
  href,
  ...props
}: React.ComponentPropsWithoutRef<"li"> & { href: string }) {
  return (
    <li {...props} className="flex justify-center">
      <NavigationMenuLink asChild>
        <Link href={href} className="flex flex-col items-center text-center w-full">
          <div className="text-sm leading-none font-medium">{title}</div>
          <p className="text-muted-foreground line-clamp-2 text-sm leading-snug">
            {children}
          </p>
        </Link>
      </NavigationMenuLink>
    </li>
  )
}

function SidebarMenuClientOnly() {
  return <SidebarMenu />;
}

function SidebarMenu() {
  const [open, setOpen] = useState(false)
  return (
    <div className="md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button
            aria-label="打开菜单"
            className="p-2 rounded-md hover:bg-accent transition-colors"
          >
            <Menu className="w-6 h-6" />
          </button>
        </SheetTrigger>
        <SheetContent side="right" className="p-0 w-64">
          <SheetTitle className="sr-only">侧边栏菜单</SheetTitle>
          <nav className="flex flex-col gap-2 p-4">
            {navbarMenuComponents.map((item) =>
              item.href ? (
                <Link
                  key={item.title}
                  href={item.href}
                  className="py-2 px-3 rounded hover:bg-accent font-bold transition-colors"
                  onClick={() => setOpen(false)}
                >
                  {item.title}
                </Link>
              ) : item.children ? (
                <div key={item.title} className="mb-2">
                  <div className="font-bold px-3 py-2">{item.title}</div>
                  <div className="flex flex-col pl-4">
                    {item.children.map((child) => (
                      <Link
                        key={child.title}
                        href={child.href}
                        className="py-2 px-3 rounded hover:bg-accent transition-colors"
                        onClick={() => setOpen(false)}
                      >
                        {child.title}
                      </Link>
                    ))}
                  </div>
                </div>
              ) : null
            )}
          </nav>
          <div className="flex items-center justify-center p-4 border-t border-border">
            <ThemeModeToggle/>
          </div>
          
        </SheetContent>
      </Sheet></div>
  )
}