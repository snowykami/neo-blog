"use client"

import { Skeleton } from "@/components/ui/skeleton"
import { Checkbox } from "@/components/ui/checkbox";
import { useEffect, useState } from "react";
import { useDevice } from "@/contexts/device-context";
import { fallbackSiteInfo, useSiteInfo } from "@/contexts/site-info-context";

export function ColorScheme(
  { className, color, selectedColor, setSelectedColor }:
    { className?: string, color: string, selectedColor: string, setSelectedColor: (color: string) => void }) {
  return (
    <div className={`w-full rounded-lg border p-3 shadow-sm box-border ${className ?? ""} ${selectedColor === color ? "border-primary bg-primary/10" : "border-border"} cursor-pointer hover:border-primary transition-colors`} onClick={() => setSelectedColor(color)}>
      <div className="flex items-center gap-3">
        <Checkbox checked={selectedColor === color} onCheckedChange={(checked) => { if (checked) setSelectedColor(color); }} className="pointer-events-none" />
        <div className="font-bold text-primary">{color.toUpperCase()}</div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-full rounded-md border border-border bg-card" />
          <div className="text-xs text-muted-foreground"><Skeleton className="h-3 w-12" /></div>
        </div>

        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-full rounded-md border border-border bg-ring" />
          <div className="text-xs text-ring-foreground"><Skeleton className="h-3 w-12" /></div>
        </div>

        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-full rounded-md border border-border bg-destructive" />
          <div className="text-xs text-destructive-foreground"><Skeleton className="h-3 w-12" /></div>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <div className="rounded-md border border-border p-2">
          <div className="h-8 w-full rounded flex items-center justify-between px-3 bg-primary/10">
            <Skeleton className="h-4 w-28" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-6 w-14" />
            </div>
          </div>
          <div className="mt-2 h-16 w-full rounded p-2 bg-card">
            <Skeleton className="h-3 w-full" />
            <div className="mt-2">
              <Skeleton className="h-3 w-3/4" />
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <div className="flex-1 h-8 rounded border border-border bg-primary" />
          <div className="flex-1 h-8 rounded border border-border bg-primary-foreground" />
        </div>
      </div>
    </div>
  )
}

export function ColorSchemeSelector({color,  onColorChange }: { color: string | null, onColorChange?: (color: string) => void }) {
  const {siteInfo} = useSiteInfo();
  const colorSchemes = siteInfo?.colorSchemes ? siteInfo.colorSchemes : fallbackSiteInfo.colorSchemes;
  const [selectedColor, setSelectedColor] = useState<string | null>(colorSchemes.includes(color || "") ? color : colorSchemes[0]);
  const { isDark } = useDevice();

  useEffect(() => {
    onColorChange?.(selectedColor!);
    if (!selectedColor) return;
  }, [selectedColor, onColorChange]);

  if (!selectedColor) return null;
  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {colorSchemes.map(color => (
          <div key={color} data-user-color={color} className={`${isDark ? 'dark' : ''} p-2 min-w-0`}>
            <ColorScheme color={color} selectedColor={selectedColor} setSelectedColor={setSelectedColor} />
          </div>
        ))}
      </div>
    </div>
  );
}