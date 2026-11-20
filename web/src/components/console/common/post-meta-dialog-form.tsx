'use client'

import type { SubmitHandler } from 'react-hook-form'
import type { Category } from '@/models/category'
import type { Label } from '@/models/label'
import type { Post } from '@/models/post'
import { useFormatter, useTranslations } from 'next-intl'
import { useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { createPost, updatePost } from '@/api/post'
import { AssetField } from '@/components/common/asset-picker'
import { LabelWithInfo } from '@/components/common/info-tooltip'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useSiteInfo } from '@/contexts/site-info-context'
import { useCommonT, useErrorMessageT, useOperationT, useResponseErrorDetailsT } from '@/hooks/use-translations'
import { useRouter } from '@/i18n/navigation'
import { CONTENT_THEMES, resolveContentTheme } from '@/lib/content-theme'
import { getPostEditUrl } from '@/utils/common/route'
import { AITitleSuggester } from './ai-title-suggester'
import { PostAITaxonomyRecommender } from './post-ai-taxonomy-recommender'
import { PostCategorySelector, PostLabelSelector } from './post-meta-category-and-label-selector'

const FOLLOW_SITE_THEME = '__site__'

interface PostMetaForm {
  title: string
  slug: string
  cover: string
  category: Category | null
  labels: Label[]
  description: string
  contentTheme: string
  isPrivate: boolean
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
  const editorT = useTranslations('Console.editor')
  const globalT = useTranslations('Console.global')
  const siteTheme = resolveContentTheme(null, useSiteInfo().siteInfo.contentTheme)
  const format = useFormatter()
  const router = useRouter()
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
          contentTheme: data.contentTheme,
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
              contentTheme: data.contentTheme,
              isPrivate: data.isPrivate,
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
          contentTheme: data.contentTheme,
          isPrivate: data.isPrivate,
          content: '',
          type: 'html',
        },
      })
        .then((res) => {
          toast.success(operationT('create_success'))
          onMetaChange({ post: res.data })
          form.reset()
          onOpenChange(false)
          // 创建后直接进入编辑器继续撰写正文
          router.push(getPostEditUrl({ id: res.data.id }))
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
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
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
                {format.dateTime(new Date(post.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}
              </div>
              <div className="font-mono text-sm">
                {commonT('updated_at')}
                :
                {format.dateTime(new Date(post.updatedAt), { dateStyle: 'medium', timeStyle: 'short' })}
              </div>
            </div>
          )}
        </DialogHeader>
        <Form {...form}>
          <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
            <FormField
              control={form.control}
              name="title"
              rules={{ validate: value => !!value.trim() || t('title_required') }}
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between gap-2">
                    <FormLabel>{t('post_title')}</FormLabel>
                    {post && (
                      <AITitleSuggester
                        compact
                        target="post"
                        targetId={post.id}
                        currentTitle={field.value}
                        getPayload={() => ({
                          title: form.getValues('title'),
                          description: form.getValues('description'),
                        })}
                        onSelectTitle={candidate => form.setValue('title', candidate, { shouldDirty: true, shouldValidate: true })}
                      />
                    )}
                  </div>
                  <FormControl>
                    <Input autoFocus={false} {...field} />
                  </FormControl>
                  <FormMessage />
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
                  <FormLabel>{t('post_description')}</FormLabel>
                  <FormControl>
                    <Textarea autoFocus={false} {...field} />
                  </FormControl>
                </FormItem>
              )}
            />

            {post && (
              <PostAITaxonomyRecommender
                postId={post.id}
                getPayload={() => ({
                  title: form.getValues('title'),
                  description: form.getValues('description'),
                })}
              />
            )}

            <PostCategorySelector />

            <PostLabelSelector />

            <FormField
              control={form.control}
              name="contentTheme"
              render={({ field }) => (
                <FormItem>
                  <LabelWithInfo info={editorT('content_theme_hint')}><FormLabel>{editorT('content_theme')}</FormLabel></LabelWithInfo>
                  <Select value={field.value || FOLLOW_SITE_THEME} onValueChange={value => field.onChange(value === FOLLOW_SITE_THEME ? '' : value)}>
                    <FormControl>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={FOLLOW_SITE_THEME}>{editorT('content_theme_follow_site', { theme: globalT(`content_theme_${siteTheme}`) })}</SelectItem>
                      {CONTENT_THEMES.map(theme => (
                        <SelectItem key={theme} value={theme}>{globalT(`content_theme_${theme}`)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="isPrivate"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between gap-4 rounded-lg border p-3">
                  <LabelWithInfo info={editorT('private_hint')}><FormLabel>{editorT('private')}</FormLabel></LabelWithInfo>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
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
        description: post.description || '',
        contentTheme: post.contentTheme || '',
        isPrivate: Boolean(post.isPrivate),
      }
    : {
        title: '',
        slug: '',
        cover: '',
        category: null,
        labels: [],
        description: '',
        contentTheme: '',
        isPrivate: false,
      }
}

// 后端不允许纯数字 slug（会与 id 访问冲突）
function isNumericSlug(value: string) {
  return /^\d+$/.test(value.trim())
}
