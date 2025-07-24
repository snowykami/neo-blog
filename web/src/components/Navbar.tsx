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
import GravatarAvatar from "./Gravatar"
import { useDevice } from "@/contexts/DeviceContext"

const components: { title: string; href: string }[] = [
    {
        title: "归档",
        href: "/archives"
    },
    {
        title: "标签",
        href: "/labels"
    },
    {
        title: "随机",
        href: "/random"
    }
]

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
    return (
        <nav className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 h-12 px-4 w-full">
            <div className="flex items-center justify-start">
                {/* 左侧内容 */}
                <span className="font-bold truncate">Snowykami's Blog</span>
            </div>
            <div className="flex items-center justify-center">
                {/* 中间内容 - 完全居中 */}
                <NavMenu />
            </div>
            <div className="flex items-center justify-end">
                {/* 右侧内容 */}
                <GravatarAvatar email="snowykami@outlook.com" size={32} />
            </div>
        </nav>
    )
}

function NavMenu() {
    const { isMobile } = useDevice()
    console.log("isMobile", isMobile)
    if (isMobile) return null
    return (
        <NavigationMenu viewport={false}>
            <NavigationMenuList className="flex space-x-1">
                {navbarMenuComponents.map((item) => (
                    <NavigationMenuItem key={item.title}>
                        {item.href ? (
                            <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
                                <Link href={item.href} className="flex items-center gap-1 font-extrabold">
                                    {item.title}
                                </Link>
                            </NavigationMenuLink>
                        ) : item.children ? (
                            <>
                                <NavigationMenuTrigger className="flex items-center gap-1 font-extrabold">
                                    {item.title}
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
