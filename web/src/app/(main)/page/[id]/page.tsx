import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { getPageById } from '@/api/page'
import HtmlEnhancer from '@/components/blog-post/blog-content-enhanced'
import { ContentHoverCard } from '@/components/blog-post/content-hover-card'
import { ContentImageFallback } from '@/components/blog-post/content-image-fallback'
import { ContentImageViewer } from '@/components/blog-post/content-image-viewer'
import { SafeImage } from '@/components/common/safe-image'
import { VisitReporter } from '@/components/common/visit-reporter'
import { isNotFoundLikeError } from '@/utils/common/error'
import { renderContentHtml } from '@/utils/server/render-content'
import '@/components/tiptap-node/image-node/image-figure.scss'
import '../../p/[id]/blog-post-article.scss'

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
    openGraph: page.cover ? { title: page.title, description: page.description, images: [page.cover] } : undefined,
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
    <div className="py-10">
      {/* 封面 */}
      {page.cover && (
        <div className="relative mb-8 aspect-[16/6] w-full overflow-hidden rounded-xl">
          <SafeImage src={page.cover} alt={page.title} fill priority className="object-cover" sizes="(max-width: 1280px) 100vw, 1280px" />
        </div>
      )}
      <article className="prose dark:prose-invert pangu-autospace max-w-3xl mx-auto">
        <h1>{page.title}</h1>
        {page.description && <p className="lead">{page.description}</p>}
        {/* 先自动匹配再净化，与文章正文保持一致 */}
        <div id="page-content" dangerouslySetInnerHTML={{ __html: renderContentHtml(page.content).html }} />
      </article>
      {/* 代码块工具栏 / 高亮、链接卡片、图片失效兜底与预览，与文章正文复用同一套增强 */}
      <HtmlEnhancer containerId="page-content" />
      <ContentHoverCard containerId="page-content" />
      <ContentImageFallback containerId="page-content" />
      <ContentImageViewer containerId="page-content" />
      <VisitReporter targetType="page" targetId={page.id} />
    </div>
  )
}
