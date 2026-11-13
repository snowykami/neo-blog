'use client'

import type { PostPinState } from '../../post-pin'
import type { Post } from '@/models/post'
import { useFormatter, useTranslations } from 'next-intl'
import { useParams } from 'next/navigation'
import { useState } from 'react'
import { ContentEditorShell } from '@/components/tiptap-editor/content-editor-shell'
import { useAuth } from '@/contexts/auth-context'
import { useContentEditor } from '@/hooks/use-content-editor'
import { isAdmin } from '@/utils/common/permission'
import { consolePath, getPostUrl } from '@/utils/common/route'
import { pinStateOf, usePinUntilText } from '../../post-pin'
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
  const { user } = useAuth()
  const canPin = !!user && isAdmin({ user })
  const pinUntilText = usePinUntilText()
  // 置顶直接调用接口生效，不在编辑器元信息里：改过之后以本地状态为准，否则读文章里的
  const [changedPin, setChangedPin] = useState<{ postId: number, state: PostPinState } | null>(null)
  const pin = post ? (changedPin?.postId === post.id ? changedPin.state : pinStateOf(post)) : null

  const publishSummary = [
    { label: t('publish_visibility'), value: meta.isPrivate ? t('visibility_private') : t('visibility_public') },
    { label: t('publish_path'), value: post ? getPostUrl({ post: { id: post.id, slug: meta.slug.trim() || null } }) : '-' },
    { label: postEditT('category'), value: meta.category?.name ?? postEditT('uncategorized') },
    { label: postEditT('labels'), value: meta.labels.length ? meta.labels.map(label => `#${label.name}`).join(' ') : t('none') },
    ...(canPin && pin
      ? [{
          label: postEditT('pin_to_home'),
          value: !pin.pinned ? t('not_pinned') : pin.pinnedUntil ? postEditT('pin_until', { date: pinUntilText(pin.pinnedUntil) }) : t('pinned'),
        }]
      : []),
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
        <PostSettingsSheet
          {...panel}
          meta={meta}
          onChange={controller.updateMeta}
          aiRecommend={post && !controller.readOnly
            ? {
                postId: post.id,
                getPayload: () => ({
                  title: controller.meta.title,
                  description: controller.meta.description,
                  document: controller.editor?.getHTML() ?? '',
                }),
              }
            : undefined}
          pin={canPin && post && pin ? { postId: post.id, state: pin, onChange: state => setChangedPin({ postId: post.id, state }) } : undefined}
        />
      )}
      renderPreview={panel => post && (
        <PostPreviewDialog {...panel} post={post} onBeforePreview={() => controller.flushSave()} />
      )}
    />
  )
}
