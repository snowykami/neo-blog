'use client'

import type { FieldValues, Path, UseFormReturn } from 'react-hook-form'
import { XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useFormContext } from 'react-hook-form'
import { LabelWithInfo } from '@/components/common/info-tooltip'
import { Button } from '@/components/ui/button'
import { FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form'
import { Input } from '@/components/ui/input'

/**
 * 颜色输入：原生取色器（只认 #rrggbb）+ 自由文本（可写 oklch() 等），留空表示跟随主题。
 *
 * 不传 form 时走 react-hook-form 的 FormContext，方便在 FormProvider 里直接当普通字段用。
 */
export function ColorField<T extends FieldValues>({
  form,
  name,
  label,
  description,
}: {
  form?: UseFormReturn<T>
  name: Path<T>
  label: string
  description?: string
}) {
  const t = useTranslations('Console.global')
  const contextForm = useFormContext<T>()
  const control = (form ?? contextForm).control
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const value = (field.value as string) ?? ''
        return (
          <FormItem>
            <LabelWithInfo info={description}><FormLabel>{label}</FormLabel></LabelWithInfo>
            <div className="flex gap-3">
              <Input
                type="color"
                aria-label={t('pick_color')}
                className="w-12 shrink-0 cursor-pointer p-1"
                value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'}
                onChange={e => field.onChange(e.target.value)}
              />
              <FormControl>
                <Input
                  {...field}
                  value={value}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t('color_placeholder')}
                  className="font-mono"
                />
              </FormControl>
              {value && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t('clear_color')}
                  title={t('clear_color')}
                  onClick={() => field.onChange('')}
                >
                  <XIcon className="size-4" />
                </Button>
              )}
            </div>
          </FormItem>
        )
      }}
    />
  )
}
