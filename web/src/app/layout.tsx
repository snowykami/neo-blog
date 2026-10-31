import type { Metadata, Viewport } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { Inter, Source_Code_Pro } from 'next/font/google'
import { cookies } from 'next/headers'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { getCachedSiteInfo } from '@/api/misc.server'
import { getLoginUserServer } from '@/api/user.server'
import { AppUpdateChecker } from '@/components/common/app-update-checker'
import { FloatingWidgets } from '@/components/common/main-floating-widgets'
import { Toaster } from '@/components/ui/sonner'
import { AuthProvider } from '@/contexts/auth-context'
import { DeviceProvider } from '@/contexts/device-context'
import { MusicProvider } from '@/contexts/music-context'
import { NavProvider } from '@/contexts/nav-context'
import { SiteInfoProvider } from '@/contexts/site-info-context'
import { ThemeProvider } from '@/contexts/theme-context'
import { getFirstLocale } from '@/i18n/request'
import { resolveActiveTheme, themeAttributes, themeCssVars } from '@/themes'
import { themeInitScript } from '@/themes/init-script'
import { resolvePreviewTheme } from '@/utils/server/theme-preview'
import './globals.css'

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

export async function generateMetadata(): Promise<Metadata> {
  const siteInfo = await getCachedSiteInfo()
  return {
    title: {
      default: siteInfo.metadata.name,
      template: `%s - ${siteInfo.metadata.name}`,
    },
    icons: [{ rel: 'icon', url: siteInfo.metadata.icon }],
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // 没有任何登录凭据时可确定为访客，客户端无需再请求 /user/me（避免每次访问都产生 401）
  const cookieStore = await cookies()
  const hasAuthCookie = cookieStore.has('token') || cookieStore.has('refresh_token')
  const user = hasAuthCookie
    ? await getLoginUserServer()
        .then(res => res.data)
        .catch(() => null)
    : null
  const siteInfo = await getCachedSiteInfo()
  // 节日 / 季节性主题：只按当前日期计算，不读用户偏好，因此服务端渲染结果稳定；
  // 用户关闭主题的偏好在客户端处理（见 themeInitScript 与 ThemeProvider）
  // 管理员可在控制台强制指定主题用于预览/调试（cookie，仅 admin 生效，优先于日期）
  const preview = await resolvePreviewTheme(user)
  const theme = preview.override ? preview.theme : resolveActiveTheme()
  return (
    // 主题脚本会在水合前修改 class / style，需忽略根节点的属性差异
    <html
      suppressHydrationWarning
      lang={(await getFirstLocale()) || 'en'}
      className={`h-full ${inter.variable} ${sourceCodePro.variable}`}
      data-user-color={user?.preferredColor || siteInfo?.defaultColorScheme || 'blue'}
      // 主题色板以 CSS 自定义属性的形式注入，globals.css 里映射到既有 token
      style={themeCssVars(theme) as React.CSSProperties}
      {...themeAttributes(theme)}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="font-sans">
        <NuqsAdapter>
          <DeviceProvider>
            {/* Toaster 读取 DeviceProvider 中的主题，需放在其内部 */}
            <Toaster richColors position="top-center" offset={80} />
            <NextIntlClientProvider>
              <AppUpdateChecker />
              <ThemeProvider theme={theme}>
                <AuthProvider initialUser={user} isAnonymous={!hasAuthCookie}>
                  <SiteInfoProvider initialData={siteInfo}>
                    <MusicProvider>
                      <NavProvider>
                        <FloatingWidgets />
                        {children}
                      </NavProvider>
                    </MusicProvider>
                  </SiteInfoProvider>
                </AuthProvider>
              </ThemeProvider>
            </NextIntlClientProvider>
          </DeviceProvider>
        </NuqsAdapter>
      </body>
    </html>
  )
}
