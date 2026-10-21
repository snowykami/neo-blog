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
}: {
  mode: ThemeMode
  setMode: (m: ThemeMode) => void
}) {
  const t = useTranslations('ThemeMode')
  const nextMode = (mode: ThemeMode): ThemeMode => {
    if (mode === 'light')
      return 'dark'
    if (mode === 'dark')
      return 'system'
    return 'light'
  }
  const icon
    = mode === 'light'
      ? (
          <Sun className="w-6 h-6" />
        )
      : mode === 'dark'
        ? (
            <Moon className="w-6 h-6" />
          )
        : (
            <EclipseIcon className="w-6 h-6" />
          )
  return (
    <div
      className="flex items-center justify-center"
      onClick={() => setMode(nextMode(mode))}
      title={t(`${mode}_mode`)}
      aria-label={t(`${mode}_mode`)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          // 阻止空格键默认的页面滚动
          e.preventDefault()
          setMode(nextMode(mode))
        }
      }}
    >
      {icon}
    </div>
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
  const baseCls = 'relative inline-flex bg-muted rounded-full p-1 gap-1 overflow-hidden'

  return (
    <div className={cn('theme-mode-segmented-wrapper', className)} style={style} {...rest}>
      <div className={baseCls}>
        {/* 滑动高亮块 */}
        <motion.div
          layout
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="absolute w-12 h-8 rounded-full bg-white/70 shadow-sm z-1 top-1"
          style={{
            left: `calc(0.25rem + ${activeIndex} * (3rem + 0.25rem))`,
          }}
        />
        {modes.map(m => (
          <button
            key={m.value}
            className={cn(
              'relative flex items-center justify-center w-12 h-8 rounded-full text-sm font-medium transition-all z-10',
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
