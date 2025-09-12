import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { DeviceProvider } from "@/contexts/device-context";
import { NextIntlClientProvider } from 'next-intl';
import config from "@/config";
import { getUserLocales, getFirstLocale } from '@/i18n/request';
import { Toaster } from "@/components/ui/sonner"

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
  return (
    <html lang={await getFirstLocale() || "en"} className="h-full">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Toaster richColors position="top-center" offset={80} />
        <DeviceProvider>
            <NextIntlClientProvider>{children}</NextIntlClientProvider>
        </DeviceProvider>
      </body>
    </html>
  );
}
