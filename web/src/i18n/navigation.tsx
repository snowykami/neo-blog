import type { ComponentProps, ComponentType } from 'react'
import { createNavigation } from 'next-intl/navigation'
import NextLink from 'next/link'
import { isLocalizedHref, routing } from './routing'

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

/**
 * 前台链接的预取（见 next.config.ts 的 experimental.dynamicOnHover / staleTimes）：
 * 进入视口时按默认方式预取，动态页面只拿到最近的 loading.tsx 骨架为止；悬停或按下（touchstart）时升级为完整预取，
 * 点击时直接用缓存出内容。不想预取的链接照常传 prefetch={false}（悬停也不会预取）
 */
export function Link({ href, locale, unstable_dynamicOnHover = true, ...props }: LinkProps) {
  if (typeof href === 'string' && !isLocalizedHref(href))
    return <NextLink href={href} {...props} />
  return <IntlLink href={href} locale={locale} unstable_dynamicOnHover={unstable_dynamicOnHover} {...props} />
}
