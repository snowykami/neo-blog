"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

import i18n, { getDefaultLang } from "@/utils/i18n";

type Mode = "light" | "dark";
type Lang = string;

interface DeviceContextProps {
  isMobile: boolean;
  mode: Mode;
  setMode: (mode: Mode) => void;
  toggleMode: () => void;
  lang: Lang;
  setLang: (lang: Lang) => void;
  viewport: {
    width: number;
    height: number;
  };
}

const DeviceContext = createContext<DeviceContextProps>({
  isMobile: false,
  mode: "light",
  setMode: () => {},
  toggleMode: () => {},
  lang: "zh-cn",
  setLang: () => {},
  viewport: {
    width: 0,
    height: 0,
  },
});

export const DeviceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isMobile, setIsMobile] = useState(false);
  const [mode, setModeState] = useState<Mode>("light");
  const [lang, setLangState] = useState<Lang>(getDefaultLang());
  const [viewport, setViewport] = useState({
    width: typeof window !== "undefined" ? window.innerWidth : 0,
    height: typeof window !== "undefined" ? window.innerHeight : 0,
  });

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

  // 初始化语言
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedLang = localStorage.getItem("language") || getDefaultLang();
      setLangState(savedLang);
      i18n.changeLanguage(savedLang);
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

  const setLang = useCallback((newLang: Lang) => {
    setLangState(newLang);
    i18n.changeLanguage(newLang);
    localStorage.setItem("language", newLang);
  }, []);

  return (
    <DeviceContext.Provider
      value={{ isMobile, mode, setMode, toggleMode, lang, setLang, viewport }}
    >
      {children}
    </DeviceContext.Provider>
  );
};

export const useDevice = () => useContext(DeviceContext);
