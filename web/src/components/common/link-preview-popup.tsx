"use client";

import { useState, useEffect } from 'react';
import { ExternalLinkIcon, Globe } from 'lucide-react';
import type { LinkPreview } from '@/app/api/get-link-info/route';
import copyToClipboard from '@/lib/clipboard';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import Image from 'next/image';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface LinkPreviewPopupProps {
  url: string;
  children: React.ReactNode;
}

export function LinkPreviewPopup({ url, children }: LinkPreviewPopupProps) {
  const operationT = useTranslations('Operation');
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);

  // 获取预览数据
  useEffect(() => {
    if (!open || preview || loading || error) return;

    const fetchPreview = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/get-link-info?url=${encodeURIComponent(url)}`);
        if (response.ok) {
          const data = await response.json();
          setPreview(data);
        } else {
          setError(true);
        }
      } catch (err) {
        console.error('fetch link preview failed', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    // 立即开始加载
    fetchPreview();
  }, [open, url, preview, loading, error]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          {children}
        </span>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0"
        align="start"
        sideOffset={8}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        {loading && (
          <div className="p-4 flex items-center gap-3">
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent"></div>
            <span className="text-sm text-muted-foreground">loading...</span>
          </div>
        )}
        
        {error && (
          <div className="p-4 flex items-center gap-3">
            <Globe className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">error loading preview</span>
          </div>
        )}
        
        {preview && (
          <div className="overflow-hidden cursor-default">
            {preview.image && (
              <div className="relative h-32 bg-muted rounded-t-md overflow-hidden">
                <Image
                  src={preview.image}
                  alt={preview.title}
                  width={320}
                  height={128}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
            )}
            
            <div className="p-4">
              <div className="flex items-start gap-3">
                {preview.favicon && (
                  <Image
                    src={preview.favicon}
                    alt=""
                    width={16}
                    height={16}
                    className="w-4 h-4 mt-0.5 flex-shrink-0"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                )}
                
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-sm leading-tight mb-1 line-clamp-2">
                    {preview.title}
                  </h3>
                  
                  {preview.description && (
                    <p className="text-xs text-muted-foreground line-clamp-3 mb-2">
                      {preview.description}
                    </p>
                  )}
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <ExternalLinkIcon className="w-3 h-3" />
                      <span className="truncate">{preview.siteName || new URL(preview.url).hostname}</span>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          copyToClipboard(preview.url);
                          toast.success(operationT("copy_link_success"));
                        }}
                        className="text-xs px-2 py-1 rounded bg-muted hover:bg-muted/80 transition-colors"
                        title={operationT("copy_link")}
                      >
                        {operationT("copy_link")}
                      </button>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                        onClick={() => setOpen(false)}
                      >
                        {operationT("open")}
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}