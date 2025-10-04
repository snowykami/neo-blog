"use client"

import { useBackground } from "@/contexts/background-context";
import { useNav } from "@/contexts/nav-context";
import { blogPostWithTransparentNavScrollMaxHeight } from "@/utils/common/layout-size";
import { useEffect, useState } from "react";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const { setBackground, resetBackground } = useBackground();
  const { setNavStyle, resetNavStyle, setHasNavPadding } = useNav();
  const [scrollY, setScrollY] = useState(typeof window !== "undefined" ? window.scrollY : 0);

  // 设置背景
  useEffect(() => {
    setBackground(
      <div className="absolute inset-0 -z-10 bg-primary/20">
      </div>
    )
    return () => resetBackground();
  }, [setBackground, resetBackground]);

  // 设置无导航栏内边距
  useEffect(() => {
    setHasNavPadding(false);
    return () => setHasNavPadding(true);
  }, [setHasNavPadding])

  // 监听滚动以改变导航栏样式
  useEffect(() => {
    const handleScroll = () => {
      setScrollY(window.scrollY);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => {
      window.removeEventListener('scroll', handleScroll);
      resetNavStyle();
    };
  }, [resetNavStyle]);

  // 根据滚动位置设置导航栏样式
  useEffect(() => {
    const maxGradientScroll = blogPostWithTransparentNavScrollMaxHeight;
    if (scrollY <= maxGradientScroll / 2) {
      setNavStyle(`bg-transparent backdrop-blur-none !text-white [&_.text-primary]:text-white`);
    } else if (scrollY < maxGradientScroll) {
      setNavStyle(`bg-background/40 backdrop-blur !text-white [&_.text-primary]:text-white`);
    } else {
      resetNavStyle();
    }
  }, [scrollY, setNavStyle, resetNavStyle]);

  return (
    <div>
      {children}
    </div>
  )
}