import type React from 'react'
import { EclipseIcon, Moon, Sun } from 'lucide-react'
import { motion } from 'motion/react'
import { useTranslations } from 'next-intl'
import { useDevice } from '@/contexts/device-context'
import { cn } from '@/lib/utils'

type ThemeMode = 'light' | 'dark' | 'system'

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
  const Icon = mode === 'light' ? Sun : mode === 'dark' ? Moon : EclipseIcon
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
      icon: <EclipseIcon className="w-4 h-4" />,
      label: t('system_mode'),
    },
    { value: 'dark', icon: <Moon className="w-4 h-4" />, label: t('dark_mode') },
  ]
  const activeIndex = modes.findIndex(m => m.value === mode)
  const baseCls = 'relative inline-flex gap-1 overflow-hidden rounded-lg bg-muted p-1'

  return (
    <div className={cn('theme-mode-segmented-wrapper', className)} style={style} {...rest}>
      <div className={baseCls}>
        {/* 滑动高亮块 */}
        <motion.div
          layout
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="absolute top-1 z-1 h-8 w-12 rounded-md bg-card shadow-sm"
          style={{
            left: `calc(0.25rem + ${activeIndex} * (3rem + 0.25rem))`,
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
