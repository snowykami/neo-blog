import type { NextRequest } from 'next/server'
import createMiddleware from 'next-intl/middleware'
import { NextResponse } from 'next/server'
import { detectPreferredLocale } from '@/i18n/detect'
import { LOCALE_COOKIE } from '@/i18n/locale-cookie'
import { isConsolePath, routing, splitLocalePrefix } from '@/i18n/routing'

/**
 * 语言路由（Next 16 起 middleware 改名为 proxy）
 *
 * 前台：语言只看地址前缀。未带前缀的地址就是简体中文，对所有人返回同一份内容（不再按 Cookie 或
 * Accept-Language 自动 307 跳转），整页文档可正常被外层 CDN 缓存；只有客户端路由的 RSC 请求排除缓存。
 * 带前缀的地址（/en/p/x）就是对应语言，由 next-intl 改写到内部路径 /en/p/x。
 *
 * 后台（/console）不带语言前缀，界面语言按偏好（语言 Cookie > Accept-Language，见 i18n/detect.ts）：
 * 这里在内部改写到 /{语言}/console/...，地址栏不变。
 *
 * 其余交给 next-intl：把 /p/x 改写到内部路径 /zh-CN/p/x，/zh-tw/x 改写到 /zh-TW/x，
 * /zh-cn/x 这类多余的默认语言前缀与内部写法（/zh-TW/x）跳转回规范地址。
 */
const handleI18nRouting = createMiddleware(routing)

function preferredLocale(request: NextRequest) {
  return detectPreferredLocale({
    cookie: request.cookies.get(LOCALE_COOKIE)?.value,
    acceptLanguage: request.headers.get('accept-language'),
  })
}

/**
 * 客户端路由的取数与预取请求（RSC Flight 流）：响应体里引用了本次构建专用的 JS 代码块文件名，
 * 而 _rsc 查询参数只对路由状态头做哈希、不含构建号，不能让外层 CDN 跨部署缓存（前端副本内已有 L1 + 按构建号隔离的 Redis 页面缓存）
 */
function isRscRequest(request: NextRequest) {
  return request.headers.get('rsc') === '1' || request.nextUrl.searchParams.has('_rsc')
}

function redirectTo(request: NextRequest, pathname: string) {
  const url = request.nextUrl.clone()
  url.pathname = pathname
  const response = NextResponse.redirect(url)
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const prefixed = splitLocalePrefix(pathname)

  if (isConsolePath(prefixed.pathname)) {
    // 后台地址不带语言：/en/console → /console
    if (prefixed.locale)
      return redirectTo(request, prefixed.pathname)
    const locale = preferredLocale(request) ?? routing.defaultLocale
    const url = request.nextUrl.clone()
    url.pathname = `/${locale}${pathname}`
    const response = NextResponse.rewrite(url)
    // 后台界面语言因人而异，且路由壳预取含当前构建的代码块文件名，不能进共享缓存
    response.headers.set('CDN-Cache-Control', 'no-store')
    return response
  }

  const response = handleI18nRouting(request)
  if (isRscRequest(request)) {
    // 客户端路由取数与预取含当前构建的代码块文件名，禁止外层共享缓存跨版本留存；整页文档照常按 Cache-Control 缓存
    response.headers.set('CDN-Cache-Control', 'no-store')
  }
  return response
}

export const config = {
  // 接口、Next 内部资源、健康检查、public 目录里的静态文件，以及 rss.xml / sitemap.xml / robots.txt 这类带扩展名的文件不经过这里。
  // 只排除常见静态文件扩展名，而不是所有带点的路径：文章 slug 里可能有点（/p/v1.0）
  matcher: ['/((?!api/|_next/|_vercel/|healthz|fonts/|image/|.*\\.(?:ico|png|jpe?g|gif|webp|avif|svg|txt|xml|json|js|mjs|css|map|woff2?|ttf|otf|webmanifest)$).*)'],
}
