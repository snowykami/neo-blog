'use client'

import type { AssetPickerProps } from './asset-picker'
import { FolderOpenIcon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { SafeImage } from '@/components/common/safe-image'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { AssetPicker } from './asset-picker'

export type AssetFieldProps = Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'type' | 'accept' | 'multiple'> & {
  value?: string | null
  onChange: (value: string) => void
  /** 默认 image/*，图片类型会显示预览 */
  accept?: string
  /**
   * inline：小缩略图 + 地址输入 + 按钮，适合设置表单；
   * cover：上方大图预览（默认 16:9），适合封面、背景图
   */
  variant?: 'inline' | 'cover'
  /** 是否显示预览，默认图片类型显示 */
  preview?: boolean
  previewClassName?: string
  /** 预览为空时的提示 */
  emptyText?: string
  /** 是否显示清除按钮，默认 true */
  clearable?: boolean
  /** 额外按钮（例如裁剪），显示在选择按钮之后 */
  actions?: React.ReactNode
  pickerProps?: Omit<AssetPickerProps, 'children' | 'onSelect' | 'accept' | 'multiple'>
}

/**
 * 文件地址字段：可手动粘贴地址，也可从资产库选择 / 本地上传；可直接展开 react-hook-form 的 field 使用
 */
export function AssetField({
  value,
  onChange,
  accept = 'image/*',
  variant = 'inline',
  preview = true,
  previewClassName,
  emptyText,
  clearable = true,
  actions,
  pickerProps,
  className,
  disabled,
  placeholder,
  ...inputProps
}: AssetFieldProps) {
  const t = useTranslations('AssetPicker')
  const showPreview = preview && accept.split(',').every(token => token.trim().startsWith('image/'))
  const url = value ?? ''

  const picker = (
    <AssetPicker accept={accept} onSelect={assets => assets[0] && onChange(assets[0].url)} {...pickerProps}>
      <Button type="button" variant={variant === 'cover' ? 'secondary' : 'outline'} size={variant === 'cover' ? 'sm' : 'default'} disabled={disabled}>
        <FolderOpenIcon />
        {t('choose')}
      </Button>
    </AssetPicker>
  )
  const clearButton = clearable && !!url && (
    <Button
      type="button"
      variant="ghost"
      size={variant === 'cover' ? 'sm' : 'icon'}
      disabled={disabled}
      aria-label={t('clear')}
      className="text-destructive hover:text-destructive"
      onClick={() => onChange('')}
    >
      <XIcon />
      {variant === 'cover' && t('clear')}
    </Button>
  )
  const input = (
    <Input
      type="text"
      inputMode="url"
      spellCheck={false}
      placeholder={placeholder ?? t('url_placeholder')}
      disabled={disabled}
      value={url}
      onChange={e => onChange(e.target.value)}
      {...inputProps}
    />
  )

  if (variant === 'cover') {
    return (
      <div className={cn('grid gap-2', className)}>
        {showPreview && (
          <div
            data-has-value={!!url}
            className={cn('relative grid aspect-video place-items-center overflow-hidden rounded-xl border border-dashed bg-muted/50 text-[13px] text-foreground/30 data-[has-value=true]:border-solid', previewClassName)}
          >
            {url
              ? <SafeImage src={url} alt="" fill className="object-cover" sizes="420px" />
              : <span>{emptyText ?? t('preview_empty')}</span>}
          </div>
        )}
        {input}
        <div className="flex flex-wrap gap-1.5">
          {picker}
          {actions}
          {clearButton}
        </div>
      </div>
    )
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {showPreview && (
        <div className={cn('relative size-9 shrink-0 overflow-hidden rounded-md border', previewClassName)}>
          <SafeImage src={url || null} alt="" fill sizes="36px" className="object-cover" fallback={<div className="size-full bg-muted" />} />
        </div>
      )}
      {input}
      {clearButton}
      {picker}
      {actions}
    </div>
  )
}
