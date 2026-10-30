import type { CSSProperties } from 'react'
import type { PageModel } from '@/models/page'
import { CodeXmlIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { FullscreenChrome } from '@/components/layout/fullscreen-chrome'
import { SiteShell } from '@/components/layout/site-shell'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { HtmlPageFrame } from './html-page-frame'

/**
 * HTML 页面：上传的静态 HTML 在沙箱 iframe 中展示，保留站点顶栏
 * - 默认占满导航栏以下的视口；全屏页面占满整个窗口（顶栏收起为手势条）
 * - 固定宽高比 / 固定高度时放在与顶栏同宽的卡片中，上方显示标题与描述
 * iframe 中的内容不会被搜索引擎收录，页面标题与描述取自页面信息（见 generateMetadata）
 */
export async function HtmlPageView({ page }: { page: PageModel }) {
  const t = await getTranslations('HtmlPage')
  const bundle = page.htmlBundle
  if (!bundle) {
    return (
      <SiteShell>
        <h1 className="sr-only">{page.title}</h1>
        <Empty className="rounded-2xl bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon"><CodeXmlIcon /></EmptyMedia>
            <EmptyTitle>{t('empty_title')}</EmptyTitle>
            <EmptyDescription>{t('empty_description')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </SiteShell>
    )
  }

  const frame = <HtmlPageFrame src={bundle.url} title={page.title} allowSameOrigin={bundle.allowSameOrigin} className="size-full" />
  const fixedStyle: CSSProperties | null = page.htmlSizeMode === 'ratio' && page.htmlAspectRatio
    ? { aspectRatio: page.htmlAspectRatio.replace(':', ' / ') }
    : page.htmlSizeMode === 'height' && page.htmlHeight > 0
      ? { height: page.htmlHeight }
      : null

  if (page.fullscreen || !fixedStyle) {
    return (
      <div className={page.fullscreen ? 'h-dvh w-full' : 'h-[calc(100dvh-var(--nav-h))] w-full'}>
        {page.fullscreen && <FullscreenChrome />}
        <h1 className="sr-only">{page.title}</h1>
        {frame}
      </div>
    )
  }

  return (
    <SiteShell>
      <div className="rounded-2xl bg-card px-6 pt-6 pb-8 md:px-9">
        <h1 className="relative mb-3 text-3xl font-bold text-foreground/90 md:text-[2.25rem] md:leading-[2.75rem] md:before:absolute md:before:top-[0.875rem] md:before:-left-[1.125rem] md:before:h-4 md:before:w-1 md:before:rounded-md md:before:bg-primary">
          {page.title}
        </h1>
        {page.description && <p className="mb-5 text-foreground/75">{page.description}</p>}
        <div className="w-full overflow-hidden rounded-xl border border-foreground/10" style={fixedStyle}>
          {frame}
        </div>
      </div>
    </SiteShell>
  )
}
