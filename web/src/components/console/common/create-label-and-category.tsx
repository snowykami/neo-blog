'use client'

import type { SubmitHandler } from 'react-hook-form'
import type { Category } from '@/models/category'
import type { Label } from '@/models/label'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { createLabel, updateLabel } from '@/api/label'
import { createCategory, updateCategory } from '@/api/post'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useOperationT } from '@/hooks/use-translations'
import { getErrorMessage } from '@/utils/common/error'

export function CreateOrUpdateLabelDialogWithButton({
  label,
  onLabelCreated,
  buttonSize = 'sm',
}: {
  label: Label | null
  onLabelCreated?: (label: Omit<Label, 'postCount'>) => void
  buttonSize?: 'sm' | 'lg' | 'icon' | 'icon-sm' | 'icon-lg' | 'default' | null | undefined
}) {
  const t = useTranslations('Console.labels')
  const operationT = useOperationT()
  const [open, setOpen] = useState(false)

  const form = useForm<{
    name: string
    slug: string
    tailwindClassName: string
  }>({
    mode: 'onChange',
    defaultValues: label
      ? {
          name: label.name,
          slug: label.slug,
          tailwindClassName: label.tailwindClassName,
        }
      : { name: '', slug: '', tailwindClassName: '' },
  })

  const onSubmit: SubmitHandler<{
    name: string
    slug: string
    tailwindClassName: string
  }> = async (data) => {
    if (data.name.trim() === '' || data.slug.trim() === '') {
      toast.error(t('label_name_and_slug_cannot_be_empty'))
      return
    }
    if (label) {
      await updateLabel({
        label: {
          id: label.id,
          name: data.name,
          slug: data.slug,
          tailwindClassName: data.tailwindClassName,
        },
      })
        .then(() => {
          toast.success(operationT('update_success'))
          onLabelCreated?.({
            id: label.id,
            name: data.name,
            slug: data.slug,
            tailwindClassName: data.tailwindClassName,
          })
          setOpen(false)
          // 以新值作为表单基准，否则再次打开会回退到挂载时的旧值
          form.reset(data)
        })
        .catch((error) => {
          const message = getErrorMessage(error)
          toast.error(operationT('update_failed') + (message ? `: ${message}` : ''))
        })
    }
    else {
      await createLabel({
        label: {
          name: data.name,
          slug: data.slug,
          tailwindClassName: data.tailwindClassName,
        },
      })
        .then((res) => {
          toast.success(operationT('create_success'))
          onLabelCreated?.({
            id: res.data.id,
            name: data.name,
            slug: data.slug,
            tailwindClassName: data.tailwindClassName,
          })
          setOpen(false)
          form.reset()
        })
        .catch((error) => {
          const message = getErrorMessage(error)
          toast.error(operationT('create_failed') + (message ? `: ${message}` : ''))
        })
    }
  }
  const handleCancel = () => {
    form.reset()
    setOpen(false)
  }

  // 打开时用最新的 label 重置表单，避免显示挂载时的旧值
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      form.reset(label
        ? { name: label.name, slug: label.slug, tailwindClassName: label.tailwindClassName }
        : { name: '', slug: '', tailwindClassName: '' })
    }
    setOpen(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size={buttonSize}>
          {label ? t('edit_label') : t('create_label')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label ? t('edit_label') : t('create_label')}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
            <FormField
              control={form.control}
              name="name"
              rules={{
                required: {
                  value: true,
                  message: t('label_name_and_slug_cannot_be_empty'),
                },
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('label_name')}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="slug"
              rules={{
                required: {
                  value: true,
                  message: t('label_name_and_slug_cannot_be_empty'),
                },
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('label_slug')}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="tailwindClassName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('label_tailwind_class')}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <DialogFooter>
              <div className="flex gap-3">
                <Button onClick={handleCancel} variant="outline" type="button">
                  {operationT('cancel')}
                </Button>
                {/* 只通过表单 submit 触发一次提交，成功后再关闭对话框 */}
                <Button disabled={!form.formState.isValid || form.formState.isSubmitting} type="submit">
                  {label ? operationT('update') : operationT('create')}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

export function CreateOrUpdateCategoryDialogWithButton({
  category,
  onSaved,
  buttonSize = 'sm',
}: {
  category: Category | null
  onSaved?: (category: Category) => void
  buttonSize?: 'sm' | 'lg' | 'icon' | 'icon-sm' | 'icon-lg' | 'default' | null | undefined
}) {
  const t = useTranslations('Console.categories')
  const operationT = useOperationT()
  const [open, setOpen] = useState(false)

  const form = useForm<{ name: string, slug: string, description: string }>({
    mode: 'onChange',
    defaultValues: category
      ? {
          name: category.name,
          slug: category.slug,
          description: category.description,
        }
      : { name: '', slug: '', description: '' },
  })

  const onSubmit: SubmitHandler<{
    name: string
    slug: string
    description: string
  }> = async (data) => {
    // 防止只有空格提交（双重保险）
    if (data.name.trim() === '' || data.slug.trim() === '') {
      toast.error(t('category_name_and_slug_cannot_be_empty'))
      return
    }
    if (category) {
      await updateCategory({
        category: {
          id: category.id,
          name: data.name.trim(),
          slug: data.slug.trim(),
          description: data.description.trim(),
        },
      })
        .then(() => {
          toast.success(operationT('update_success'))
          const saved = {
            name: data.name.trim(),
            slug: data.slug.trim(),
            description: data.description.trim(),
          }
          onSaved?.({ id: category.id, ...saved })
          setOpen(false)
          // 以新值作为表单基准，否则再次打开会回退到挂载时的旧值
          form.reset(saved)
        })
        .catch((error) => {
          const message = getErrorMessage(error)
          toast.error(operationT('update_failed') + (message ? `: ${message}` : ''))
        })
    }
    else {
      await createCategory({
        category: {
          name: data.name.trim(),
          slug: data.slug.trim(),
          description: data.description.trim(),
        },
      })
        .then((res) => {
          toast.success(operationT('create_success'))
          onSaved?.({
            id: res.data.id,
            name: data.name.trim(),
            slug: data.slug.trim(),
            description: data.description.trim(),
          })
          setOpen(false)
          form.reset()
        })
        .catch((error) => {
          const message = getErrorMessage(error)
          toast.error(operationT('create_failed') + (message ? `: ${message}` : ''))
        })
    }
  }

  const handleCancel = () => {
    form.reset()
    setOpen(false)
  }

  // 打开时用最新的 category 重置表单，避免显示挂载时的旧值
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      form.reset(category
        ? { name: category.name, slug: category.slug, description: category.description }
        : { name: '', slug: '', description: '' })
    }
    setOpen(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size={buttonSize}>
          {category ? t('edit_category') : t('create_category')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{category ? t('edit_category') : t('create_category')}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
            <FormField
              control={form.control}
              name="name"
              rules={{
                required: {
                  value: true,
                  message: t('category_name_and_slug_cannot_be_empty'),
                },
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('category_name')}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="slug"
              rules={{
                required: {
                  value: true,
                  message: t('category_name_and_slug_cannot_be_empty'),
                },
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('category_slug')}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('category_description')}</FormLabel>
                  <FormControl>
                    <Textarea {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <DialogFooter>
              <div className="flex gap-3">
                <Button onClick={handleCancel} variant="outline" type="button">
                  {operationT('cancel')}
                </Button>
                {/* 只通过表单 submit 触发一次提交，成功后再关闭对话框 */}
                <Button disabled={!form.formState.isValid || form.formState.isSubmitting} type="submit">
                  {category ? operationT('update') : operationT('create')}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
