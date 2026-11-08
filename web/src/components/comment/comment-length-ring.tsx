'use client'

import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

// 环的几何：viewBox 20×20，半径 8，描边 2（对应 28px 的实际尺寸）
const RADIUS = 8
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * 评论字数指示环：接近上限时才出现，环代表已用比例，环内数字是还能写多少，超出后变红显示超出多少。
 * 与 Twitter 的输入指示一致——平时不占视觉空间，快写满时给一个明确的手感
 */
export function CommentLengthRing({ used, max, className }: { used: number, max: number, className?: string }) {
  const t = useTranslations('Comment')
  const remaining = max - used
  const over = remaining < 0
  // 剩余较多时不显示；上限很小时按上限的比例给一个下限，避免一输入就出现
  const visibleWhen = Math.min(50, Math.max(20, Math.round(max * 0.1)))
  if (max <= 0 || (!over && remaining > visibleWhen))
    return null

  const ratio = Math.min(1, used / max)
  // 环内只放得下两位数字：超出太多（例如整段粘贴）时只保留变红的满环
  const showNumber = Math.abs(remaining) <= 99
  const description = over
    ? t('length_over', { over: -remaining, max })
    : t('length_remaining', { remaining })

  return (
    <span
      role="img"
      aria-label={description}
      title={description}
      className={cn('relative inline-flex size-7 shrink-0 items-center justify-center fade-in', className)}
    >
      <svg viewBox="0 0 20 20" className="absolute inset-0 size-7 -rotate-90" aria-hidden>
        <circle cx={10} cy={10} r={RADIUS} fill="none" strokeWidth={2} className="stroke-muted" />
        <circle
          cx={10}
          cy={10}
          r={RADIUS}
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - ratio)}
          className={cn(
            'transition-[stroke-dashoffset,stroke] duration-150',
            over ? 'stroke-destructive' : 'stroke-primary',
            ratio > 0.999 && !over && 'stroke-amber-500',
          )}
        />
      </svg>
      {showNumber && (
        <span className={cn('relative text-[10px] leading-none font-medium tabular-nums', over ? 'text-destructive' : 'text-muted-foreground')}>
          {remaining}
        </span>
      )}
    </span>
  )
}
