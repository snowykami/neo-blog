import type { Metadata } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { Inter, Source_Code_Pro, Space_Mono } from 'next/font/google'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { getSiteInfo } from '@/api/misc'
import { getLoginUserServer } from '@/api/user.server'
import { ScrollbarOverlay } from '@/components/common/scrollbar-overlay'
import { Toaster } from '@/components/ui/sonner'
import { AuthProvider } from '@/contexts/auth-context'
import { DeviceProvider } from '@/contexts/device-context'
import { MusicProvider } from '@/contexts/music-context'
import { NavPaddingProvider } from '@/contexts/nav-context'
import { SiteInfoProvider } from '@/contexts/site-info-context'
import { getFirstLocale } from '@/i18n/request'
import { fallbackSiteInfo } from '@/utils/common/siteinfo'
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
  const siteInfo = await getSiteInfo()
    .then(res => res.data)
    .catch(() => fallbackSiteInfo)
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
  const user = await getLoginUserServer()
    .then(res => res.data)
    .catch(() => null)
  const siteInfo = await getSiteInfo()
    .then(res => res.data)
    .catch(() => {
      return fallbackSiteInfo
    })
  return (
    <html
      lang={(await getFirstLocale()) || 'en'}
      className="h-full"
      data-user-color={user?.preferredColor || siteInfo?.defaultColorScheme || 'blue'}
    >
      <body className={`${geistMono.className} ${spaceMono.className} ${inter.className}`}>
        <Toaster richColors position="top-center" offset={80} />
        <NuqsAdapter>
          <DeviceProvider>
            <NextIntlClientProvider>
              <AuthProvider initialUser={user}>
                <SiteInfoProvider initialData={siteInfo}>
                  <MusicProvider>
                    <NavPaddingProvider>
                      {children}
                      <ScrollbarOverlay />
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
