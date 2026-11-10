import { I18nScope as I18nScopeProvider } from '@/components/i18n-scope'
import { getExistingUser } from './user-data'

/*
 * 手写的作用域 layout（不由 pnpm i18n:scopes 生成，见 scripts/i18n-scopes.mjs 的 MANUAL_SCOPE_DIRS）：
 * 用户页主体在客户端拉取，但存在性必须在服务端、并且在 loading.tsx 的骨架流出之前判定，
 * 否则 /u/任意字符串 都会返回 200（软 404）。layout 在 loading 边界之外，它判定完才开始流式输出
 */
export default async function Layout({ children, params }: { children: React.ReactNode, params: Promise<{ username: string }> }) {
  const { username } = await params
  await getExistingUser(username)
  return <I18nScopeProvider scope="(main)/u/[username]">{children}</I18nScopeProvider>
}
