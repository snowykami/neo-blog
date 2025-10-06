"use client"

import { Eye } from "lucide-react";
import { useState } from "react";
import { navStickyTopPx } from "@/utils/common/layout-size";

export function CoverPreviewButton({ 
  onPreviewChange 
}: { 
  onPreviewChange: (isPreviewing: boolean) => void 
}) {
  const [isPreviewing, setIsPreviewing] = useState(false);

  const handleMouseDown = () => {
    setIsPreviewing(true);
    onPreviewChange(true);
  };

  const handleMouseUp = () => {
    setIsPreviewing(false);
    onPreviewChange(false);
  };

  const handleMouseLeave = () => {
    if (isPreviewing) {
      setIsPreviewing(false);
      onPreviewChange(false);
    }
  };

  const handleTouchStart = () => {
    setIsPreviewing(true);
    onPreviewChange(true);
  };

  const handleTouchEnd = () => {
    setIsPreviewing(false);
    onPreviewChange(false);
  };

  return (
    <button
      className="fixed right-4 md:right-10 z-20 bg-white/20 backdrop-blur-sm hover:bg-white/30 text-white border border-white/30 rounded-full p-2 shadow-lg transition-all duration-300 hover:scale-110"
      style={{ top: `${navStickyTopPx + 8}px` }}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      aria-label="Preview cover image"
    >
      <Eye className="w-5 h-5" />
    </button>
  );
}
