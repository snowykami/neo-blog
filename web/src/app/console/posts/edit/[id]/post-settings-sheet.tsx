'use client'

import type { ContentMeta } from '@/hooks/use-content-editor'
import type { Category } from '@/models/category'
import type { Label } from '@/models/label'
import { FileTextIcon, FolderIcon, SendIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useForm } from 'react-hook-form'
import { InfoTooltip, LabelWithInfo } from '@/components/common/info-tooltip'
import { PostCategorySelector, PostLabelSelector } from '@/components/console/common/post-meta-category-and-label-selector'
import {
  ContentSettingsSheet,
  CoverField,
  NumberField,
  SettingsSection,
  SwitchField,
  useSyncSettingsForm,
} from '@/components/console/editor/content-settings-sheet'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useResponseErrorDetailsT } from '@/hooks/use-translations'

interface PostSettingsValues {
  slug: string
  description: string
  cover: string
  backgroundImage: string
  category: Category | null
  labels: Label[]
  isPrivate: boolean
  top: number
}

function toValues(meta: ContentMeta): PostSettingsValues {
  return {
    slug: meta.slug,
    description: meta.description,
    cover: meta.cover,
    backgroundImage: meta.backgroundImage,
    category: meta.category,
    labels: meta.labels,
    isPrivate: meta.isPrivate,
    top: meta.top,
  }
}

// 后端不允许纯数字 slug（会与 id 访问冲突）
function isNumericSlug(value: string) {
  return /^\d+$/.test(value.trim())
}

/**
 * 文章设置抽屉：访问路径、摘要（与画布同步）、封面、分类、标签、私密、置顶
 * 修改校验通过后写入编辑器元信息，随正文一起自动保存
 */
export function PostSettingsSheet({
  open,
  onOpenChange,
  meta,
  onChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  meta: ContentMeta
  onChange: (patch: Partial<ContentMeta>) => void
}) {
  const t = useTranslations('Console.editor')
  const postEditT = useTranslations('Console.post_edit')
  const errorDetailsT = useResponseErrorDetailsT()
  const form = useForm<PostSettingsValues>({ mode: 'onChange', defaultValues: toValues(meta) })
  useSyncSettingsForm(form, open, toValues(meta), onChange)

  return (
    <ContentSettingsSheet open={open} onOpenChange={onOpenChange} title={t('settings_post')}>
      <Form {...form}>
        <form className="grid gap-4" onSubmit={e => e.preventDefault()}>
          <SettingsSection icon={FileTextIcon} title={t('settings_basic')}>
            <FormField
              control={form.control}
              name="slug"
              rules={{ validate: value => !isNumericSlug(value) || errorDetailsT('slug_cannot_be_numeric') }}
              render={({ field }) => (
                <FormItem>
                  <LabelWithInfo info={t('slug_hint_post')}><FormLabel>{postEditT('post_slug')}</FormLabel></LabelWithInfo>
                  <FormControl>
                    <Input {...field} autoComplete="off" spellCheck={false} className="font-mono text-[13.5px]" />
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
                  <div className="flex w-full items-center gap-1">
                    <FormLabel>{postEditT('post_description')}</FormLabel>
                    <InfoTooltip content={t('description_sync_hint')} />
                    <span className="ml-auto font-normal text-muted-foreground/70 tabular-nums">{field.value.length}</span>
                  </div>
                  <FormControl>
                    <Textarea {...field} rows={3} placeholder={t('description_sheet_placeholder')} />
                  </FormControl>
                </FormItem>
              )}
            />
            <CoverField form={form} name="cover" label={postEditT('post_cover')} />
            <CoverField
              form={form}
              name="backgroundImage"
              label={postEditT('post_background_image')}
              hint={postEditT('post_background_image_hint')}
            />
          </SettingsSection>

          <SettingsSection icon={FolderIcon} title={t('settings_classify')}>
            <PostCategorySelector
              category={form.watch('category')}
              onCategoryChange={category => form.setValue('category', category, { shouldDirty: true })}
            />
            <PostLabelSelector
              labels={form.watch('labels')}
              onSelectedLabelsChange={labels => form.setValue('labels', labels, { shouldDirty: true })}
            />
          </SettingsSection>

          <SettingsSection icon={SendIcon} title={t('settings_publish')}>
            <SwitchField form={form} name="isPrivate" label={t('private')} description={t('private_hint')} />
            <NumberField form={form} name="top" min={0} label={postEditT('post_top')} description={t('top_hint')} />
          </SettingsSection>
        </form>
      </Form>
    </ContentSettingsSheet>
  )
}
