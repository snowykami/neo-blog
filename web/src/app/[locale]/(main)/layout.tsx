import { getCachedNavPages } from '@/api/nav-pages.server'
import { I18nScope } from '@/components/i18n-scope'
import { MainShell } from './main-shell'

export default async function MainLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // 顶栏「页面」菜单随布局服务端渲染（跨请求缓存，见 api/nav-pages.server.ts）
  const navPages = await getCachedNavPages()
  return (
    <I18nScope scope="(main)">
      <MainShell navPages={navPages}>{children}</MainShell>
    </I18nScope>
  )
}
