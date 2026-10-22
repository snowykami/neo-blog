'use client'

import type { Post } from '@/models/post'
import { useFormatter, useTranslations } from 'next-intl'
import { useParams } from 'next/navigation'
import { ContentEditorShell } from '@/components/tiptap-editor/content-editor-shell'
import { useContentEditor } from '@/hooks/use-content-editor'
import { consolePath, getPostUrl } from '@/utils/common/route'
import { PostPreviewDialog } from './post-preview'
import { PostSettingsSheet } from './post-settings-sheet'

export function PostEditor() {
  const t = useTranslations('Console.editor')
  const postEditT = useTranslations('Console.post_edit')
  const format = useFormatter()
  const { id } = useParams() as { id: string }
  const controller = useContentEditor('post', id)
  const post = controller.doc as Post | null
  const { meta } = controller

  const publishSummary = [
    { label: t('publish_visibility'), value: meta.isPrivate ? t('visibility_private') : t('visibility_public') },
    { label: t('publish_path'), value: post ? getPostUrl({ post: { id: post.id, slug: meta.slug.trim() || null } }) : '-' },
    { label: postEditT('category'), value: meta.category?.name ?? postEditT('uncategorized') },
    { label: postEditT('labels'), value: meta.labels.length ? meta.labels.map(label => `#${label.name}`).join(' ') : t('none') },
    { label: postEditT('post_top'), value: meta.top > 0 ? t('top_weight', { top: meta.top }) : t('not_top') },
  ]

  return (
    <ContentEditorShell
      controller={controller}
      backHref={consolePath.post}
      backLabel={t('back_to_posts')}
      crumbRoot={t('crumb_post')}
      untitled={t('untitled_post')}
      titleLabel={postEditT('post_title')}
      descriptionLabel={postEditT('post_description')}
      settingsLabel={t('settings_post')}
      publishTitle={t('publish_title_post')}
      publishSummary={publishSummary}
      metaLine={post && (
        <>
          <span>{meta.category?.name ?? postEditT('uncategorized')}</span>
          <span className="text-foreground/30">·</span>
          <span>{format.dateTime(new Date(post.createdAt), { dateStyle: 'long' })}</span>
        </>
      )}
      renderSettings={panel => (
        <PostSettingsSheet {...panel} meta={meta} onChange={controller.updateMeta} />
      )}
      renderPreview={panel => post && (
        <PostPreviewDialog {...panel} post={post} onBeforePreview={() => controller.save()} />
      )}
    />
  )
}
