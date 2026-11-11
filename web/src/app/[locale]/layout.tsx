import type { Metadata, Viewport } from 'next'
import { hasLocale } from 'next-intl'
import { Inter, Source_Code_Pro } from 'next/font/google'
import { notFound } from 'next/navigation'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { getCachedSiteInfo } from '@/api/misc.server'
import { LoginDialogProvider } from '@/components/auth/login-dialog'
import { AppUpdateChecker } from '@/components/common/app-update-checker'
import { FloatingWidgets } from '@/components/common/main-floating-widgets'
import { UserPreferenceSync } from '@/components/common/user-preference-sync'
import { I18nScope } from '@/components/i18n-scope'
import { EntranceOnce } from '@/components/layout/entrance-once'
import { Toaster } from '@/components/ui/sonner'
import { AuthProvider } from '@/contexts/auth-context'
import { DeviceProvider } from '@/contexts/device-context'
import { MusicProvider } from '@/contexts/music-context'
import { NavProvider } from '@/contexts/nav-context'
import { SiteInfoProvider } from '@/contexts/site-info-context'
import { ThemeProvider } from '@/contexts/theme-context'
import { routing } from '@/i18n/routing'
import { BUILD_PLACEHOLDER_PARAM } from '@/lib/cache-tags'
import { themeAttributes, themeCssVars } from '@/themes'
import { getActiveTheme } from '@/themes/active-theme.server'
import { themeInitScript } from '@/themes/init-script'
import { safeMetadataBase } from '@/utils/common/siteinfo'
import '@/app/globals.css'

// 字体通过 CSS 变量注入，在 globals.css 的 @theme 中组合中文回退字体（font-sans / font-mono）
const sourceCodePro = Source_Code_Pro({
  variable: '--font-source-code-pro',
  subsets: ['latin'],
  display: 'swap',
})

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
})

// 浏览器地址栏 / 状态栏颜色跟随系统明暗，与顶部导航卡片同色（暗色取默认色相下的 --card 近似值）
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#181e24' },
  ],
}

// 构建期只返回占位参数（不是任何语言，下面直接 404）：Cache Components 要求根参数至少有一个值，但镜像构建连不上后端，
// 预渲染只能把兜底内容固化进页面。真实语言的页面在第一次被访问时用真实的后端数据生成并缓存（见 lib/cache-tags.ts 的 BUILD_PLACEHOLDER_PARAM）；
// 取数失败时直接抛错（见 api/misc.server.ts），错误页不进缓存，已有的页面继续提供
export function generateStaticParams() {
  return [{ locale: BUILD_PLACEHOLDER_PARAM }]
}

export async function generateMetadata(): Promise<Metadata> {
  const siteInfo = await getCachedSiteInfo()
  return {
    // 页面里的 canonical、hreflang、分享图都写站内路径，统一按站点地址补全
    metadataBase: safeMetadataBase(siteInfo.baseUrl),
    title: {
      default: siteInfo.metadata.name,
      template: `%s - ${siteInfo.metadata.name}`,
    },
    icons: [{ rel: 'icon', url: siteInfo.metadata.icon }],
  }
}

export default async function RootLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode
  params: Promise<{ locale: string }>
}>) {
  // 根布局对所有人输出同一份外壳：不读 Cookie、不查当前用户。
  // 登录状态、配色偏好、时区都在浏览器里补（见 AuthProvider、themeInitScript、ClientI18nProvider）；
  // 节日 / 季节性主题只按日期计算且跨请求缓存，用户关闭主题的偏好、管理员的预览主题在客户端处理
  // 界面语言来自 URL（[locale] 段，见 i18n/request.ts 与 proxy.ts）。不认识的语言段按 404 处理：
  // 前台地址都经 proxy 改写过，走到这里的只有 proxy 不处理的地址（/foo.png、/api/不存在），只返回 404 状态与空白页
  const { locale } = await params
  if (!hasLocale(routing.locales, locale))
    notFound()
  const [siteInfo, theme] = await Promise.all([getCachedSiteInfo(), getActiveTheme()])
  return (
    // 主题脚本会在水合前修改 class / style，需忽略根节点的属性差异
    <html
      suppressHydrationWarning
      lang={locale}
      className={`h-full ${inter.variable} ${sourceCodePro.variable}`}
      // 站点默认配色；访客 / 用户自己选的配色存在 localStorage，由 themeInitScript 在首帧前换上
      data-user-color={siteInfo?.defaultColorScheme || 'blue'}
      // 主题色板以 CSS 自定义属性的形式注入，globals.css 里映射到既有 token
      style={themeCssVars(theme) as React.CSSProperties}
      {...themeAttributes(theme)}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="font-sans">
        {/* 首屏播完完整入场动画后，客户端跳转改播轻快版（见该组件） */}
        <EntranceOnce />
        <NuqsAdapter>
          <DeviceProvider>
            {/* Toaster 读取 DeviceProvider 中的主题，需放在其内部 */}
            <Toaster richColors position="top-center" offset={80} />
            {/* 只下发根布局这一层用到的文案，其余由各路由段的作用域补齐（见 scripts/i18n-scopes.mjs） */}
            <I18nScope scope="root">
              <AppUpdateChecker />
              {/* ThemeProvider 要按登录用户的角色决定是否应用管理员的主题预览，所以放在 AuthProvider 里面 */}
              <AuthProvider>
                <ThemeProvider theme={theme}>
                  {/* 快捷登录弹窗里的注册表单要用到站点信息（验证码冷却），所以站点信息在弹窗外层 */}
                  <SiteInfoProvider initialData={siteInfo}>
                    {/* 登录后把账号里的界面语言、配色同步到本浏览器（要用站点信息里的可选配色，所以放在这里） */}
                    <UserPreferenceSync />
                    <LoginDialogProvider>
                      <MusicProvider>
                        <NavProvider>
                          <FloatingWidgets />
                          {children}
                        </NavProvider>
                      </MusicProvider>
                    </LoginDialogProvider>
                  </SiteInfoProvider>
                </ThemeProvider>
              </AuthProvider>
            </I18nScope>
          </DeviceProvider>
        </NuqsAdapter>
      </body>
    </html>
  )
}
