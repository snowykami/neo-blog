'use client'

import { useEffect, useRef, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { useDevice } from '@/contexts/device-context'
import { cn } from '@/lib/utils'

// 与后端 CSP sandbox 一致：不带 allow-same-origin，上传的 HTML 运行在不透明源中，读不到站点的 Cookie 与 localStorage
const SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals'

/** 主题变化时发给 iframe 的消息，HTML 可监听 message 事件自行切换（首次加载以 ?theme= 传入） */
export const HTML_PAGE_THEME_MESSAGE = 'neo-blog:theme'

/**
 * HTML 页面的沙箱 iframe：入口地址附带 ?theme=light|dark，之后主题切换通过 postMessage 通知，不重新加载
 * allowSameOrigin 仅在后端声明由独立的无 Cookie 源托管、且地址确实不与站点同源时才生效
 */
export function HtmlPageFrame({
  src,
  title,
  allowSameOrigin,
  className,
}: {
  src: string
  title: string
  allowSameOrigin: boolean
  className?: string
}) {
  const { isDark } = useDevice()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [frame, setFrame] = useState<{ src: string, sandbox: string } | null>(null)

  // 首帧前的主题已由根布局的内联脚本写入 html.dark，挂载后直接读取，避免先以浅色加载再刷新
  useEffect(() => {
    const url = new URL(src, window.location.href)
    url.searchParams.set('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    const isolated = allowSameOrigin && url.origin !== window.location.origin
    setFrame({ src: url.toString(), sandbox: isolated ? `${SANDBOX} allow-same-origin` : SANDBOX })
  }, [src, allowSameOrigin])

  useEffect(() => {
    // 不透明源无法指定 targetOrigin，消息只包含主题
    iframeRef.current?.contentWindow?.postMessage({ type: HTML_PAGE_THEME_MESSAGE, theme: isDark ? 'dark' : 'light' }, '*')
  }, [isDark])

  if (!frame)
    return <Skeleton className={cn('rounded-none', className)} />
  return (
    <iframe
      ref={iframeRef}
      key={frame.src}
      src={frame.src}
      title={title}
      sandbox={frame.sandbox}
      allowFullScreen
      className={cn('block border-0 bg-background', className)}
    />
  )
}
