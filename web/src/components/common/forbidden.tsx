'use client'
import ErrorPage from '@/components/common/error-page'
import { useCommonT } from '@/hooks/use-translations'

export default function Forbidden() {
  const commonT = useCommonT()
  return <ErrorPage status={403} message={commonT('forbidden')} />
}
