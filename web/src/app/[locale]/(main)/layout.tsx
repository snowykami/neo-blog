import { locale as rootLocale } from 'next/root-params'
import { getCachedNavPages } from '@/api/nav-pages.server'
import { I18nScope } from '@/components/i18n-scope'
import { MainShell } from './main-shell'

export default async function MainLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // 顶栏「页面」菜单随布局服务端渲染（跨请求缓存，见 api/nav-pages.server.ts）；
  // 使用 next/root-params 读取根语言参数，避免子动态段（如 [id]、[slug]）将布局 params 推迟至运行时阶段
  const [locale, navPages] = await Promise.all([rootLocale(), getCachedNavPages()])
  return (
    <I18nScope scope="(main)" locale={locale}>
      <MainShell navPages={navPages}>{children}</MainShell>
    </I18nScope>
  )
}
