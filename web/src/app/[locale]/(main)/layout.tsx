import { getCachedNavPages } from '@/api/nav-pages.server'
import { I18nScope } from '@/components/i18n-scope'
import { MainShell } from './main-shell'

export default async function MainLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode
  params: Promise<{ locale: string }>
}>) {
  // 顶栏「页面」菜单随布局服务端渲染（跨请求缓存，见 api/nav-pages.server.ts）
  const [{ locale }, navPages] = await Promise.all([params, getCachedNavPages()])
  return (
    <I18nScope scope="(main)" locale={locale}>
      <MainShell navPages={navPages}>{children}</MainShell>
    </I18nScope>
  )
}
