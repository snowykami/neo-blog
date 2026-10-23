'use client'

import type { ProgressContentProps } from './progress.content'
import { Progress } from '@/components/ui/progress'

/** 进度条列表：名称 + 百分比 */
export default function ProgressContent({ items }: ProgressContentProps) {
  return (
    <div className="grid gap-3">
      {items.map((item, index) => (
        <div key={index} className="grid gap-1.5">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate">{item.label}</span>
            <span className="text-muted-foreground tabular-nums">
              {item.value}
              %
            </span>
          </div>
          <Progress value={item.value} aria-label={item.label} />
        </div>
      ))}
    </div>
  )
}
