import type { ComponentProps } from 'react'
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

type LinkProps = ComponentProps<typeof intl.Link>

export function Link({ href, locale, ...props }: LinkProps) {
  if (typeof href === 'string' && !isLocalizedHref(href))
    return <NextLink href={href} {...props} />
  return <intl.Link href={href} locale={locale} {...props} />
}
