"use client";

import { navHeight } from "@/utils/common/layout-size";
import React, { createContext, useContext, useState, useMemo, useCallback } from "react";

type NavPaddingContextValue = {
  hasNavPadding: boolean;
  setHasNavPadding: (hasPadding: boolean) => void;
  toggleNavPadding: () => void;
  navClassName: string;
  setNavClassName: (className: string) => void;
  resetNavClassName: () => void;
};

// 默认的导航栏样式
export const DEFAULT_NAV_CLASSNAME = `fixed top-0 left-0 h-${navHeight} w-full z-50 
  bg-background/80 backdrop-blur flex justify-center
  transition-all duration-300 ease-in-out`;

const NavPaddingContext = createContext<NavPaddingContextValue | undefined>(undefined);

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
  const [navClassName, setNavClassName] = useState<string>(initialNavClassName);

  const toggleNavPadding = useCallback(() => {
    setHasNavPadding(prev => !prev);
  }, []);

  const resetNavClassName = useCallback(() => {
    setNavClassName(initialNavClassName);
  }, [initialNavClassName]);

  const value = useMemo(() => ({ 
    hasNavPadding, 
    setHasNavPadding, 
    toggleNavPadding,
    navClassName,
    setNavClassName,
    resetNavClassName,
  }), [
    hasNavPadding, 
    toggleNavPadding, 
    navClassName, 
    resetNavClassName
  ]);

  return (
    <NavPaddingContext.Provider value={value}>
      {children}
    </NavPaddingContext.Provider>
  );
}

export function useNavPadding() {
  const ctx = useContext(NavPaddingContext);
  if (!ctx) {
    throw new Error("useNavPadding must be used within a NavPaddingProvider");
  }
  return ctx;
}

// 便利的自定义 Hook
export function useNavControl() {
  const { 
    setHasNavPadding, 
    setNavClassName, 
    resetNavClassName 
  } = useNavPadding();
  
  const disableNavPadding = useCallback(() => {
    setHasNavPadding(false);
  }, [setHasNavPadding]);
  
  const enableNavPadding = useCallback(() => {
    setHasNavPadding(true);
  }, [setHasNavPadding]);

  // 预设的样式
  const setTransparentNav = useCallback(() => {
    setNavClassName("bg-transparent backdrop-blur-md");
  }, [setNavClassName]);

  const setSolidNav = useCallback(() => {
    setNavClassName("bg-background border-b");
  }, [setNavClassName]);

  const setFloatingNav = useCallback(() => {
    setNavClassName("fixed top-4 left-4 right-4 rounded-lg shadow-lg bg-background/90 backdrop-blur-md");
  }, [setNavClassName]);

  const resetNavStyle = useCallback(() => {
    setNavClassName(DEFAULT_NAV_CLASSNAME);
  }, [resetNavClassName]);
  
  return { 
    disableNavPadding, 
    enableNavPadding,
    setTransparentNav,
    setSolidNav,
    setFloatingNav,
    resetNavStyle,
    setNavClassName,
  };
}