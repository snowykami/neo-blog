import { cn } from '@/lib/utils'

/**
 * 游客头像：柔和底色 + 视觉居中的圆角实心人像剪影，用于未登录时的评论框等位置
 */
export function GuestAvatar({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-linear-to-br from-muted to-border/85 text-muted-foreground ring-1 ring-foreground/6 ring-inset',
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-[60%] fill-current opacity-60">
        <circle cx="12" cy="7.5" r="4.25" />
        <path d="M4 19.2c0-3.4 3.58-5.7 8-5.7s8 2.3 8 5.7c0 1-.8 1.8-1.8 1.8H5.8c-1 0-1.8-.8-1.8-1.8Z" />
      </svg>
    </span>
  )
}
