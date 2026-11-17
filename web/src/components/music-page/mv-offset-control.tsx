'use client'

import { ClapperboardIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { formatMvOffset } from './use-mv-sync'

const MV_OFFSET_STEPS = [-1000, -100, 100, 1000] as const

function formatStepLabel(stepMs: number): string {
  const seconds = stepMs / 1000
  return stepMs > 0 ? `+${seconds}s` : `${seconds}s`
}

export interface MvOffsetControlProps {
  offsetMs: number
  disabled: boolean
  saving: boolean
  isDirty: boolean
  onAdjustOffset: (nextOffsetMs: number) => void
  onDisabledChange: (nextDisabled: boolean) => void
  onSave: () => Promise<boolean>
  className?: string
}

/**
 * 管理员封面 MV 设置浮层：仅管理员可见（后端接口同样限管理员），支持 -1s / -0.1s / +0.1s / +1s 实时预览微调、
 * 归零、禁用该歌曲 MV 与点击保存持久化
 */
export function MvOffsetControl({
  offsetMs,
  disabled,
  saving,
  isDirty,
  onAdjustOffset,
  onDisabledChange,
  onSave,
  className,
}: MvOffsetControlProps) {
  const t = useTranslations('MusicPage')

  const handleSave = async () => {
    const ok = await onSave()
    if (ok)
      toast.success(t('mv_setting_saved'))
    else
      toast.error(t('mv_setting_save_failed'))
  }

  return (
    <Popover>
      <PopoverTrigger
        type="button"
        title={t('mv_setting_title')}
        aria-label={t('mv_setting_title')}
        onClick={e => e.stopPropagation()}
        className={cn(
          'pointer-events-auto inline-flex h-7 items-center gap-1 rounded-full bg-black/55 px-2.5 text-xs font-medium text-white/90 shadow-sm backdrop-blur-md transition-colors hover:bg-black/75 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none',
          className,
        )}
      >
        <ClapperboardIcon aria-hidden className="size-3.5" />
        <span>MV</span>
        {!disabled && offsetMs !== 0 && (
          <span className="tabular-nums text-white/75">{formatMvOffset(offsetMs)}</span>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        className="grid w-72 gap-3.5"
        onClick={e => e.stopPropagation()}
      >
        <div className="grid gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium">{t('mv_setting_title')}</span>
            <span className="text-lg font-semibold tabular-nums">{formatMvOffset(offsetMs)}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('mv_offset_hint')}
          </p>
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          {MV_OFFSET_STEPS.map(step => (
            <Button
              key={step}
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              className="px-2 tabular-nums"
              onClick={() => onAdjustOffset(offsetMs + step)}
            >
              {formatStepLabel(step)}
            </Button>
          ))}
        </div>

        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
          <span>{t('mv_disable_label')}</span>
          <Switch
            checked={disabled}
            onCheckedChange={onDisabledChange}
            aria-label={t('mv_disable_label')}
          />
        </label>

        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled || offsetMs === 0}
            onClick={() => onAdjustOffset(0)}
          >
            {t('mv_offset_reset')}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={saving || !isDirty}
            onClick={() => { void handleSave() }}
          >
            {saving ? t('mv_setting_saving') : t('mv_setting_save')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
