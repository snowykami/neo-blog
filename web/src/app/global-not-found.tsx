import type { Metadata } from 'next'
import NotFound from '@/app/[locale]/not-found'
import { I18nScope } from '@/components/i18n-scope'
import { routing } from '@/i18n/routing'
import '@/app/globals.css'

// 根布局在 [locale] 段下，没有一个固定的根布局能拼出全站 404，Next 用这个文件生成兜底的 /_not-found（路由层面没匹配上时）。
// 前台地址都会被 proxy.ts 改写进 [locale]，未匹配的前台地址由 (main)/[...rest] 按当前语言显示带站点外壳的 404，
// 这里只是兜底：不经过根布局，没有站点信息与主题，按默认语言给一个能回首页的页面
export const metadata: Metadata = {
  title: '404',
}

export default function GlobalNotFound() {
  return (
    <html lang={routing.defaultLocale} className="h-full">
      <body className="flex min-h-full flex-col font-sans">
        <I18nScope scope="root">
          <NotFound />
        </I18nScope>
      </body>
    </html>
  )
}
