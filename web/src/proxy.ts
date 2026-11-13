import type { NextRequest } from 'next/server'
import createMiddleware from 'next-intl/middleware'
import { NextResponse } from 'next/server'
import { detectPreferredLocale } from '@/i18n/detect'
import { LOCALE_COOKIE } from '@/i18n/locale-cookie'
import { isConsolePath, localizePath, routing, splitLocalePrefix } from '@/i18n/routing'

/**
 * 语言路由（Next 16 起 middleware 改名为 proxy）
 *
 * 前台：语言只看地址前缀。未带前缀的地址就是简体中文，对所有人返回同一份内容；
 * 只有「浏览器打开页面」且偏好是别的语言时（语言 Cookie > Accept-Language，见 i18n/detect.ts）才临时跳转到带前缀的地址，
 * 客户端路由的取数、预取不跳，避免浏览中途换语言。跳转响应标记为不缓存，页面本身不读 Cookie、不写 Cookie。
 * 带前缀的地址（/en/p/x）不再按偏好跳转：用户打开的是哪种语言就是哪种。
 *
 * 后台（/console）不带语言前缀，界面语言按偏好：这里在内部改写到 /{语言}/console/...，地址栏不变。
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

/** 浏览器打开页面（地址栏、刷新、外链）；客户端路由的 RSC 请求与预取是 empty，不在这里跳转 */
function isDocumentRequest(request: NextRequest) {
  const dest = request.headers.get('sec-fetch-dest')
  return dest === null || dest === 'document'
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
  // 跳转与否因人而异，不能被共享缓存存下来
  response.headers.set('Cache-Control', 'private, no-store')
  response.headers.set('Vary', 'Cookie, Accept-Language')
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

  if (!prefixed.locale && isDocumentRequest(request)) {
    const locale = preferredLocale(request)
    if (locale && locale !== routing.defaultLocale)
      return redirectTo(request, localizePath(pathname, locale))
    // 不带前缀的页面对偏好别的语言的人会跳转（上面），这份 200 响应其实因人而异：ISR 页面带着 s-maxage，
    // CDN 若把它存下来，之后偏好别的语言的访客就拿不到跳转了。用 CDN-Cache-Control（RFC 9213，浏览器不认）只让共享缓存不存；
    // 带前缀的整页文档对所有人一致，照常按 Cache-Control 缓存
    const response = handleI18nRouting(request)
    response.headers.set('CDN-Cache-Control', 'no-store')
    return response
  }

  const response = handleI18nRouting(request)
  if (isRscRequest(request)) {
    // 客户端路由取数与预取含当前构建的代码块文件名，禁止外层共享缓存跨版本留存；带前缀的整页文档仍照常按 Cache-Control 缓存
    response.headers.set('CDN-Cache-Control', 'no-store')
  }
  return response
}

export const config = {
  // 接口、Next 内部资源、健康检查、public 目录里的静态文件，以及 rss.xml / sitemap.xml / robots.txt 这类带扩展名的文件不经过这里。
  // 只排除常见静态文件扩展名，而不是所有带点的路径：文章 slug 里可能有点（/p/v1.0）
  matcher: ['/((?!api/|_next/|_vercel/|healthz|fonts/|image/|.*\\.(?:ico|png|jpe?g|gif|webp|avif|svg|txt|xml|json|js|mjs|css|map|woff2?|ttf|otf|webmanifest)$).*)'],
}
