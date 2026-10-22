'use client'

import { SparklesIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { inlineTextLength, parseInlineMarkdown, renderInlineMarkdown } from '@/utils/common/inline-markdown'

// 打字速度（字符/秒）
const CHARS_PER_SECOND = 38

type Phase = 'static' | 'pending' | 'typing' | 'done'

/**
 * AI 摘要卡片：服务端渲染完整文本（利于 SEO，且无 JS 时直接可读）
 * 水合后若用户未要求减少动态效果，进入视口时以打字机效果逐字显示一次
 * 完整文本始终占位（打字时设为不可见），打字层绝对定位覆盖其上，避免布局跳动
 */
export function AISummary({ text, label, className }: { text: string, label: string, className?: string }) {
  const nodes = useMemo(() => parseInlineMarkdown(text), [text])
  const total = useMemo(() => inlineTextLength(nodes), [nodes])
  const containerRef = useRef<HTMLDivElement>(null)
  // 初始为 static，与服务端输出一致，保证水合无差异
  const [phase, setPhase] = useState<Phase>('static')
  const [count, setCount] = useState(total)

  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof IntersectionObserver === 'undefined')
      return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      return
    // 隐藏完整文本，等待进入视口后开始打字
    setPhase('pending')
    setCount(0)
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect()
        setPhase('typing')
      }
    }, { threshold: 0.3 })
    observer.observe(el)
    return () => observer.disconnect()
  }, [text])

  useEffect(() => {
    if (phase !== 'typing')
      return
    let frame = 0
    const startedAt = performance.now()
    const tick = (now: number) => {
      const next = Math.min(total, Math.floor(((now - startedAt) / 1000) * CHARS_PER_SECOND))
      setCount(next)
      if (next >= total) {
        setPhase('done')
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [phase, total])

  const animating = phase === 'pending' || phase === 'typing'

  return (
    <div ref={containerRef} className={cn('rounded-xl bg-primary/5 p-4', className)}>
      <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-primary">
        <SparklesIcon className="size-4" aria-hidden />
        {label}
      </div>
      <div className="relative leading-relaxed text-foreground/80">
        {/* 完整文本：始终占据最终高度；动画期间不可见，由下方屏幕阅读器专用文本代替 */}
        <p className={cn(animating && 'invisible')} aria-hidden={animating || undefined}>
          {renderInlineMarkdown(nodes)}
        </p>
        {animating && (
          <>
            <p className="sr-only">{renderInlineMarkdown(nodes)}</p>
            <p className="absolute inset-0" aria-hidden>
              {renderInlineMarkdown(nodes, count)}
              <span className="ml-0.5 inline-block h-[1.1em] w-0.5 translate-y-[0.2em] animate-pulse bg-primary" />
            </p>
          </>
        )}
      </div>
    </div>
  )
}
