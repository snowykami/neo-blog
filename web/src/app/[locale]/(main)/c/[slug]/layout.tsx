import { I18nScope as I18nScopeProvider } from '@/components/i18n-scope'
import { findCategoryOr404 } from './category-data'

/*
 * 手写的作用域 layout（不由 pnpm i18n:scopes 生成，见 scripts/i18n-scopes.mjs 的 MANUAL_SCOPE_DIRS）：
 * 不存在的分类要在 loading.tsx 的骨架流出之前判定 404，否则只能返回 200（软 404）。
 * layout 在 loading 边界之外，它判定完才开始流式输出
 */
export default async function Layout({ children, params }: { children: React.ReactNode, params: Promise<{ slug: string }> }) {
  const { slug } = await params
  await findCategoryOr404(slug)
  return <I18nScopeProvider scope="(main)/c/[slug]">{children}</I18nScopeProvider>
}
