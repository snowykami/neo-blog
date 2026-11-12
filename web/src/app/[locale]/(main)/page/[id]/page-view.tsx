import type { PageModel } from '@/models/page'
import { getLocale } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { getCachedSiteInfo } from '@/api/misc.server'
import HtmlEnhancer from '@/components/blog-post/blog-content-enhanced'
import { ContentFontLinks } from '@/components/blog-post/content-font-links'
import { ContentHdrText } from '@/components/blog-post/content-hdr-text'
import { ContentHoverCard } from '@/components/blog-post/content-hover-card'
import { ContentImageFallback } from '@/components/blog-post/content-image-fallback'
import { ContentImageViewer } from '@/components/blog-post/content-image-viewer'
import { PageInfoCard } from '@/components/blog-post/page-info-card'
import { PostToc } from '@/components/blog-post/post-toc.client'
import { LinkPreviewScopeProvider } from '@/components/common/link-preview-context'
import { SafeImage } from '@/components/common/safe-image'
import { VisitReporter } from '@/components/common/visit-reporter'
import { ComponentIslands } from '@/components/content-components/component-islands'
import { HtmlPageView } from '@/components/html-page/html-page-view'
import { FullscreenChrome } from '@/components/layout/fullscreen-chrome'
import { SiteShell } from '@/components/layout/site-shell'
import { localizePath } from '@/i18n/routing'
import { contentWebFonts, resolveContentTheme } from '@/lib/content-theme'
import { countWords } from '@/utils/common/post'
import { renderContentHtml } from '@/utils/server/render-content'
import '@/app/styles/content-themes/index.scss'
import '@/components/tiptap-node/image-node/image-figure.scss'
import '@/components/tiptap-node/video-node/video-figure.scss'
import '@/components/tiptap-node/inline-icon-node/inline-icon.scss'
// 公式样式（约 4 KB）；KaTeX 字体只在页面用到公式时才下载
import 'katex/dist/katex.min.css'

/*
 * 页面正文的渲染（前台页面与后台预览共用）：链接页面跳转到其地址，HTML 页面在沙箱 iframe 中展示，
 * 正文页面按页面的版式（阅读 / 宽屏 / 全屏）渲染
 */

// isDraft：后台预览（/console/pages/preview/[id]）渲染草稿正文、不上报访问；前台页面不传
export async function PageView({ page, isDraft = false }: { page: PageModel, isDraft?: boolean }) {
  // 链接页面：跳转到其地址（站内路径或站外地址），导航中已直接链接，这里处理直接访问 /page/{slug} 的情况；站内前台地址保持当前语言
  if (page.kind === 'link' && page.linkUrl)
    redirect(localizePath(page.linkUrl, await getLocale()))
  // HTML 页面：上传的静态 HTML 在沙箱 iframe 中展示
  if (page.kind === 'html') {
    return (
      <>
        <HtmlPageView page={page} />
        {!isDraft && <VisitReporter targetType="page" targetId={page.id} />}
      </>
    )
  }

  const content = (isDraft ? page.draftContent : page.content) || ''
  const { html, headings } = await renderContentHtml(content)
  // 页面正文使用站点默认的内容主题
  const theme = resolveContentTheme(null, (await getCachedSiteInfo()).contentTheme)
  // 代码块工具栏 / 高亮、链接卡片、图片失效兜底与预览，与文章正文复用同一套增强
  const enhancers = (
    <>
      <ContentFontLinks fonts={contentWebFonts(theme, html)} />
      <HtmlEnhancer containerId="page-content" />
      <LinkPreviewScopeProvider targetType="page" targetId={page.id}>
        <ComponentIslands containerId="page-content" />
        <ContentHoverCard containerId="page-content" />
      </LinkPreviewScopeProvider>
      <ContentImageFallback containerId="page-content" />
      <ContentHdrText containerId="page-content" />
      <ContentImageViewer containerId="page-content" />
      {!isDraft && <VisitReporter targetType="page" targetId={page.id} />}
    </>
  )

  // 全屏页面：正文占满视口，不显示标题区与侧栏；顶栏收起为手势条、隐藏页脚
  if (page.fullscreen) {
    return (
      <div className="min-h-dvh w-full px-4 pt-10 pb-16 md:px-8">
        <FullscreenChrome />
        <h1 className="sr-only">{page.title}</h1>
        <article
          id="page-content"
          className="content-body prose max-w-none dark:prose-invert pangu-autospace"
          data-content-theme={theme}
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {enhancers}
      </div>
    )
  }

  const wide = page.layout === 'wide'
  // 外框与顶栏同宽：阅读版式为「正文 + 侧栏（页面信息与目录）」，与文章页的正文宽度一致；宽屏版式正文占满整行
  const sidebar = wide
    ? undefined
    : (
        // 侧栏与正文等高，只让目录吸顶
        <div className="flex h-full flex-col gap-4">
          <PageInfoCard page={page} words={countWords(content)} />
          <PostToc headings={headings} className="hidden lg:sticky lg:top-[calc(var(--nav-h)+1rem)] lg:block" />
        </div>
      )

  return (
    <SiteShell sidebar={sidebar} stickySidebar={false}>
      <div className="rounded-2xl bg-card px-6 pt-6 pb-8 md:px-9">
        {/* 封面 */}
        {page.cover && (
          <div className="relative mb-8 aspect-[2/1] w-full overflow-hidden rounded-xl bg-muted">
            <SafeImage src={page.cover} alt="" fill priority className="object-cover" sizes={wide ? '(max-width: 1200px) 100vw, 1200px' : '(max-width: 1024px) 100vw, 900px'} />
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
          className="content-body prose max-w-none dark:prose-invert pangu-autospace"
          data-content-theme={theme}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
      {enhancers}
    </SiteShell>
  )
}
