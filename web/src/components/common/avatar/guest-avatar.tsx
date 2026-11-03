import { cn } from '@/lib/utils'

/**
 * 游客头像：柔和底色 + 实心人像剪影，用于未登录时的评论框等位置（替代线条较粗的 CircleUser 图标）
 */
export function GuestAvatar({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-linear-to-br from-muted to-border text-muted-foreground', className)}>
      <svg viewBox="0 0 24 24" className="mt-[18%] size-[62%] fill-current opacity-55">
        <circle cx="12" cy="7.5" r="4.5" />
        <path d="M3 22c0-5 4-8.5 9-8.5s9 3.5 9 8.5z" />
      </svg>
    </span>
  )
}
