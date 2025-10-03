"use client"

import { useBackground } from "@/contexts/background-context";
import { useNavControl } from "@/contexts/nav-context";
import { useEffect, useState } from "react";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const { setBackground } = useBackground();

  useEffect(() => {
    setBackground(
      <div className="absolute inset-0 -z-10 bg-primary/20">
      </div>
    )
    return () => setBackground(null);
  }, [setBackground]);

  const { setNavClassName, resetNavStyle } = useNavControl();
  const [scrollY, setScrollY] = useState(0);

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

  useEffect(() => {
    const maxGradientScroll = 160;
    if (scrollY <= maxGradientScroll) {
      setNavClassName(`bg-background/0 !text-white backdrop-blur-none transition-[color,background-color,border-color]`);
    } else {
      resetNavStyle();
    }
  }, [scrollY, setNavClassName, resetNavStyle]);

  return (
    <div>
      {children}
    </div>
  )
}