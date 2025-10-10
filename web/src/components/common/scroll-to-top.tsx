'use client'

import { ArrowUp } from 'lucide-react'
import React, { useEffect, useRef, useState } from 'react'

export default function ScrollToTopButton({
  threshold = 0.1, // 显示阈值（滚动进度），默认 10%
  positionClass = 'right-4 bottom-4', // 通过 Tailwind 类控制位置（字符串）
  className = '',
  showProgress = true,
  size = 44,
}: {
  threshold?: number
  positionClass?: string
  className?: string
  showProgress?: boolean
  size?: number
}) {
  const [visible, setVisible] = useState(false)
  const [progress, setProgress] = useState(0) // 0..1
  const rafRef = useRef<number | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const update = () => {
      const doc = document.documentElement
      const scrollTop = window.scrollY || doc.scrollTop || 0
      const height = Math.max(doc.scrollHeight, document.body.scrollHeight, window.innerHeight)
      const maxScroll = height - window.innerHeight
      const p = maxScroll <= 0 ? 0 : Math.min(1, scrollTop / maxScroll)
      setProgress(p)
      setVisible(p > threshold)
      rafRef.current = null
    }

    const handler = () => {
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(update)
      }
    }

    window.addEventListener('scroll', handler, { passive: true })
    window.addEventListener('resize', handler)
    // initial
    handler()

    return () => {
      window.removeEventListener('scroll', handler)
      window.removeEventListener('resize', handler)
      if (rafRef.current)
        cancelAnimationFrame(rafRef.current)
    }
  }, [threshold])

  const handleClick = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // 通过 className 控制位置，wrapper 仍然固定定位以相对于视口
  const wrapperClass = `fixed z-60 ${positionClass} ${className}`.trim()

  // 简单进度圆环用 SVG
  const stroke = 3
  const r = (size - stroke * 2) / 2
  const c = 2 * Math.PI * r
  const dash = Math.max(0, Math.min(1, progress)) * c

  const node = (
    <div className={wrapperClass} aria-hidden={!visible}>
      <button
        onClick={handleClick}
        aria-label="Back to top"
        // 白色背景 + 显眼的主色图标/圆环
        className={`flex items-center justify-center rounded-full shadow-lg 
          transition-opacity duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2
           bg-white text-primary border border-gray-200 dark:bg-gray-800 dark:border-gray-700 ${className}`}
        style={{
          width: size,
          height: size,
          opacity: visible ? 1 : 0,
          pointerEvents: visible ? 'auto' : 'none',
        }}
      >
        {showProgress
          ? (
              <svg
                width={size}
                height={size}
                viewBox={`0 0 ${size} ${size}`}
                aria-hidden
                className="rounded-full"
              >
                <g transform={`translate(${size / 2}, ${size / 2})`}>
                  <circle
                    r={r}
                    stroke="rgba(0,0,0,0.06)"
                    strokeWidth={stroke}
                    fill="transparent"
                    strokeLinecap="round"
                  />
                  <circle
                    r={r}
                    stroke="currentColor"
                    strokeWidth={stroke}
                    fill="transparent"
                    strokeLinecap="round"
                    // 使用 total circumference 作为 dasharray，并用 dashoffset 控制进度
                    strokeDasharray={String(c)}
                    strokeDashoffset={String(Math.max(0, c - dash))}
                    style={{
                      transform: 'rotate(-90deg)',
                      transformOrigin: 'center',
                      transition: 'stroke-dashoffset 200ms linear',
                    }}
                  />
                </g>
              </svg>
            )
          : null}
        {/* lucide icon，使用 currentColor 以便用 Tailwind 控制颜色 */}
        <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <ArrowUp className="w-5 h-5 text-primary" />
        </span>
      </button>
    </div>
  )

  // 用 portal 渲染到 body，避免被父级 transform/overflow 影响
  if (!mounted || typeof document === 'undefined')
    return null
  // 直接返回元素（不使用 react-dom）
  return node
}
