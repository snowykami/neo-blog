"use client"
import { useSiteInfo } from "@/contexts/site-info-context";
import React from "react";

export default function Footer({height}: {height: number}) {
  const { siteInfo } = useSiteInfo();
  if (!siteInfo) return null;
  return (
    <footer
      style={{ height }}
      className="w-full py-6 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700">
      © {new Date().getFullYear()} {siteInfo?.metadata?.name} · Powered by {siteInfo?.owner?.name} · {siteInfo?.footer?.text}
    </footer>
  );
}