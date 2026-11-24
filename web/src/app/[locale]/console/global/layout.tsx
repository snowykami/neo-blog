// 由 pnpm i18n:scopes 生成，请勿手改
// 只为这一层子树准备它用到的文案，避免整份语言表随页面下发（见 src/components/i18n-scope.tsx）
import { ScopedI18n } from '@/components/i18n-scope'

// 后台按请求渲染，不做即时导航校验（见 app/[locale]/console/layout.tsx）
export const instant = false

export default function Layout({
  children,
}: {
  children: React.ReactNode
}) {
  return <ScopedI18n scope="console/global">{children}</ScopedI18n>
}
