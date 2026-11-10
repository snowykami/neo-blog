import { I18nScope as I18nScopeProvider } from '@/components/i18n-scope'
import { getCanonicalPost } from './post-data'

/*
 * 手写的作用域 layout（不由 pnpm i18n:scopes 生成，见 scripts/i18n-scopes.mjs 的 MANUAL_SCOPE_DIRS）：
 * 除了为子树准备文案，还要在 loading.tsx 的骨架流出之前判定 404 与 slug 跳转。
 * 骨架一流出，响应头里的状态码就定了，page 或 generateMetadata 里再 notFound() / permanentRedirect()
 * 只能得到 200 + noindex / meta refresh（对爬虫是软 404）；layout 在 loading 边界之外，它判定完才开始流式输出。
 * 取数与 generateMetadata、页面共用同一次请求（post-data.ts）
 */
export default async function Layout({ children, params }: { children: React.ReactNode, params: Promise<{ id: string }> }) {
  const { id } = await params
  await getCanonicalPost(id)
  return <I18nScopeProvider scope="(main)/p/[id]">{children}</I18nScopeProvider>
}
