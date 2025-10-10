'use client'
import ErrorPage from '@/components/common/error-page'
import { useCommonT } from '@/hooks/use-translations'

export default function NotFound() {
  const commonT = useCommonT()
  return <ErrorPage status={404} message={commonT('not_found')} />
}
