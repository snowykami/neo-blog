import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { DeviceProvider } from "@/contexts/device-context";
import { NextIntlClientProvider } from 'next-intl';
import { AuthProvider } from "@/contexts/auth-context";
import { NavPaddingProvider } from "@/contexts/nav-context";
import { getFirstLocale } from '@/i18n/request';
import { Toaster } from "@/components/ui/sonner"
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import "./globals.css";
import { fallbackSiteInfo, SiteInfoProvider } from "@/contexts/site-info-context";
import { getSiteInfo } from "@/api/misc";
import { getLoginUserServer } from "@/api/user.server";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const siteInfo = await getSiteInfo().then(res => res.data).catch(() => fallbackSiteInfo);

  return {
    title: {
      default: siteInfo.metadata.name || "Error Blog",
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
  const siteInfo = await getSiteInfo().then(res => res.data).catch(() => fallbackSiteInfo);
  const colorSchemes = siteInfo?.colorSchemes ? siteInfo.colorSchemes : fallbackSiteInfo.colorSchemes;

  return (
    <html lang={await getFirstLocale() || "en"} className="h-full" data-user-color={colorSchemes.includes(user?.preferredColor || "") ? user?.preferredColor : "blue"}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Toaster richColors position="top-center" offset={80} />
        <NuqsAdapter>
          <DeviceProvider>
            <NextIntlClientProvider>
              <AuthProvider initialUser={user}>
                <SiteInfoProvider initialData={siteInfo!}>
                  <NavPaddingProvider>

                    {children}
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
