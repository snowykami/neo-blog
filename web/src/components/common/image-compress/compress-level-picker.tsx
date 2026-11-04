'use client'

import type { CompressSizes } from '@/hooks/use-image-compress'
import { useTranslations } from 'next-intl'
import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { COMPRESS_MAX_WIDTH, COMPRESS_PRESETS, compressQuality, isCompressibleImage } from '@/utils/client/image-compress'
import { formatDataSize } from '@/utils/common/datasize'

/**
 * 图片压缩档位选择：分段控件，每档写明效果；传入 sizes 时改为展示各档位下所选图片的实际体积。
 * 方向键在档位间移动，空格 / 回车选中
 */
export function CompressLevelPicker({
  value,
  onValueChange,
  sizes,
  className,
}: {
  value: number
  onValueChange: (level: number) => void
  /** 各档位下所选图片的总体积，尚未算完的档位为 undefined */
  sizes?: CompressSizes
  className?: string
}) {
  const t = useTranslations('ImageCompress')
  const labelId = useId()

  const describe = (level: number) => {
    if (sizes) {
      const size = sizes[level]
      return size === undefined ? t('computing') : formatDataSize({ size })
    }
    return level === 0 ? t('no_compress') : t('quality', { quality: Math.round(compressQuality(level) * 100) })
  }

  return (
    <div className={cn('grid gap-2', className)}>
      <Label id={labelId}>{t('label')}</Label>
      <ToggleGroup
        type="single"
        variant="segmented"
        value={String(value)}
        // 单选，不允许取消选中
        onValueChange={next => next && onValueChange(Number(next))}
        aria-labelledby={labelId}
        className="grid w-full grid-cols-2 gap-[3px] sm:grid-cols-4"
      >
        {COMPRESS_PRESETS.map(({ key, level }) => (
          <ToggleGroupItem key={key} value={String(level)} className="h-auto min-h-12 flex-col gap-0.5 px-2 py-1.5">
            <span>{t(`preset_${key}`)}</span>
            <span className="text-xs font-normal tabular-nums text-muted-foreground">{describe(level)}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p className="text-xs text-muted-foreground">
        {value === 0 ? t('hint_original') : t('hint', { width: COMPRESS_MAX_WIDTH })}
      </p>
    </div>
  )
}

/**
 * 单个文件压缩前后的体积，如「4.80 MiB → 1.02 MiB，节省 79%」；非图片只显示体积
 */
export function CompressSizeChange({
  file,
  level,
  result,
}: {
  file: File
  level: number
  /** 当前档位下的上传结果，尚未压缩完成时为 undefined */
  result: File | undefined
}) {
  const t = useTranslations('ImageCompress')
  // 数值与单位之间用不换行空格，窄屏折行时不会把「36.15 KiB」拆开
  const format = (size: number) => formatDataSize({ size }).replace(' ', '\u00A0')
  const size = format(file.size)
  if (level === 0 || !file.type.startsWith('image/'))
    return size
  if (!isCompressibleImage(file))
    return t('unsupported', { size })
  if (!result)
    return t('size_computing', { size })
  if (result === file)
    return t('kept_original', { size })
  return t('size_saved', {
    before: size,
    after: format(result.size),
    percent: Math.round((1 - result.size / file.size) * 100),
  })
}
