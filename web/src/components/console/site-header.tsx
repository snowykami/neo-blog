import { Fragment } from 'react'
import { SiGithub } from 'react-icons/si'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import { ConsoleMusicButton } from './console-music-button'

export interface ConsoleBreadcrumbItem {
  label: string
  href?: string
}

export function SiteHeader({
  title,
  breadcrumbs,
  breadcrumbLabel,
  sticky = true,
}: {
  title?: string
  breadcrumbs?: ConsoleBreadcrumbItem[]
  breadcrumbLabel?: string
  sticky?: boolean
}) {
  return (
    <header
      className={cn(
        'flex h-(--header-height) shrink-0 items-center gap-2 border-b bg-card/85 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)',
        sticky && 'sticky top-0 z-30 backdrop-blur-md backdrop-saturate-150',
      )}
    >
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
        {breadcrumbs && breadcrumbs.length > 1
          ? (
              <Breadcrumb aria-label={breadcrumbLabel} className="min-w-0">
                <BreadcrumbList className="flex-nowrap">
                  {breadcrumbs.map((crumb, idx) => {
                    const isLast = idx === breadcrumbs.length - 1
                    return (
                      <Fragment key={`${crumb.label}-${idx}`}>
                        {idx > 0 && <BreadcrumbSeparator />}
                        <BreadcrumbItem className="min-w-0">
                          {isLast
                            ? (
                                <h1 aria-current="page" className="truncate text-sm font-medium text-foreground">
                                  {crumb.label}
                                </h1>
                              )
                            : crumb.href
                              ? (
                                  <BreadcrumbLink asChild className="truncate">
                                    <Link href={crumb.href}>{crumb.label}</Link>
                                  </BreadcrumbLink>
                                )
                              : <span className="truncate">{crumb.label}</span>}
                        </BreadcrumbItem>
                      </Fragment>
                    )
                  })}
                </BreadcrumbList>
              </Breadcrumb>
            )
          : <h1 className="truncate text-base font-medium">{title}</h1>}
        <div className="ml-auto flex items-center gap-2">
          {/* 后台不显示音乐悬浮球，播放器入口放在这里 */}
          <ConsoleMusicButton />
          <Button variant="ghost" className=" h-8 w-8" asChild>
            {/* 站外链接用普通 <a>：交给 Link（URL 对象）时会被当成站内的 /snowykami/neo-blog 预取，每次进后台都白白渲染一次 404 */}
            <a
              href="https://github.com/snowykami/neo-blog"
              rel="noopener noreferrer"
              target="_blank"
              // 只有图标：给读屏一个名称（品牌名，不需要翻译）
              aria-label="GitHub"
              title="GitHub"
              className="dark:text-foreground"
            >
              <SiGithub aria-hidden className="h-full w-full" />
            </a>
          </Button>
        </div>
      </div>
    </header>
  )
}
