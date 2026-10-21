'use client'
import ErrorPage from '@/components/common/error-page'
import { useCommonT } from '@/hooks/use-translations'

// 根级 404：未匹配的 URL 以及 (main) 以外路由（如 /page/[id]）调用 notFound() 时使用
export default function NotFound() {
  const commonT = useCommonT()
  return <ErrorPage status={404} message={commonT('not_found')} />
}
