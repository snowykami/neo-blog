import { cn } from '@/lib/utils'

const RADIUS = 7
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** 顶栏灵动岛的环形进度（阅读进度、上传进度）：底环为当前文字色的 20%，进度为站点主色；percent 为 0 ~ 100 */
export function ProgressRing({ percent, className }: { percent: number, className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 18 18" className={cn('size-[18px] shrink-0 -rotate-90', className)}>
      <circle cx="9" cy="9" r={RADIUS} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={2.5} />
      <circle
        cx="9"
        cy="9"
        r={RADIUS}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={CIRCUMFERENCE * (1 - percent / 100)}
        className="transition-[stroke-dashoffset] duration-200"
      />
    </svg>
  )
}
