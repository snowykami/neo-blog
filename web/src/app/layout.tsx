import type { Metadata } from "next";
import { Source_Code_Pro, Josefin_Sans } from "next/font/google";
import { DeviceProvider } from "@/contexts/device-context";
import { NextIntlClientProvider } from 'next-intl';
import { AuthProvider } from "@/contexts/auth-context";
import { NavPaddingProvider } from "@/contexts/nav-context";
import { getFirstLocale } from '@/i18n/request';
import { Toaster } from "@/components/ui/sonner"
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import "./globals.css";
import { SiteInfoProvider } from "@/contexts/site-info-context";
import { getSiteInfo } from "@/api/misc";
import { getLoginUserServer } from "@/api/user.server";
import ScrollbarOverlay from "@/components/common/scrollbar-overlay";
import { fallbackSiteInfo } from "@/utils/common/siteinfo";


const geistSans = Josefin_Sans({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Source_Code_Pro({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});


export async function generateMetadata(): Promise<Metadata> {
  const siteInfo = await getSiteInfo().then(res => res.data).catch(() => fallbackSiteInfo);
  return {
    title: {
      default: siteInfo.metadata.name,
      template: `%s - ${siteInfo.metadata.name}`,
    },
    icons: [
      { rel: 'icon', url: siteInfo.metadata.icon },
    ]
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {

  const user = await getLoginUserServer().then(res => res.data).catch(() => null);
  const siteInfo = await getSiteInfo().then(res => res.data).catch(
    () => {
      console.error("Failed to fetch site info from backend server, using fallback.");
      return fallbackSiteInfo
    }
  );
  return (
    <html lang={await getFirstLocale() || "en"} className="h-full" data-user-color={user?.preferredColor || siteInfo?.defaultColorScheme || "blue"}>
      <body
        className={`${geistMono.className} ${geistSans.className} antialiased`}
      >
        <Toaster richColors position="top-center" offset={80} />
        <NuqsAdapter>
          <DeviceProvider>
            <NextIntlClientProvider>
              <AuthProvider initialUser={user}>
                <SiteInfoProvider initialData={siteInfo!}>
                  <NavPaddingProvider>
                    {children}
                    <ScrollbarOverlay />
                  </NavPaddingProvider>
                </SiteInfoProvider>
              </AuthProvider>
            </NextIntlClientProvider>
          </DeviceProvider>
        </ NuqsAdapter>
      </body>
    </html>
  );
}
