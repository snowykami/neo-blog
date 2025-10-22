'use client'

import type { SubmitHandler } from 'react-hook-form'
import type { Category } from '@/models/category'
import type { Label } from '@/models/label'
import type { Post } from '@/models/post'
import type { BaseResponseError } from '@/models/resp'
import { useTranslations } from 'next-intl'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { createPost, updatePost } from '@/api/post'
import { FileSelector } from '@/components/common/file-selector'
import { Button } from '@/components/ui/button'
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
import { useCommonT, useOperationT } from '@/hooks/use-translations'
import { getFileUri } from '@/utils/client/file'
import { PostCategorySelector, PostLabelSelector } from './post-meta-category-and-label-selector'

interface PostMetaForm {
  title: string
  slug: string
  cover: string
  category: Category | null
  labels: Label[]
  isPrivate: boolean
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
  const commonT = useCommonT()
  const t = useTranslations('Console.post_edit')
  const form = useForm<PostMetaForm>({
    defaultValues: post
      ? {
          title: post.title,
          slug: post.slug || '',
          cover: post.cover || '',
          category: post.category,
          labels: post.labels || [],
          isPrivate: post.isPrivate,
          description: post.description || '',
        }
      : {
          title: '',
          slug: '',
          cover: '',
          category: null,
          labels: [],
          isPrivate: false,
          description: '',
        },
  })

  const onSubmit: SubmitHandler<PostMetaForm> = (data) => {
    if (post) {
      // 更新文章元信息
      updatePost({
        post: {
          id: post.id,
          title: data.title,
          slug: data.slug,
          cover: data.cover,
          categoryId: data.category?.id,
          description: data.description,
          labelIds: data.labels.map(l => l.id),
          isPrivate: data.isPrivate,
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
              isPrivate: data.isPrivate,
              type: 'html',
            },
          })
          onOpenChange(false)
        })
        .catch((error: BaseResponseError) => {
          toast.error(
            `${operationT('update_failed')}: ${error?.response?.data?.message || error.message}`,
          )
        })
    }
    else {
      // 创建新文章时，同时创建文章内容
      createPost({
        post: {
          title: data.title,
          slug: data.slug,
          cover: data.cover,
          categoryId: data.category?.id || null,
          description: data.description,
          labelIds: data.labels.map(l => l.id),
          isPrivate: data.isPrivate,
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
        .catch((error: BaseResponseError) => {
          toast.error(
            `${operationT('create_failed')}: ${error?.response?.data?.message || error.message}`,
          )
        })
    }
  }

  const handleCancel = () => {
    form.reset()
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
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('post_slug')}</FormLabel>
                  <FormControl>
                    <Input autoFocus={false} {...field} />
                  </FormControl>
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

            <PostCategorySelector
              category={form.watch('category')}
              onCategoryChange={category => form.setValue('category', category)}
            />

            <PostLabelSelector
              labels={form.watch('labels')}
              onSelectedLabelsChange={labels => form.setValue('labels', labels)}
            />

            <DialogFooter>
              <DialogClose asChild>
                <div className="flex gap-2">
                  <Button onClick={handleCancel} type="button" variant="outline">
                    {operationT('cancel')}
                  </Button>
                  <Button onClick={() => form.handleSubmit(onSubmit)}>
                    {post ? operationT('update') : operationT('create')}
                  </Button>
                </div>
              </DialogClose>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
