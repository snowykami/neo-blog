"use client";

import { useState, useEffect, useRef } from 'react';
import { ExternalLinkIcon, Globe } from 'lucide-react';
import type { LinkPreview } from '@/app/api/get-link-info/route';
import copyToClipboard from '@/lib/clipboard';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

interface LinkPreviewPopupProps {
  url: string;
  children: React.ReactNode;
}

export function LinkPreviewPopup({ url, children }: LinkPreviewPopupProps) {
  const operationT = useTranslations('Operation');
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const showTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 清除所有定时器
  const clearTimeouts = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    if (showTimeoutRef.current) {
      clearTimeout(showTimeoutRef.current);
      showTimeoutRef.current = null;
    }
  };

  // 鼠标进入链接
  const handleMouseEnter = () => {
    clearTimeouts();
    
    // 延迟显示预览
    showTimeoutRef.current = setTimeout(() => {
      setIsVisible(true);
    }, 300);
  };

  // 鼠标离开链接
  const handleMouseLeave = () => {
    clearTimeouts();
    
    // 延迟隐藏，给用户时间移动到预览窗口
    hideTimeoutRef.current = setTimeout(() => {
      setIsVisible(false);
    }, 300);
  };

  // 鼠标进入预览窗口
  const handlePreviewMouseEnter = () => {
    clearTimeouts();
    // 保持显示状态
  };

  // 鼠标离开预览窗口
  const handlePreviewMouseLeave = () => {
    clearTimeouts();
    
    // 立即隐藏或短延迟隐藏
    hideTimeoutRef.current = setTimeout(() => {
      setIsVisible(false);
    }, 150);
  };

  // 获取预览数据
  useEffect(() => {
    if (!isVisible || preview || loading || error) return;

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
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    // 立即开始加载
    fetchPreview();
  }, [isVisible, url, preview, loading, error]);

  // 清理定时器
  useEffect(() => {
    return () => {
      clearTimeouts();
    };
  }, []);

  return (
    <div className="relative inline-block">
      {/* 链接部分 */}
      <div 
        onMouseEnter={handleMouseEnter} 
        onMouseLeave={handleMouseLeave}
      >
        {children}
      </div>
      
      {/* 预览弹窗 */}
      {isVisible && (
        <div 
          className="absolute z-50 w-80 mt-2 left-0 bg-background border border-border rounded-lg shadow-lg overflow-hidden transition-all duration-200 opacity-100 scale-100"
          onMouseEnter={handlePreviewMouseEnter}
          onMouseLeave={handlePreviewMouseLeave}
          style={{
            // 确保弹窗不会被其他元素遮挡
            zIndex: 9999,
          }}
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
              <span className="text-sm text-muted-foreground">error: {error}</span>
            </div>
          )}
          
          {preview && (
            <div className="overflow-hidden cursor-default">
              {preview.image && (
                <div className="relative h-32 bg-muted">
                  <img
                    src={preview.image}
                    alt={preview.title}
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
                    <img
                      src={preview.favicon}
                      alt=""
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
                      
                      {/* 添加一些交互按钮 */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            copyToClipboard(preview.url);
                            toast.success(operationT("copy_link_success"));
                            // 可以添加 toast 提示
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
                          onClick={() => setIsVisible(false)}
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
        </div>
      )}
    </div>
  );
}