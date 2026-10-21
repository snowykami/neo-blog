'use client'

import { ErrorBoundaryPage } from '@/components/common/error-boundary-page'

export default function RouteError(props: { error: Error & { digest?: string }, reset: () => void }) {
  return <ErrorBoundaryPage {...props} />
}
