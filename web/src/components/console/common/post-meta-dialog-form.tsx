'use client'

import type { SubmitHandler } from 'react-hook-form'
import type { Category } from '@/models/category'
import type { Label } from '@/models/label'
import type { Post } from '@/models/post'
import { useTranslations } from 'next-intl'
import { useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { createPost, updatePost } from '@/api/post'
import { FileSelector } from '@/components/common/file-selector'
import { Button } from '@/components/ui/button'
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
import { useCommonT, useErrorMessageT, useOperationT, useResponseErrorDetailsT } from '@/hooks/use-translations'
import { getFileUri } from '@/utils/client/file'
import { PostCategorySelector, PostLabelSelector } from './post-meta-category-and-label-selector'

interface PostMetaForm {
  title: string
  slug: string
  cover: string
  category: Category | null
  labels: Label[]
  top: number
  description: string
}

export function CreateOrUpdatePostMetaDialogWithoutButton({
  post,
  onPostChange: onMetaChange,
  open,
  onOpenChange,
}: {
  post: Post | null
  onPostChange: ({ post }: { post: Partial<Post> & Pick<Post, 'id'> }) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const errorDetailsT = useResponseErrorDetailsT()
  const commonT = useCommonT()
  const t = useTranslations('Console.post_edit')
  const form = useForm<PostMetaForm>({
    defaultValues: toFormValues(post),
  })

  // 每次打开对话框时用最新的 post 重置表单，避免列表中其他操作后表单仍停留在挂载时的旧值
  // 仅在由关闭变为打开时重置，打开期间 post 变化不覆盖用户正在编辑的内容
  const latestRef = useRef(post)
  latestRef.current = post
  useEffect(() => {
    if (open)
      form.reset(toFormValues(latestRef.current))
  }, [open, form])

  const onSubmit: SubmitHandler<PostMetaForm> = async (data) => {
    if (post) {
      // 更新文章元信息（不提交表单未暴露的 isPrivate，避免覆盖其他地方的修改）
      await updatePost({
        post: {
          id: post.id,
          title: data.title,
          slug: data.slug,
          cover: data.cover,
          // 后端约定 categoryId 为 0 表示清空分类，未传表示不修改
          categoryId: data.category?.id ?? 0,
          description: data.description,
          labelIds: data.labels.map(l => l.id),
          top: Number(data.top) || 0,
        },
      })
        .then(() => {
          toast.success(operationT('update_success'))
          onMetaChange({
            post: {
              id: post.id,
              title: data.title,
              slug: data.slug,
              cover: data.cover,
              category: data.category,
              description: data.description,
              labels: data.labels,
              top: Number(data.top) || 0,
              type: 'html',
            },
          })
          onOpenChange(false)
        })
        .catch((error) => {
          toast.error(`${operationT('update_failed')}: ${errorMessageT(error)}`)
        })
    }
    else {
      // 创建新文章时，同时创建文章内容
      await createPost({
        post: {
          title: data.title,
          slug: data.slug,
          cover: data.cover,
          categoryId: data.category?.id || null,
          description: data.description,
          labelIds: data.labels.map(l => l.id),
          isPrivate: false,
          top: Number(data.top) || 0,
          content: `<h1>${data.title}</h1>`,
          type: 'html',
        },
      })
        .then((res) => {
          toast.success(operationT('create_success'))
          onMetaChange({ post: res.data })
          form.reset()
          onOpenChange(false)
        })
        .catch((error) => {
          toast.error(`${operationT('create_failed')}: ${errorMessageT(error)}`)
        })
    }
  }

  const handleCancel = () => {
    form.reset(toFormValues(post))
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {post ? operationT('update') : operationT('create')}
            {' '}
            {t('post_meta')}
          </DialogTitle>
          {post && (
            <div className="flex justify-between items-center gap-2">
              <div className="font-mono text-sm">
                {commonT('created_at')}
                :
                {new Date(post.createdAt).toLocaleString()}
              </div>
              <div className="font-mono text-sm">
                {commonT('updated_at')}
                :
                {new Date(post.updatedAt).toLocaleString()}
              </div>
            </div>
          )}
        </DialogHeader>
        <Form {...form}>
          <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('post_title')}</FormLabel>
                  <FormControl>
                    <Input autoFocus={false} {...field} />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="slug"
              rules={{ validate: value => !isNumericSlug(value) || errorDetailsT('slug_cannot_be_numeric') }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('post_slug')}</FormLabel>
                  <FormControl>
                    <Input autoFocus={false} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="cover"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('post_cover')}</FormLabel>
                  <FormControl>
                    <div className="flex items-center gap-2">
                      <Input autoFocus={false} {...field} />
                      <FileSelector
                        limitNumber={1}
                        onFilesSelected={(files) => {
                          if (files.length > 0) {
                            form.setValue('cover', getFileUri(files[0].id))
                          }
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
                  <FormLabel>{t('post_description')}</FormLabel>
                  <FormControl>
                    <Textarea autoFocus={false} {...field} className="max-h-4 md:max-h-none" />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="top"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('post_top')}</FormLabel>
                  <FormControl>
                    <Input
                      autoFocus={false}
                      min={0}
                      type="number"
                      {...field}
                      onChange={e => field.onChange(Number(e.target.value) || 0)}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <PostCategorySelector
              category={form.watch('category')}
              onCategoryChange={category => form.setValue('category', category)}
            />

            <PostLabelSelector
              labels={form.watch('labels')}
              onSelectedLabelsChange={labels => form.setValue('labels', labels)}
            />

            <DialogFooter>
              <div className="flex gap-3">
                <Button onClick={handleCancel} type="button" variant="outline">
                  {operationT('cancel')}
                </Button>
                {/* 通过表单 submit 提交，成功后再关闭对话框 */}
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {post ? operationT('update') : operationT('create')}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function toFormValues(post: Post | null): PostMetaForm {
  return post
    ? {
        title: post.title,
        slug: post.slug || '',
        cover: post.cover || '',
        category: post.category,
        labels: post.labels || [],
        top: post.top || 0,
        description: post.description || '',
      }
    : {
        title: '',
        slug: '',
        cover: '',
        category: null,
        labels: [],
        top: 0,
        description: '',
      }
}

// 后端不允许纯数字 slug（会与 id 访问冲突）
function isNumericSlug(value: string) {
  return /^\d+$/.test(value.trim())
}
