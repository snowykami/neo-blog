'use client'

import type { SubmitHandler } from 'react-hook-form'
import type { PageModel } from '@/models/page'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { createPage, updatePage } from '@/api/page'
import { AssetField } from '@/components/common/asset-picker'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { useErrorMessageT, useOperationT, useResponseErrorDetailsT } from '@/hooks/use-translations'
import { getPageEditUrl } from '@/utils/common/route'

interface PageMetaForm {
  title: string
  slug: string
  cover: string
  description: string
  isPrivate: boolean
  showInNav: boolean
  navOrder: number
}

export function PageMetaDialog({
  onOpenChange,
  onPageChange,
  open,
  page,
}: {
  onOpenChange: (open: boolean) => void
  onPageChange: ({ page }: { page: Partial<PageModel> & Pick<PageModel, 'id'> }) => void
  open: boolean
  page: PageModel | null
}) {
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const errorDetailsT = useResponseErrorDetailsT()
  const t = useTranslations('Console.pages.meta')
  const router = useRouter()
  const form = useForm<PageMetaForm>({
    defaultValues: toFormValues(page),
  })

  // 每次打开对话框时用最新的 page 重置表单，避免列表中切换可见性后表单仍是旧值
  // 仅在由关闭变为打开时重置，打开期间 page 变化不覆盖用户正在编辑的内容
  const latestRef = useRef(page)
  latestRef.current = page
  useEffect(() => {
    if (open)
      form.reset(toFormValues(latestRef.current))
  }, [open, form])

  const onSubmit: SubmitHandler<PageMetaForm> = async (data) => {
    if (page) {
      await updatePage({
        page: {
          id: page.id,
          ...data,
          navOrder: Number(data.navOrder) || 0,
        },
      })
        .then(() => {
          toast.success(operationT('update_success'))
          onPageChange({ page: { id: page.id, ...data, navOrder: Number(data.navOrder) || 0 } })
          onOpenChange(false)
        })
        .catch((error) => {
          toast.error(`${operationT('update_failed')}: ${errorMessageT(error)}`)
        })
      return
    }

    await createPage({
      page: {
        ...data,
        navOrder: Number(data.navOrder) || 0,
        content: `<h1>${data.title}</h1>`,
        type: 'html',
      },
    })
      .then((res) => {
        toast.success(operationT('create_success'))
        onPageChange({
          page: {
            id: res.data.id,
            ...data,
            navOrder: Number(data.navOrder) || 0,
            content: `<h1>${data.title}</h1>`,
            type: 'html',
          },
        })
        form.reset()
        onOpenChange(false)
        // 创建后直接进入编辑器继续撰写正文
        router.push(getPageEditUrl({ id: res.data.id }))
      })
      .catch((error) => {
        toast.error(`${operationT('create_failed')}: ${errorMessageT(error)}`)
      })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{page ? t('edit_page') : t('create_page')}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
            <FormField
              control={form.control}
              name="title"
              rules={{ validate: value => !!value.trim() || t('title_and_slug_required') }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('title')}</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="slug"
              rules={{
                validate: (value) => {
                  if (!value.trim())
                    return t('title_and_slug_required')
                  return !isNumericSlug(value) || errorDetailsT('slug_cannot_be_numeric')
                },
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('slug')}</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="cover"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('cover')}</FormLabel>
                  <FormControl>
                    <AssetField {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('description')}</FormLabel>
                  <FormControl><Textarea {...field} /></FormControl>
                </FormItem>
              )}
            />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <FormField
                control={form.control}
                name="isPrivate"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2">
                    <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    <FormLabel>{t('private')}</FormLabel>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="showInNav"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2">
                    <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    <FormLabel>{t('show_in_nav')}</FormLabel>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="navOrder"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('nav_order')}</FormLabel>
                    <FormControl><Input type="number" {...field} /></FormControl>
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter>
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    form.reset(toFormValues(page))
                    onOpenChange(false)
                  }}
                >
                  {operationT('cancel')}
                </Button>
                {/* 通过表单 submit 提交，成功后再关闭对话框 */}
                <Button type="submit" disabled={form.formState.isSubmitting}>{page ? operationT('update') : operationT('create')}</Button>
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function toFormValues(page: PageModel | null): PageMetaForm {
  return page
    ? {
        title: page.title,
        slug: page.slug,
        cover: page.cover || '',
        description: page.description || '',
        isPrivate: page.isPrivate,
        showInNav: page.showInNav,
        navOrder: page.navOrder || 0,
      }
    : {
        title: '',
        slug: '',
        cover: '',
        description: '',
        isPrivate: false,
        showInNav: false,
        navOrder: 0,
      }
}

// 后端不允许纯数字 slug（会与 id 访问冲突）
function isNumericSlug(value: string) {
  return /^\d+$/.test(value.trim())
}
