'use client'

import { useId, useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * 请求/秒的迷你趋势线：退后的灰色折线 + 淡色面积，当前值用主题色圆点标出；
 * 悬停时竖线对齐最近的点并显示那时的数值。同一张表的趋势线传入相同的 scaleMax，副本之间的高低可以直接比较
 */
export function RuntimeSparkline({ values, scaleMax, width = 120, height = 28, label, formatPoint, className }: {
  values: number[]
  scaleMax?: number
  width?: number
  height?: number
  label: string // 无障碍名称，说明最低、最高与当前值
  formatPoint: (value: number, index: number) => { value: string, detail: string }
  className?: string
}) {
  const gradientId = useId()
  const [hover, setHover] = useState<number | null>(null)
  const points = values.length > 0 ? values : [0]
  const max = Math.max(1, scaleMax ?? 0, ...points) * 1.1
  const x = (i: number) => (points.length === 1 ? width : (i / (points.length - 1)) * width)
  const y = (v: number) => height - (v / max) * (height - 4) - 2
  const line = points.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const last = points.length - 1
  const hovered = hover === null ? null : formatPoint(points[hover], hover)

  // 提示框经 Portal 渲染，不会被表格的横向滚动容器裁掉
  return (
    <Tooltip open={hovered !== null}>
      <TooltipTrigger asChild>
        <div className={cn('relative', className)} style={{ width, height }}>
          <svg width={width} height={height} role="img" aria-label={label} className="block overflow-visible">
            <defs>
              <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.14} />
                <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} className="stroke-border" strokeWidth={1} />
            <path d={`M0,${height} L${line.replaceAll(' ', ' L')} L${x(last)},${height} Z`} fill={`url(#${gradientId})`} />
            <polyline points={line} fill="none" className="stroke-muted-foreground/70" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={x(last)} cy={y(points[last])} r={4} className="fill-primary stroke-card" strokeWidth={2} />
            {hover !== null && (
              <>
                <line x1={x(hover)} x2={x(hover)} y1={0} y2={height} className="stroke-muted-foreground/60" strokeWidth={1} />
                <circle cx={x(hover)} cy={y(points[hover])} r={4} className="fill-primary stroke-card" strokeWidth={2} />
              </>
            )}
            {/* 命中区比折线大：整块区域都响应，指针只需横向对准时间 */}
            <rect
              x={-4}
              y={-6}
              width={width + 8}
              height={height + 12}
              fill="transparent"
              onPointerMove={(e) => {
                const rect = e.currentTarget.ownerSVGElement?.getBoundingClientRect()
                if (!rect)
                  return
                const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / width))
                setHover(Math.round(ratio * last))
              }}
              onPointerLeave={() => setHover(null)}
            />
          </svg>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        {hovered && (
          <div className="grid gap-0.5">
            <span className="font-semibold tabular-nums">{hovered.value}</span>
            <span className="opacity-80">{hovered.detail}</span>
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
