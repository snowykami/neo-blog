import type { Metadata } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { Inter, Source_Code_Pro, Space_Mono } from 'next/font/google'
import { cookies } from 'next/headers'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { getCachedSiteInfo } from '@/api/misc.server'
import { getLoginUserServer } from '@/api/user.server'
import { FloatingWidgets } from '@/components/common/main-floating-widgets'
import { Toaster } from '@/components/ui/sonner'
import { AuthProvider } from '@/contexts/auth-context'
import { DeviceProvider } from '@/contexts/device-context'
import { MusicProvider } from '@/contexts/music-context'
import { NavPaddingProvider } from '@/contexts/nav-context'
import { SiteInfoProvider } from '@/contexts/site-info-context'
import { getFirstLocale } from '@/i18n/request'
import './globals.css'

const geistMono = Source_Code_Pro({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  display: 'swap',
})

const spaceMono = Space_Mono({
  variable: '--font-space-mono',
  subsets: ['latin'],
  display: 'swap',
  weight: '400',
})

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
})

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
  return (
    <html
      lang={(await getFirstLocale()) || 'en'}
      className="h-full"
      data-user-color={user?.preferredColor || siteInfo?.defaultColorScheme || 'blue'}
    >
      <body className={`${geistMono.className} ${spaceMono.className} ${inter.className} hide-scrollbar`}>
        <Toaster richColors position="top-center" offset={80} />
        <NuqsAdapter>
          <DeviceProvider>
            <NextIntlClientProvider>
              <AuthProvider initialUser={user} isAnonymous={!hasAuthCookie}>
                <SiteInfoProvider initialData={siteInfo}>
                  <MusicProvider>
                    <NavPaddingProvider>
                      <FloatingWidgets />
                      {children}
                    </NavPaddingProvider>
                  </MusicProvider>
                </SiteInfoProvider>
              </AuthProvider>
            </NextIntlClientProvider>
          </DeviceProvider>
        </NuqsAdapter>
      </body>
    </html>
  )
}
