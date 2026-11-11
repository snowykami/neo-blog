import { cn } from '@/lib/utils'

/**
 * 前台页面布局壳：页宽居中，lg 及以上为「正文 + 右侧栏」两栏，以下侧栏落到正文下方
 * - 不传 sidebar 时为单栏
 * - stickySidebar 为 true（默认）时整个侧栏吸顶并限制在视口高度内滚动；
 *   为 false 时侧栏与正文等高，由侧栏内部自行决定吸顶的部分（如文章页只让目录吸顶）
 * 首屏入场动画为纯 CSS（见 styles/animation.css）：侧栏 100ms、正文 150ms；客户端跳转播放轻快版（侧栏 0、正文 50ms，250ms）
 * - skeleton：加载骨架（loading.tsx、Suspense 的占位）。骨架换成正文时，正文接着骨架的入场动画往下播、不再从头播一遍
 *   （见 components/layout/entrance-once.tsx 的 entranceContinueScript）
 */
export function SiteShell({
  children,
  sidebar,
  stickySidebar = true,
  skeleton = false,
  className,
}: {
  children: React.ReactNode
  sidebar?: React.ReactNode
  stickySidebar?: boolean
  skeleton?: boolean
  className?: string
}) {
  return (
    <div
      data-site-shell={skeleton ? 'skeleton' : 'page'}
      className={cn(
        // 显式声明 minmax(0,1fr) 轨道：隐式 auto 轨道会被长代码行等不可折行内容撑宽
        'mx-auto grid w-full max-w-[var(--page-w)] grid-cols-[minmax(0,1fr)] gap-4 px-0 py-6 md:px-4 md:py-8',
        sidebar && 'lg:grid-cols-[minmax(0,1fr)_var(--sidebar-w)]',
        className,
      )}
    >
      <div className="enter-fade-up enter-delay-150 grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4">{children}</div>
      {sidebar && (
        <aside
          className={cn(
            'enter-fade-up enter-delay-100 min-w-0',
            stickySidebar
            && 'lg:sticky lg:top-[calc(var(--nav-h)+1rem)] lg:max-h-[calc(100dvh-var(--nav-h)-2rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain hide-scrollbar',
          )}
        >
          {sidebar}
        </aside>
      )}
    </div>
  )
}

/**
 * 区块标题：左侧 4×16px 主色短色条，是前台唯一的品牌标识元素
 */
export function SectionTitle({
  as: Comp = 'h2',
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & { as?: 'h1' | 'h2' | 'h3' | 'div' }) {
  return (
    <Comp
      className={cn(
        'relative pl-4 font-bold text-foreground/90 before:absolute before:top-1/2 before:left-0 before:h-4 before:w-1 before:-translate-y-1/2 before:rounded-md before:bg-primary',
        className,
      )}
      {...props}
    >
      {children}
    </Comp>
  )
}
