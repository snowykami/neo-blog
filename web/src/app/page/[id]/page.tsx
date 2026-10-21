import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { getPageById } from '@/api/page'
import { ContentHoverCard } from '@/components/blog-post/content-hover-card'
import { ContentImageFallback } from '@/components/blog-post/content-image-fallback'
import { ContentImageViewer } from '@/components/blog-post/content-image-viewer'
import { VisitReporter } from '@/components/common/visit-reporter'
import { isNotFoundLikeError } from '@/utils/common/error'
import { applyContentAutoMatch } from '@/utils/server/content-auto-match'
import { sanitizeContentHtml } from '@/utils/server/sanitize-html'
import '@/components/tiptap-node/image-node/image-figure.scss'

// 同一次渲染内复用页面数据；仅明确不存在 / 无权查看时返回 null，其余错误交给错误边界
const getCachedPage = cache(async (id: string) => {
  return getPageById({ id })
    .then(res => res.data)
    .catch((error) => {
      if (isNotFoundLikeError(error))
        return null
      throw error
    })
})

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const page = await getCachedPage(id).catch(() => null)
  if (!page)
    return {}
  return {
    title: page.title,
    description: page.description,
  }
}

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const page = await getCachedPage(id)
  if (!page)
    notFound()

  return (
    <article className="py-10">
      <div className="prose dark:prose-invert pangu-autospace max-w-3xl mx-auto">
        <h1>{page.title}</h1>
        {page.description && <p className="lead">{page.description}</p>}
        <div id="page-content" dangerouslySetInnerHTML={{ __html: sanitizeContentHtml(applyContentAutoMatch(page.content)) }} />
        <ContentHoverCard containerId="page-content" />
        <ContentImageFallback containerId="page-content" />
        <ContentImageViewer containerId="page-content" />
        <VisitReporter targetType="page" targetId={page.id} />
      </div>
    </article>
  )
}
