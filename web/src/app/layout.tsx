import type { Metadata, Viewport } from 'next'
import { getLocale } from 'next-intl/server'
import { Inter, Source_Code_Pro } from 'next/font/google'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { getCachedSiteInfo } from '@/api/misc.server'
import { LoginDialogProvider } from '@/components/auth/login-dialog'
import { AppUpdateChecker } from '@/components/common/app-update-checker'
import { FloatingWidgets } from '@/components/common/main-floating-widgets'
import { UserPreferenceSync } from '@/components/common/user-preference-sync'
import { I18nScope } from '@/components/i18n-scope'
import { Toaster } from '@/components/ui/sonner'
import { AuthProvider } from '@/contexts/auth-context'
import { DeviceProvider } from '@/contexts/device-context'
import { MusicProvider } from '@/contexts/music-context'
import { NavProvider } from '@/contexts/nav-context'
import { SiteInfoProvider } from '@/contexts/site-info-context'
import { ThemeProvider } from '@/contexts/theme-context'
import { themeAttributes, themeCssVars } from '@/themes'
import { getActiveTheme } from '@/themes/active-theme.server'
import { themeInitScript } from '@/themes/init-script'
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
  // 根布局对所有人输出同一份外壳：不读 Cookie、不查当前用户。
  // 登录状态、配色偏好、时区都在浏览器里补（见 AuthProvider、themeInitScript、ClientI18nProvider）；
  // 节日 / 季节性主题只按日期计算且跨请求缓存，用户关闭主题的偏好、管理员的预览主题在客户端处理
  // 界面语言仍按请求解析（i18n/request.ts，阶段二改为放进 URL）
  const [siteInfo, theme, locale] = await Promise.all([getCachedSiteInfo(), getActiveTheme(), getLocale()])
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
