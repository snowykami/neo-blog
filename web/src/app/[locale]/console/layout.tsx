import { I18nScope } from '@/components/i18n-scope'
import { ConsoleShell } from './console-shell'

// 后台按请求渲染：地址不带语言前缀，界面语言由 proxy.ts 按偏好改写进 [locale] 段，不预渲染每种语言的后台页面
export const dynamic = 'force-dynamic'

export default function ConsoleLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <I18nScope scope="console">
      <ConsoleShell>{children}</ConsoleShell>
    </I18nScope>
  )
}
