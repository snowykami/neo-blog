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
import { ComponentIslands } from '@/components/content-components/component-islands'
import { SiteShell } from '@/components/layout/site-shell'
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
    <SiteShell className="max-w-[56rem]">
      <div className="rounded-2xl bg-card px-6 pt-6 pb-8 md:px-9">
        {/* 封面 */}
        {page.cover && (
          <div className="relative mb-8 aspect-[2/1] w-full overflow-hidden rounded-xl bg-muted">
            <SafeImage src={page.cover} alt="" fill priority className="object-cover" sizes="(max-width: 896px) 100vw, 896px" />
          </div>
        )}
        <h1 className="relative mb-3 text-3xl font-bold text-foreground/90 md:text-[2.25rem] md:leading-[2.75rem] md:before:absolute md:before:top-[0.875rem] md:before:-left-[1.125rem] md:before:h-4 md:before:w-1 md:before:rounded-md md:before:bg-primary">
          {page.title}
        </h1>
        {page.description && <p className="mb-5 text-foreground/75">{page.description}</p>}
        <div className="mb-6 border-b border-dashed border-foreground/10" />
        {/* 先自动匹配再净化，与文章正文保持一致 */}
        <article
          id="page-content"
          className="prose max-w-none dark:prose-invert pangu-autospace"
          dangerouslySetInnerHTML={{ __html: renderContentHtml(page.content).html }}
        />
      </div>
      {/* 代码块工具栏 / 高亮、链接卡片、图片失效兜底与预览，与文章正文复用同一套增强 */}
      <HtmlEnhancer containerId="page-content" />
      <ComponentIslands containerId="page-content" />
      <ContentHoverCard containerId="page-content" />
      <ContentImageFallback containerId="page-content" />
      <ContentImageViewer containerId="page-content" />
      <VisitReporter targetType="page" targetId={page.id} />
    </SiteShell>
  )
}
