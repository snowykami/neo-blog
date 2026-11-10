// 由 pnpm i18n:scopes 生成，请勿手改
// 只为这一层子树准备它用到的文案，避免整份语言表随页面下发（见 src/components/i18n-scope.tsx）
import { I18nScope as I18nScopeProvider } from '@/components/i18n-scope'

export default function Layout({ children }: { children: React.ReactNode }) {
  return <I18nScopeProvider scope="console/lyric-effects">{children}</I18nScopeProvider>
}
