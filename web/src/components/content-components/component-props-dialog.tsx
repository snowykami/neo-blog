'use client'

import type { FieldValues, Resolver } from 'react-hook-form'
import type { FieldDescriptor } from './schema-fields'
import type { AnyContentComponentDef } from './types'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo } from 'react'
import { useFieldArray, useForm, useFormContext } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { createIssueMessage, describeFields } from './schema-fields'

type Translate = ReturnType<typeof useTranslations<'ContentComponents'>>

interface FieldProps {
  field: FieldDescriptor
  // 表单中的完整路径，列表项为 `tabs.0.label`
  path: string
  component: string
  t: Translate
}

/** 单个字段：文案取 ContentComponents.<组件>.fields / placeholders / descriptions / options */
function SchemaField({ field, path, component, t }: FieldProps) {
  const { control } = useFormContext()
  if (field.kind === 'list')
    return <SchemaListField field={field} path={path} component={component} t={t} />

  const key = (group: string) => `${component}.${group}.${field.name}`
  const label = t(key('fields'))
  const placeholder = t.has(key('placeholders')) ? t(key('placeholders')) : undefined
  const description = t.has(key('descriptions')) ? t(key('descriptions')) : undefined

  return (
    <FormField
      control={control}
      name={path}
      render={({ field: input }) => (
        <FormItem className={cn('grid gap-2', field.kind === 'switch' && 'flex items-center justify-between gap-3')}>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            {field.kind === 'select'
              ? (
                  <Select value={input.value ?? ''} onValueChange={input.onChange}>
                    <SelectTrigger className="w-full" onBlur={input.onBlur}>
                      <SelectValue placeholder={placeholder} />
                    </SelectTrigger>
                    <SelectContent>
                      {field.options.map(option => (
                        <SelectItem key={option} value={option}>
                          {t.has(`${key('options')}.${option}`) ? t(`${key('options')}.${option}`) : option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )
              : field.kind === 'switch'
                ? <Switch checked={!!input.value} onCheckedChange={input.onChange} onBlur={input.onBlur} />
                : field.kind === 'number'
                  ? (
                      <Input
                        {...input}
                        type="number"
                        inputMode="numeric"
                        placeholder={placeholder}
                        value={Number.isFinite(input.value) && input.value !== 0 ? input.value : ''}
                        onChange={e => input.onChange(e.target.value === '' ? 0 : e.target.valueAsNumber)}
                      />
                    )
                  : field.kind === 'text'
                    ? <Input {...input} value={input.value ?? ''} placeholder={placeholder} />
                    : (
                        <Textarea
                          {...input}
                          value={input.value ?? ''}
                          placeholder={placeholder}
                          spellCheck={field.kind !== 'code'}
                          className={cn(field.kind === 'code' ? 'min-h-44 font-mono text-[13px] leading-5' : 'min-h-24')}
                        />
                      )}
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

/** 对象数组：逐项编辑，支持添加、删除与调整顺序，数量受 schema 的 min / max 限制 */
function SchemaListField({ field, path, component, t }: FieldProps & { field: Extract<FieldDescriptor, { kind: 'list' }> }) {
  const { control, formState } = useFormContext()
  const { fields, append, remove, move } = useFieldArray({ control, name: path })
  const rootError = formState.errors[path] as { root?: { message?: string }, message?: string } | undefined
  const errorMessage = rootError?.root?.message ?? rootError?.message

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{t(`${component}.fields.${field.name}`)}</span>
        <Button type="button" variant="outline" size="sm" disabled={fields.length >= field.max} onClick={() => append({ ...field.itemDefault })}>
          <PlusIcon />
          {t('add_item')}
        </Button>
      </div>
      {fields.map((item, index) => (
        <div key={item.id} className="grid gap-4 rounded-lg border p-3">
          <div className="flex items-center gap-1">
            <span className="mr-auto text-xs font-medium text-muted-foreground">{t('item_index', { index: index + 1 })}</span>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t('move_up')} disabled={index === 0} onClick={() => move(index, index - 1)}>
              <ArrowUpIcon />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t('move_down')} disabled={index === fields.length - 1} onClick={() => move(index, index + 1)}>
              <ArrowDownIcon />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('remove_item')}
              className="text-destructive hover:text-destructive"
              disabled={fields.length <= field.min}
              onClick={() => remove(index)}
            >
              <Trash2Icon />
            </Button>
          </div>
          {field.fields.map(child => (
            <SchemaField key={child.name} field={child} path={`${path}.${index}.${child.name}`} component={component} t={t} />
          ))}
        </div>
      ))}
      {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}
    </div>
  )
}

export interface ComponentPropsDialogProps {
  def: AnyContentComponentDef
  open: boolean
  onOpenChange: (open: boolean) => void
  // 当前 props；校验失败的旧数据也会作为初始值，由表单提示修正
  value: Record<string, unknown>
  onSubmit: (props: Record<string, unknown>) => void
}

/** 组件属性编辑弹窗：按组件 schema 生成 react-hook-form 表单，提交时按 schema 校验并补齐默认值 */
export function ComponentPropsDialog({ def, open, onOpenChange, value, onSubmit }: ComponentPropsDialogProps) {
  const t = useTranslations('ContentComponents')
  const fields = useMemo(() => describeFields(def.schema), [def])
  const resolver = useMemo(
    () => zodResolver(def.schema, { error: createIssueMessage(t) }) as unknown as Resolver<FieldValues>,
    [def, t],
  )
  const form = useForm<FieldValues>({ resolver, defaultValues: value })

  // 每次打开时以当前 props 重置
  useEffect(() => {
    if (open)
      form.reset(value)
  }, [open, value, form])

  const name = t(`${def.name}.name`)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('edit_title', { name })}</DialogTitle>
          <DialogDescription>{t(`${def.name}.description`)}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              // 弹窗渲染在编辑器之外，但 React 事件仍会沿组件树冒泡到节点视图，这里阻止
              event.stopPropagation()
              void form.handleSubmit((data) => {
                onSubmit(data)
                onOpenChange(false)
              })(event)
            }}
          >
            {fields.map(field => (
              <SchemaField key={field.name} field={field} path={field.name} component={def.name} t={t} />
            ))}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('cancel')}</Button>
              <Button type="submit">{t('save')}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
