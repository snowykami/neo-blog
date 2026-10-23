'use client'

import type { ContentMeta } from '@/hooks/use-content-editor'
import DOMPurify from 'isomorphic-dompurify'
import { useTranslations } from 'next-intl'
import { useMemo } from 'react'
import HtmlEnhancer from '@/components/blog-post/blog-content-enhanced'
import { ContentHoverCard } from '@/components/blog-post/content-hover-card'
import { ContentImageFallback } from '@/components/blog-post/content-image-fallback'
import { SafeImage } from '@/components/common/safe-image'
import { ComponentIslands } from '@/components/content-components/component-islands'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useOperationT } from '@/hooks/use-translations'
import '@/components/tiptap-node/image-node/image-figure.scss'
import '../../../../(main)/p/[id]/blog-post-article.scss'

const CONTAINER_ID = 'page-preview-content'

/**
 * 页面预览：前台页面暂不支持草稿预览，这里按前台页面的版式在本地渲染当前编辑内容
 * （不含服务端的“自动匹配”处理）
 */
export function PagePreviewDialog({
  open,
  onOpenChange,
  meta,
  getHtml,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  meta: ContentMeta
  getHtml: () => string
}) {
  const operationT = useOperationT()
  const t = useTranslations('Console.editor')
  // 打开时取一次内容快照
  const html = useMemo(() => (open ? DOMPurify.sanitize(getHtml()) : ''), [open, getHtml])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[90vh] w-[90vw] !max-w-none overflow-y-auto rounded-2xl border-0 bg-background p-4 md:p-8">
        <DialogTitle className="sr-only">{operationT('preview')}</DialogTitle>
        <div className="mx-auto w-full max-w-[56rem] rounded-2xl bg-card px-6 pt-6 pb-8 md:px-9">
          <p className="mb-4 text-xs text-muted-foreground">{t('preview_local_hint')}</p>
          {meta.cover && (
            <div className="relative mb-8 aspect-[2/1] w-full overflow-hidden rounded-xl bg-muted">
              <SafeImage src={meta.cover} alt="" fill className="object-cover" sizes="(max-width: 896px) 100vw, 896px" />
            </div>
          )}
          <h1 className="relative mb-3 text-3xl font-bold text-foreground/90 md:text-[2.25rem] md:leading-[2.75rem] md:before:absolute md:before:top-[0.875rem] md:before:-left-[1.125rem] md:before:h-4 md:before:w-1 md:before:rounded-md md:before:bg-primary">
            {meta.title || t('untitled_page')}
          </h1>
          {meta.description && <p className="mb-5 text-foreground/75">{meta.description}</p>}
          <div className="mb-6 border-b border-dashed border-foreground/10" />
          <article
            id={CONTAINER_ID}
            className="prose max-w-none dark:prose-invert pangu-autospace"
            dangerouslySetInnerHTML={{ __html: html }}
          />
          {open && (
            <>
              <HtmlEnhancer containerId={CONTAINER_ID} />
              <ComponentIslands containerId={CONTAINER_ID} />
              <ContentHoverCard containerId={CONTAINER_ID} />
              <ContentImageFallback containerId={CONTAINER_ID} />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
