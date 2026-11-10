'use client'

import type { PageModel } from '@/models/page'
import { useFormatter, useTranslations } from 'next-intl'
import { useParams } from 'next/navigation'
import { useCallback } from 'react'
import { ContentEditorShell } from '@/components/tiptap-editor/content-editor-shell'
import { useContentEditor } from '@/hooks/use-content-editor'
import { consolePath, getPageUrl } from '@/utils/common/route'
import { PagePreviewDialog } from './page-preview'
import { PageSettingsSheet } from './page-settings-sheet'

export function PageEditor() {
  const t = useTranslations('Console.editor')
  const pageT = useTranslations('Console.pages.meta')
  const format = useFormatter()
  const { id } = useParams() as { id: string }
  const controller = useContentEditor('page', id)
  const page = controller.doc as PageModel | null
  const { meta, editor } = controller
  const getHtml = useCallback(() => editor?.getHTML() ?? '', [editor])

  const publishSummary = [
    { label: t('publish_visibility'), value: meta.isPrivate ? t('visibility_private') : t('visibility_public') },
    { label: t('publish_path'), value: page ? getPageUrl({ id: page.id, slug: meta.slug.trim() || page.slug }) : '-' },
    { label: t('publish_nav'), value: meta.showInNav ? t('nav_shown', { order: meta.navOrder }) : t('nav_hidden') },
  ]

  return (
    <ContentEditorShell
      controller={controller}
      backHref={consolePath.page}
      backLabel={t('back_to_pages')}
      crumbRoot={t('crumb_page')}
      untitled={t('untitled_page')}
      titleLabel={pageT('title')}
      descriptionLabel={pageT('description')}
      settingsLabel={t('settings_page')}
      publishTitle={t('publish_title_page')}
      publishSummary={publishSummary}
      metaLine={page && (
        <>
          <span>{t('crumb_page')}</span>
          <span className="text-foreground/30">·</span>
          <span>{format.dateTime(new Date(page.createdAt), { dateStyle: 'long' })}</span>
        </>
      )}
      renderSettings={panel => (
        <PageSettingsSheet {...panel} meta={meta} onChange={controller.updateMeta} />
      )}
      renderPreview={panel => (
        <PagePreviewDialog {...panel} meta={meta} getHtml={getHtml} />
      )}
    />
  )
}
