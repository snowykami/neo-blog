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
        <Empty className="surface-card rounded-2xl bg-card">
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
      <div className="surface-card rounded-2xl bg-card p-5 sm:p-7 md:p-8">
        <h1 className="relative mb-3 pl-4 text-2xl font-bold text-foreground/90 [text-wrap:balance] before:absolute before:top-[0.4375rem] before:left-0 before:h-4.5 before:w-1 before:rounded-full before:bg-primary sm:text-3xl sm:before:top-2 sm:before:h-5 md:pl-5 md:text-[2.125rem] md:leading-[2.65rem] md:before:top-[0.6375rem] md:before:h-5.5">
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
