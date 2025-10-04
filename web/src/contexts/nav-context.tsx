// ...existing code...
"use client";

import { cn } from "@/lib/utils";
import { contentAreaPaddingClass, navHeight } from "@/utils/common/layout-size";
import React, { createContext, useContext, useState, useMemo, useCallback, useEffect } from "react";

type NavContextValue = {
  hasNavPadding: boolean;
  setHasNavPadding: (hasPadding: boolean) => void;
  toggleNavPadding: () => void;

  navClassName: string;
  setNavStyle: (className: string) => void;

  // 保留原有 reset 名称（还原到 initialNavClassName）
  resetNavClassName: () => void;
  // useNavControl 中的重置（还原到 DEFAULT_NAV_CLASSNAME）
  resetNavStyle: () => void;

  // 便捷控制
  disableNavPadding: () => void;
  enableNavPadding: () => void;

  // 预设样式
  setTransparentNav: () => void;
  setSolidNav: () => void;
  setFloatingNav: () => void;
};

export const DEFAULT_NAV_CLASSNAME = `bg-background/90 backdrop-blur md:rounded-b-2xl h-${navHeight} ${contentAreaPaddingClass}`;

const NavContext = createContext<NavContextValue | undefined>(undefined);

export function NavPaddingProvider({
  children,
  initialHasNavPadding = true,
  initialNavClassName = "",
}: {
  children: React.ReactNode;
  initialHasNavPadding?: boolean;
  initialNavClassName?: string;
}) {
  const [hasNavPadding, setHasNavPadding] = useState<boolean>(initialHasNavPadding);
  const [navClassName, setNavClassName] = useState<string>(cn(DEFAULT_NAV_CLASSNAME, initialNavClassName));

  const toggleNavPadding = useCallback(() => {
    setHasNavPadding(prev => !prev);
  }, []);

  const resetNavClassName = useCallback(() => {
    setNavClassName(initialNavClassName);
  }, [initialNavClassName]);

  const resetNavStyle = useCallback(() => {
    setNavClassName(cn(DEFAULT_NAV_CLASSNAME, initialNavClassName));
  }, []);

  const setNavStyle = useCallback((className: string) => {
    setNavClassName(cn(DEFAULT_NAV_CLASSNAME, className));
  }, []);

  const disableNavPadding = useCallback(() => {
    setHasNavPadding(false);
  }, []);

  const enableNavPadding = useCallback(() => {
    setHasNavPadding(true);
  }, []);

  const setTransparentNav = useCallback(() => {
    setNavClassName("bg-transparent backdrop-blur-md");
  }, []);

  const setSolidNav = useCallback(() => {
    setNavClassName("bg-background border-b");
  }, []);

  const setFloatingNav = useCallback(() => {
    setNavClassName("fixed top-4 left-4 right-4 rounded-lg shadow-lg bg-background/90 backdrop-blur-md");
  }, []);

  const value = useMemo(() => ({
    hasNavPadding,
    setHasNavPadding,
    toggleNavPadding,

    navClassName,

    resetNavClassName,
    resetNavStyle,
    setNavStyle,

    disableNavPadding,
    enableNavPadding,

    setTransparentNav,
    setSolidNav,
    setFloatingNav,
  }), [
    hasNavPadding,
    navClassName,
    toggleNavPadding,
    resetNavClassName,
    resetNavStyle,
    setNavStyle,
    disableNavPadding,
    enableNavPadding,
    setTransparentNav,
    setSolidNav,
    setFloatingNav,
  ]);

  useEffect(() => {
    console.log("Nav className updated:", navClassName);
  },[navClassName])

  return (
    <NavContext.Provider value={value}>
      {children}
    </NavContext.Provider>
  );
}

export function useNav() {
  const ctx = useContext(NavContext);
  if (!ctx) {
    throw new Error("useNav must be used within a NavPaddingProvider");
  }
  return ctx;
}
