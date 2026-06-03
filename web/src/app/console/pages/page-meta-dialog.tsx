'use client'

import type { SubmitHandler } from 'react-hook-form'
import type { PageModel } from '@/models/page'
import type { BaseResponseError } from '@/models/resp'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { createPage, updatePage } from '@/api/page'
import { FileSelector } from '@/components/common/file-selector'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogClose,
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
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useOperationT } from '@/hooks/use-translations'
import { getFileUri } from '@/utils/client/file'

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
  const form = useForm<PageMetaForm>({
    defaultValues: page
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
        },
  })

  const onSubmit: SubmitHandler<PageMetaForm> = (data) => {
    if (!data.title.trim() || !data.slug.trim()) {
      toast.error('标题和 slug 不能为空')
      return
    }

    if (page) {
      updatePage({
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
        .catch((error: BaseResponseError) => {
          toast.error(`${operationT('update_failed')}: ${error?.response?.data?.message || error.message}`)
        })
      return
    }

    createPage({
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
      })
      .catch((error: BaseResponseError) => {
        toast.error(`${operationT('create_failed')}: ${error?.response?.data?.message || error.message}`)
      })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{page ? '编辑页面' : '创建页面'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>标题</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Slug</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="cover"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>封面</FormLabel>
                  <FormControl>
                    <div className="flex gap-2">
                      <Input {...field} />
                      <FileSelector
                        limitNumber={1}
                        onFilesSelected={(files) => {
                          if (files.length > 0)
                            form.setValue('cover', getFileUri(files[0].id))
                        }}
                      />
                    </div>
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>描述</FormLabel>
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
                    <FormLabel>私有</FormLabel>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="showInNav"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2">
                    <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    <FormLabel>导航展示</FormLabel>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="navOrder"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>导航排序</FormLabel>
                    <FormControl><Input type="number" {...field} /></FormControl>
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => form.reset()}>{operationT('cancel')}</Button>
                  <Button type="button" onClick={form.handleSubmit(onSubmit)}>{page ? operationT('update') : operationT('create')}</Button>
                </div>
              </DialogClose>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
