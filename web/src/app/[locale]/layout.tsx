import type { Metadata, Viewport } from 'next'
import nodeProcess from 'node:process'
import { hasLocale } from 'next-intl'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { locale as rootLocale } from 'next/root-params'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { getCachedSiteInfo } from '@/api/misc.server'
import { LoginDialogProvider } from '@/components/auth/login-dialog'
import {
  DeferredAppUpdateChecker,
  DeferredFloatingWidgets,
  DeferredLocaleSuggestToast,
  DeferredToaster,
} from '@/components/common/root-client-deferred'
import { TopProgressBar } from '@/components/common/top-progress-bar'
import { UserPreferenceSync } from '@/components/common/user-preference-sync'
import { I18nScope } from '@/components/i18n-scope'
import { entranceContinueScript } from '@/components/layout/entrance-continue'
import { EntranceOnce } from '@/components/layout/entrance-once'
import { AuthProvider } from '@/contexts/auth-context'
import { DeviceProvider } from '@/contexts/device-context'
import { ImageOptimizeProvider } from '@/contexts/image-optimize-context'
import { MusicProvider } from '@/contexts/music-context'
import { NavProvider } from '@/contexts/nav-context'
import { SiteInfoProvider } from '@/contexts/site-info-context'
import { ThemeProvider } from '@/contexts/theme-context'
import { resolveRouteLocale, routing } from '@/i18n/routing'
import { BUILD_PLACEHOLDER_PARAM } from '@/lib/cache-tags'
import { buildSeoRobots, buildSiteVerification, resolveHomeSeoDescription } from '@/lib/seo'
import { themeAttributes, themeCssVars } from '@/themes'
import { getActiveTheme } from '@/themes/active-theme.server'
import { themeInitScript } from '@/themes/init-script'
import { getServerImageOptimizeHosts } from '@/utils/common/image.server'
import { getSiteMetadataIcons, safeMetadataBase } from '@/utils/common/siteinfo'
// 代码字体通过 globals.css 引入 src/fonts/fonts.css，无衬线正文字体在 @theme 中使用系统原生西文与中文回退栈
import '@/app/globals.css'

// 浏览器地址栏 / 状态栏颜色跟随系统明暗，与顶部导航卡片同色（暗色取默认色相下的 --card 近似值）
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#181e24' },
  ],
}

function resolveAssetPreconnectOrigin(baseUrl: string | undefined): string | null {
  // 仅当配置了独立跨域静态资源 CDN（NEXT_PUBLIC_ASSET_PREFIX，承载 CORS @font-face 与静态分块）时输出 preconnect；
  // imageOptimizeHosts 经同源 /_next/image 代理，外链原图走非 CORS 连接池，不输出无效的匿名 preconnect
  // eslint-disable-next-line node/prefer-global/process
  const rawAssetPrefix = (nodeProcess.env.NEXT_PUBLIC_ASSET_PREFIX ?? process.env.NEXT_PUBLIC_ASSET_PREFIX ?? '').trim()
  if (!/^https?:\/\//i.test(rawAssetPrefix))
    return null

  let siteOrigin = ''
  if (baseUrl?.trim()) {
    try {
      siteOrigin = new URL(baseUrl.trim()).origin
    }
    catch {}
  }

  try {
    const assetOrigin = new URL(rawAssetPrefix).origin
    return assetOrigin && assetOrigin !== siteOrigin ? assetOrigin : null
  }
  catch {
    return null
  }
}

// 构建期只返回占位参数（不是任何语言，下面直接 404）：Cache Components 要求根参数至少有一个值，但镜像构建连不上后端，
// 预渲染只能把兜底内容固化进页面。真实语言的页面在第一次被访问时用真实的后端数据生成并缓存（见 lib/cache-tags.ts 的 BUILD_PLACEHOLDER_PARAM）；
// 取数失败时直接抛错（见 api/misc.server.ts），错误页不进缓存，已有的页面继续提供。
// 开发态返回全部真实语言，避免 next dev 将 [locale] 视为未知 fallback 参数导致根布局与主布局 params 阻塞静态外壳校验
export function generateStaticParams() {
  // eslint-disable-next-line node/prefer-global/process
  if ((nodeProcess.env.NEXT_PHASE ?? process.env.NEXT_PHASE) === 'phase-production-build')
    return [{ locale: BUILD_PLACEHOLDER_PARAM }]
  return routing.locales.map(locale => ({ locale }))
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = resolveRouteLocale(await rootLocale())
  setRequestLocale(locale)
  const [siteInfo, routeT] = await Promise.all([
    getCachedSiteInfo(),
    getTranslations('Route'),
  ])
  const defaultDesc = resolveHomeSeoDescription(
    siteInfo,
    routeT('home_desc', { site: siteInfo.metadata.name || 'Blog' }),
  )
  const verification = buildSiteVerification(siteInfo)
  const rssEnabled = siteInfo.seo?.rssEnabled ?? true
  return {
    // 页面里的 canonical、hreflang、分享图都写站内路径，统一按站点地址补全
    metadataBase: safeMetadataBase(siteInfo.baseUrl),
    generator: 'neo-blog',
    title: {
      default: siteInfo.metadata.name,
      template: `%s - ${siteInfo.metadata.name}`,
    },
    description: defaultDesc || undefined,
    keywords: siteInfo.keywords?.length ? siteInfo.keywords : undefined,
    ...(verification ? { verification } : {}),
    ...(rssEnabled ? { alternates: { types: { 'application/rss+xml': '/rss.xml' } } } : {}),
    robots: buildSeoRobots(locale, siteInfo),
    // 没有配置站点图标时不输出 icon 链接，浏览器使用 /favicon.ico；圆角 > 0% 时指向强缓存裁剪路由
    icons: getSiteMetadataIcons(siteInfo),
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // 根布局对所有人输出同一份外壳：不读 Cookie、不查当前用户。
  // 登录状态、配色偏好、时区都在浏览器里补（见 AuthProvider、themeInitScript、ClientI18nProvider）；
  // 节日 / 季节性主题只按日期计算且跨请求缓存，用户关闭主题的偏好、管理员的预览主题在客户端处理
  // 界面语言来自 URL（[locale] 根参数，见 i18n/request.ts 与 proxy.ts）。不认识的语言段按 404 处理：
  // 前台地址都经 proxy 改写过，走到这里的只有 proxy 不处理的地址（/foo.png、/api/不存在），只返回 404 状态与空白页
  const locale = await rootLocale()
  if (!hasLocale(routing.locales, locale))
    notFound()
  setRequestLocale(locale)
  const [siteInfo, theme] = await Promise.all([getCachedSiteInfo(), getActiveTheme()])
  const imageOptimizeHosts = getServerImageOptimizeHosts()
  const assetPreconnectOrigin = resolveAssetPreconnectOrigin(siteInfo.baseUrl)
  // 运行时环境变量优先；若未设置则回退到构建时内联的 NEXT_PUBLIC_ENABLE_TELEMETRY，默认开启
  // eslint-disable-next-line node/prefer-global/process
  const telemetryEnabled = (nodeProcess.env.ENABLE_TELEMETRY ?? nodeProcess.env.NEXT_PUBLIC_ENABLE_TELEMETRY ?? process.env.NEXT_PUBLIC_ENABLE_TELEMETRY ?? 'true') !== 'false'
  return (
    // 主题脚本会在水合前修改 class / style，需忽略根节点的属性差异
    <html
      suppressHydrationWarning
      lang={locale}
      className="h-full"
      data-telemetry={telemetryEnabled}
      // 站点默认配色；访客 / 用户自己选的配色存在 localStorage，由 themeInitScript 在首帧前换上
      data-user-color={siteInfo?.defaultColorScheme || 'blue'}
      // 主题色板以 CSS 自定义属性的形式注入，globals.css 里映射到既有 token
      style={themeCssVars(theme) as React.CSSProperties}
      {...themeAttributes(theme)}
    >
      <head>
        {assetPreconnectOrigin && (
          <link rel="preconnect" href={assetPreconnectOrigin} crossOrigin="" />
        )}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {/* 骨架换成正文时入场动画接着播、不重播（见该脚本）；要在正文流式替换骨架之前就开始观察，所以放在 head */}
        <script dangerouslySetInnerHTML={{ __html: entranceContinueScript }} />
      </head>
      <body className="font-sans">
        {/* 顶部细加载进度条：由 onRouterTransitionStart 驱动，静置态零节点零定时器 */}
        <TopProgressBar />
        {/* 首屏播完完整入场动画后，客户端跳转改播轻快版（见该组件） */}
        <EntranceOnce />
        <NuqsAdapter>
          <ImageOptimizeProvider hosts={imageOptimizeHosts}>
            <DeviceProvider>
              {/* Toaster 读取 DeviceProvider 中的主题，需放在其内部；异步按需挂载以减少首屏未执行 JS */}
              <DeferredToaster />
              {/* 只下发根布局这一层用到的文案，其余由各路由段的作用域补齐（见 scripts/i18n-scopes.mjs） */}
              <I18nScope scope="root" locale={locale}>
                <DeferredAppUpdateChecker />
                {/* ThemeProvider 要按登录用户的角色决定是否应用管理员的主题预览，所以放在 AuthProvider 里面 */}
                <AuthProvider>
                  <ThemeProvider theme={theme}>
                    {/* 快捷登录弹窗里的注册表单要用到站点信息（验证码冷却），所以站点信息在弹窗外层 */}
                    <SiteInfoProvider initialData={siteInfo}>
                      {/* 登录后把账号里的界面语言、配色同步到本浏览器（要用站点信息里的可选配色，所以放在这里） */}
                      <UserPreferenceSync />
                      {/* 浏览器首选语言与当前页面语言不一致时，空闲后以目标语言弹出轻量切换提示 */}
                      <DeferredLocaleSuggestToast />
                      <LoginDialogProvider>
                        <MusicProvider musicEnabled={Boolean(siteInfo.musicEnabled)}>
                          <NavProvider>
                            {children}
                            {/* 悬浮按钮放在页面内容之后：Tab 顺序先到「跳到正文」与页面本身，最后才是播放器 / 回到顶部 */}
                            <DeferredFloatingWidgets />
                          </NavProvider>
                        </MusicProvider>
                      </LoginDialogProvider>
                    </SiteInfoProvider>
                  </ThemeProvider>
                </AuthProvider>
              </I18nScope>
            </DeviceProvider>
          </ImageOptimizeProvider>
        </NuqsAdapter>
      </body>
    </html>
  )
}
