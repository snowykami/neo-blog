'use client'
import ErrorPage from '@/components/common/error-page'
import { useCommonT } from '@/hooks/use-translations'

// 根布局这一级的 404：(main) 以外的路由（如后台、/auth）调用 notFound() 时使用；未匹配的前台地址见 (main)/[...rest]，语言段不认识时见 app/global-not-found.tsx
export default function NotFound() {
  const commonT = useCommonT()
  return <ErrorPage status={404} message={commonT('not_found')} />
}
