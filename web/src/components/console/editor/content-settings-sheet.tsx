'use client'

import type { LucideIcon } from 'lucide-react'
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form'
import type { ContentMeta } from '@/hooks/use-content-editor'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { AssetField } from '@/components/common/asset-picker'
import { LabelWithInfo } from '@/components/common/info-tooltip'
import { Button } from '@/components/ui/button'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'

/**
 * 编辑器设置抽屉的外框：标题、可滚动的表单区与“自动保存”提示
 */
export function ContentSettingsSheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: React.ReactNode
}) {
  const t = useTranslations('Console.editor')
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="gap-0 bg-card max-sm:w-full sm:max-w-[420px] md:inset-y-2 md:right-2 md:h-auto md:rounded-2xl md:border"
      >
        <SheetHeader className="px-5 pt-4 pb-3">
          <SheetTitle className="flex items-center gap-2.5 text-base">
            <span aria-hidden="true" className="h-4 w-1 rounded-full bg-primary" />
            {title}
          </SheetTitle>
          <SheetDescription className="sr-only">{t('settings_autosave_hint')}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-1 pb-5">
          {children}
        </div>
        <SheetFooter className="flex-row items-center gap-2 border-t px-5 py-3">
          <span className="flex-1 text-xs text-muted-foreground">{t('settings_autosave_hint')}</span>
          <Button size="sm" onClick={() => onOpenChange(false)}>{t('done')}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/** 设置分组：图标 + 标题 */
export function SettingsSection({ icon: Icon, title, children }: { icon: LucideIcon, title: string, children: React.ReactNode }) {
  return (
    <section className="grid gap-4 not-first:mt-6">
      <h3 className="flex items-center gap-2 text-[13px] font-semibold text-foreground/75">
        <Icon className="size-[15px]" />
        {title}
      </h3>
      {children}
    </section>
  )
}

/**
 * 把设置表单的修改同步到编辑器：字段校验通过后写入元信息（随后由编辑器统一自动保存）
 */
export function useSyncSettingsForm<T extends FieldValues>(
  form: UseFormReturn<T>,
  open: boolean,
  values: T,
  onChange: (patch: Partial<ContentMeta>) => void,
) {
  // 每次打开时用最新的元信息重置表单（打开期间不覆盖用户正在编辑的内容）
  const latestRef = React.useRef(values)
  latestRef.current = values
  React.useEffect(() => {
    if (open)
      form.reset(latestRef.current)
  }, [open, form])

  const onChangeRef = React.useRef(onChange)
  onChangeRef.current = onChange
  React.useEffect(() => {
    const subscription = form.watch((_value, { name }) => {
      // reset 时 name 为空，不触发保存；用户输入与 setValue 都会带上字段名
      if (!name)
        return
      const field = name.split('.')[0] as Path<T>
      void form.trigger(field).then((valid) => {
        if (valid)
          onChangeRef.current({ [field]: form.getValues(field) } as Partial<ContentMeta>)
      })
    })
    return () => subscription.unsubscribe()
  }, [form])
}

/** 封面：预览 + 地址输入 + 从资产库选择 / 本地上传 / 移除 */
export function CoverField<T extends FieldValues>({ form, name, label, hint }: { form: UseFormReturn<T>, name: Path<T>, label: string, hint?: string }) {
  const t = useTranslations('Console.editor')
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <LabelWithInfo info={hint ?? t('cover_hint')}><FormLabel>{label}</FormLabel></LabelWithInfo>
          <FormControl>
            <AssetField
              {...field}
              value={field.value as string}
              variant="cover"
              emptyText={t('cover_empty')}
              placeholder={t('cover_url_placeholder')}
            />
          </FormControl>
        </FormItem>
      )}
    />
  )
}

/** 开关行：标题 + 说明 + Switch */
export function SwitchField<T extends FieldValues>({ form, name, label, description }: { form: UseFormReturn<T>, name: Path<T>, label: string, description?: string }) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="flex items-center gap-3">
          <LabelWithInfo info={description} className="flex-1"><FormLabel>{label}</FormLabel></LabelWithInfo>
          <FormControl>
            <Switch checked={!!field.value} onCheckedChange={field.onChange} />
          </FormControl>
        </FormItem>
      )}
    />
  )
}

/** 数字输入（置顶权重、导航排序） */
export function NumberField<T extends FieldValues>({ form, name, label, description, min, max, step = 1 }: { form: UseFormReturn<T>, name: Path<T>, label: string, description?: string, min?: number, max?: number, step?: number | 'any' }) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <LabelWithInfo info={description}><FormLabel>{label}</FormLabel></LabelWithInfo>
          <FormControl>
            <Input
              type="number"
              inputMode="numeric"
              min={min}
              max={max}
              step={step}
              value={(field.value as number) ?? 0}
              onChange={e => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))}
              onBlur={field.onBlur}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
