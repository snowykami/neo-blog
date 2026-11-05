import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * 灵动岛胶囊内的比例（参考 iPhone 灵动岛紧凑态）：
 * - 胶囊高 36px，两端的封面、进度环、图标都放在 24px 的槽位里（约胶囊高的 2/3），槽位与胶囊端头的半圆同心，上下左右各留 6px；
 *   槽位里的线性图标为 18px，与 24px 的实心元素（封面、圆环）视觉上一样大
 * - 文字离胶囊两端、离槽位都约 10px（内容层留 6px、槽位间距 6px，文字自带 4px）
 * - 第二活动的小圆点直径同胶囊高，里面的元素同样 24px 居中
 */
export function IslandSlot({ children, className, morph }: { children: ReactNode, className?: string, morph?: string }) {
  return <span data-island-morph={morph} className={cn('relative flex size-6 shrink-0 items-center justify-center [&>svg]:size-[18px]', className)}>{children}</span>
}

/** 胶囊里的一段文字：过长时省略，两侧各留 4px */
export function IslandText({ children, className, morph }: { children: ReactNode, className?: string, morph?: string }) {
  return <span data-island-morph={morph} className={cn('relative min-w-0 truncate px-1', className)}>{children}</span>
}

// 圆环：直径 24px、线宽 3px（约直径的 1/8，同 AirPods 电量环），半径让描边正好贴着边缘
const RING_STROKE = 3
const RING_RADIUS = (24 - RING_STROKE) / 2
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

/**
 * 环形进度（阅读进度、上传进度）：同 AirPods 电量环——底环为当前文字色的 25%，进度为站点主色、圆头，从 12 点钟方向顺时针增长；
 * percent 为 0 ~ 100。默认 24px，可用 className 放大（线宽按比例缩放）
 */
export function ProgressRing({ percent, className, morph }: { percent: number, className?: string, morph?: string }) {
  return (
    <svg aria-hidden data-island-morph={morph} viewBox="0 0 24 24" className={cn('size-6 shrink-0 -rotate-90', className)}>
      <circle cx="12" cy="12" r={RING_RADIUS} fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={RING_STROKE} />
      <circle
        cx="12"
        cy="12"
        r={RING_RADIUS}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={RING_STROKE}
        strokeLinecap="round"
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={RING_CIRCUMFERENCE * (1 - Math.min(100, Math.max(0, percent)) / 100)}
        className="transition-[stroke-dashoffset] duration-200"
      />
    </svg>
  )
}
