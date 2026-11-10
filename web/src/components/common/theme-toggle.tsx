import type React from 'react'
import { Contrast, Moon, Sun } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useDevice } from '@/contexts/device-context'
import { cn } from '@/lib/utils'

type ThemeMode = 'light' | 'dark' | 'system'

// 滑动高亮块的弹簧（刚度 400、阻尼 30、质量 1，阻尼比 0.75，约 0.39 秒停稳）采样成 CSS linear() 缓动，观感同原来 motion 的弹簧
const SEGMENT_SPRING_EASING = 'linear(0, 0.044, 0.1489, 0.2829, 0.424, 0.558, 0.6766, 0.7762, 0.8558, 0.9167, 0.9611, 0.9917, 1.0112, 1.0223, 1.0274, 1.0283, 1.0265, 1.0233, 1.0194, 1.0154, 1.0117, 1.0085, 1.0058, 1.0036, 1)'

// PC端：三状态轮换按钮
export function ThemeModeCycleButton({
  mode,
  setMode,
  className,
}: {
  mode: ThemeMode
  setMode: (m: ThemeMode) => void
  className?: string
}) {
  const t = useTranslations('ThemeMode')
  const nextMode = (mode: ThemeMode): ThemeMode => {
    if (mode === 'light')
      return 'dark'
    if (mode === 'dark')
      return 'system'
    return 'light'
  }
  // 跟随系统用日月合一的 SunMoon，与亮/暗图标同属一套隐喻，一眼可知是「自动切换」
  const Icon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Contrast
  return (
    <button
      type="button"
      className={cn('inline-flex items-center justify-center', className)}
      onClick={() => setMode(nextMode(mode))}
      title={t(`${mode}_mode`)}
      aria-label={t(`${mode}_mode`)}
    >
      <Icon aria-hidden className="size-5" />
    </button>
  )
}

// 移动端：横向按钮组
export function ThemeModeSegmented(
  props: React.HTMLAttributes<HTMLDivElement> & {
    mode: ThemeMode
    setMode: (m: ThemeMode) => void
  },
) {
  const { mode, setMode, className, style, ...rest } = props
  const t = useTranslations('ThemeMode')
  const modes: { value: ThemeMode, icon: React.ReactNode, label: string }[] = [
    { value: 'light', icon: <Sun className="w-4 h-4" />, label: t('light_mode') },
    {
      value: 'system',
      icon: <Contrast className="w-4 h-4" />,
      label: t('system_mode'),
    },
    { value: 'dark', icon: <Moon className="w-4 h-4" />, label: t('dark_mode') },
  ]
  const activeIndex = modes.findIndex(m => m.value === mode)
  const baseCls = 'relative inline-flex gap-1 overflow-hidden rounded-lg bg-muted p-1'

  return (
    <div className={cn('theme-mode-segmented-wrapper', className)} style={style} {...rest}>
      <div className={baseCls}>
        {/* 滑动高亮块：纯 CSS 位移过渡，减少动态效果时直接跳到目标位置 */}
        <div
          className="absolute top-1 left-1 z-1 h-8 w-12 rounded-md bg-card shadow-sm transition-transform duration-[386ms] motion-reduce:transition-none"
          style={{
            transform: `translateX(calc(${activeIndex} * (3rem + 0.25rem)))`,
            transitionTimingFunction: SEGMENT_SPRING_EASING,
          }}
        />
        {modes.map(m => (
          <button
            key={m.value}
            className={cn(
              'relative z-10 flex h-8 w-12 items-center justify-center rounded-md text-sm font-medium transition-colors',
              mode === m.value ? 'text-primary' : 'text-muted-foreground',
            )}
            onClick={() => setMode(m.value)}
            type="button"
            aria-label={m.label}
            aria-pressed={mode === m.value}
            title={m.label}
          >
            {m.icon}
          </button>
        ))}
      </div>
    </div>
  )
}

// 总组件：根据设备类型渲染
export function ThemeModeToggle(
  props: React.HTMLAttributes<HTMLElement> & { showSegmented?: boolean },
) {
  const { mode, setMode } = useDevice()
  const Comp: React.ElementType = props.showSegmented ? ThemeModeSegmented : ThemeModeCycleButton
  const { className, style } = props
  return <Comp mode={mode} setMode={setMode} className={className} style={style} />
}
