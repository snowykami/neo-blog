import type { ComponentProps, ComponentType } from 'react'
import { createNavigation } from 'next-intl/navigation'
import NextLink from 'next/link'
import { isConsolePath, isLocalizedHref, routing } from './routing'

/**
 * 前台导航一律从这里取：链接与跳转自动带上当前语言前缀（默认语言不带），usePathname 返回去掉前缀的路径。
 * 后台、接口、RSS 等不带语言前缀的地址（见 isLocalizedHref）原样交给 next/link 与 next/navigation。
 * 服务端组件与客户端组件都会导入这个文件，客户端专用的 useRouter 在 navigation.client.ts
 */
const intl = createNavigation(routing)

export const { getPathname, permanentRedirect, redirect, usePathname } = intl

export { useRouter } from './navigation.client'

// next-intl 的 Link 类型里没有列出 unstable_dynamicOnHover，运行时会和其他属性一起原样交给 next/link（见 next-intl 的 BaseLink）
type LinkProps = ComponentProps<typeof intl.Link> & { unstable_dynamicOnHover?: boolean }
const IntlLink = intl.Link as ComponentType<LinkProps>
// next/link 的类型取的是 pages 路由的版本，同样没有列出 unstable_dynamicOnHover（app 路由的 Link 支持）
const AppLink = NextLink as ComponentType<ComponentProps<typeof NextLink> & { unstable_dynamicOnHover?: boolean }>

/**
 * 前台链接的预取（局部预取，见 next.config.ts 的 partialPrefetching / experimental.dynamicOnHover）：
 * 进入视口时只预取目标路由的 App Shell（站点外壳 + 骨架，同一路由的所有链接共用一份）；悬停或按下（touchstart）时升级为
 * 按链接预取，连同按地址缓存的正文一起取下来，点击时直接用缓存出内容。
 * 只要外壳、不必按链接取内容的传 unstable_dynamicOnHover={false}；完全不想预取的照常传 prefetch={false}（悬停也不会预取）
 *
 * 新标签页打开（target="_blank"）走独立文档导航，不共享当前页 Segment Cache，统一默认关闭 RSC 预取；
 * 后台地址不带语言前缀、直接交给 next/link，同样默认悬停升级；非后台的非多语言端点（/api、/rss.xml、/feed 等）默认不预取
 */
export function Link({ href, locale, prefetch, unstable_dynamicOnHover = true, ...props }: LinkProps) {
  const opensInNewTab = props.target === '_blank'
  if (typeof href === 'string' && !isLocalizedHref(href)) {
    const isConsole = isConsolePath(href.split(/[?#]/, 1)[0])
    const resolvedPrefetch = opensInNewTab ? false : (prefetch ?? (isConsole ? undefined : false))
    const dynamicOnHover = !opensInNewTab && isConsole ? unstable_dynamicOnHover : false
    return <AppLink href={href} prefetch={resolvedPrefetch} unstable_dynamicOnHover={dynamicOnHover} {...props} />
  }
  return (
    <IntlLink
      href={href}
      locale={locale}
      prefetch={opensInNewTab ? false : prefetch}
      unstable_dynamicOnHover={opensInNewTab ? false : unstable_dynamicOnHover}
      {...props}
    />
  )
}
