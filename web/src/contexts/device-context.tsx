"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

type Mode = "light" | "dark";

interface DeviceContextProps {
  isMobile: boolean;
  mode: Mode;
  setMode: (mode: Mode) => void;
  toggleMode: () => void;
  viewport: {
    width: number;
    height: number;
  };
  navbarAdditionalClassName?: string; // 可选属性，允许传入额外的类名
  setNavbarAdditionalClassName?: (className: string) => void; // 可选方法，允许设置额外的类名
}

const DeviceContext = createContext<DeviceContextProps>({
  isMobile: false,
  mode: "light",
  setMode: () => {},
  toggleMode: () => {},
  viewport: {
    width: 0,
    height: 0,
  },
  navbarAdditionalClassName: "",
  setNavbarAdditionalClassName: () => {},
});

export const DeviceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isMobile, setIsMobile] = useState(false);
  const [mode, setModeState] = useState<Mode>("light");
  const [viewport, setViewport] = useState({
    width: typeof window !== "undefined" ? window.innerWidth : 0,
    height: typeof window !== "undefined" ? window.innerHeight : 0,
  });
  const [navbarAdditionalClassName, setNavbarAdditionalClassName] = useState<string>("");

  // 检查系统主题
  const getSystemTheme = () =>
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    // 更新检测函数以同时更新视窗尺寸
    const handleResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      setIsMobile(width <= 768);
      setViewport({ width, height });
    };

    handleResize(); // 初始化
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // 初始化主题和系统主题变化监听
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedTheme = localStorage.getItem("theme") as Mode | null;
      const systemTheme = getSystemTheme();
      const theme = savedTheme || systemTheme;
      setModeState(theme);
      document.documentElement.classList.toggle("dark", theme === "dark");

      // 监听系统主题变动
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const handleChange = (e: MediaQueryListEvent) => {
        if (!localStorage.getItem("theme")) {
          const newTheme = e.matches ? "dark" : "light";
          setModeState(newTheme);
          document.documentElement.classList.toggle("dark", newTheme === "dark");
        }
      };
      media.addEventListener("change", handleChange);
      return () => media.removeEventListener("change", handleChange);
    }
  }, []);

  const setMode = useCallback((newMode: Mode) => {
    setModeState(newMode);
    document.documentElement.classList.toggle("dark", newMode === "dark");
    if (newMode === getSystemTheme()) {
      localStorage.removeItem("theme");
    } else {
      localStorage.setItem("theme", newMode);
    }
  }, []);

  const toggleMode = useCallback(() => {
    setModeState((prev) => {
      const newMode = prev === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", newMode === "dark");
      if (newMode === getSystemTheme()) {
        localStorage.removeItem("theme");
      } else {
        localStorage.setItem("theme", newMode);
      }
      return newMode;
    });
  }, []);

  return (
    <DeviceContext.Provider
      value={{ isMobile, mode, setMode, toggleMode, viewport, navbarAdditionalClassName, setNavbarAdditionalClassName }}
    >
      {children}
    </DeviceContext.Provider>
  );
};

export const useDevice = () => useContext(DeviceContext);
