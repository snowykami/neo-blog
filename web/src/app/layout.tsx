import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { DeviceProvider } from "@/contexts/device-context";
import { NextIntlClientProvider } from 'next-intl';
import { AuthProvider } from "@/contexts/auth-context";
import config from "@/config";
import { getFirstLocale } from '@/i18n/request';
import { Toaster } from "@/components/ui/sonner"
import { getLoginUser } from "@/api/user";
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import "./globals.css";
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: config.metadata.name,
  description: config.metadata.description,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const token = (await cookies()).get("token")?.value || "";
  const refreshToken = (await cookies()).get("refresh_token")?.value || "";
  const user = await getLoginUser({ token, refreshToken }).then(res => res.data).catch(() => null);

  return (
    <html lang={await getFirstLocale() || "en"} className="h-full">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Toaster richColors position="top-center" offset={80} />
        <NuqsAdapter>
          <DeviceProvider>
            <NextIntlClientProvider>
              <AuthProvider initialUser={user}>
                {children}
              </AuthProvider>
            </NextIntlClientProvider>
          </DeviceProvider>
        </ NuqsAdapter>
      </body>
    </html>
  );
}
