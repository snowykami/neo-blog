import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { DeviceProvider } from "@/contexts/device-context";
import { NextIntlClientProvider } from 'next-intl';
import { AuthProvider } from "@/contexts/auth-context";
import { getFirstLocale } from '@/i18n/request';
import { Toaster } from "@/components/ui/sonner"
import { getLoginUser } from "@/api/user";
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import "./globals.css";
import { fallbackSiteInfo, SiteInfoProvider } from "@/contexts/site-info-context";
import { getSiteInfo } from "@/api/misc";

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
  const siteName = siteInfo?.metadata?.name ?? "Snowykami's Blog";
  const description = siteInfo?.metadata?.description ?? "分享一些好玩的东西";
  const icon = siteInfo?.metadata?.icon ?? "/favicon.ico";
  const defaultImage = siteInfo?.defaultCover ?? icon;

  return {
    title: {
      default: siteName,
      template: `%s - ${siteName}`,
    },
    description,
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
    icons: {
      icon,
      apple: icon,
    },
    openGraph: {
      title: siteName,
      description,
      type: 'website',
      images: [
        {
          url: defaultImage,
          alt: siteName,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: siteName,
      description,
      images: defaultImage ? [defaultImage] : undefined,
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {

  const token = (await cookies()).get("token")?.value || "";
  const refreshToken = (await cookies()).get("refresh_token")?.value || "";
  const user = await getLoginUser({ token, refreshToken }).then(res => res.data).catch(() => null);
  const siteInfo = await getSiteInfo().then(res => res.data).catch(() => fallbackSiteInfo);
  const colorSchemes = siteInfo?.colorSchemes ? siteInfo.colorSchemes : fallbackSiteInfo.colorSchemes;

  return (
    <html lang={await getFirstLocale() || "en"} className="h-full" data-user-color={(colorSchemes).includes(user?.preferredColor || "") ? user?.preferredColor : "blue"}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Toaster richColors position="top-center" offset={80} />
        <NuqsAdapter>
          <DeviceProvider>
            <NextIntlClientProvider>
              <AuthProvider initialUser={user}>
                <SiteInfoProvider initialData={siteInfo!}>
                  {children}
                </SiteInfoProvider>
              </AuthProvider>
            </NextIntlClientProvider>
          </DeviceProvider>
        </ NuqsAdapter>
      </body>
    </html>
  );
}
