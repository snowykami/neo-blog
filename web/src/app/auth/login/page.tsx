import { Suspense } from 'react'
import { LoginForm } from '@/components/auth/login/login-form'
import { AuthHeader } from '@/components/auth/common/auth-header'

function LoginPageContent() {
  return (
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <AuthHeader />
        <LoginForm />
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={(
      <div className="bg-muted flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
        <div className="flex w-full max-w-sm flex-col gap-6">
          <div className="animate-pulse">
            <div className="flex items-center gap-3 self-center mb-6">
              <div className="size-10 bg-gray-300 rounded-full"></div>
              <div className="h-8 bg-gray-300 rounded w-32"></div>
            </div>
            <div className="bg-white rounded-lg p-6 space-y-4">
              <div className="h-4 bg-gray-300 rounded w-3/4"></div>
              <div className="h-4 bg-gray-300 rounded w-1/2"></div>
              <div className="h-10 bg-gray-300 rounded"></div>
              <div className="h-10 bg-gray-300 rounded"></div>
            </div>
          </div>
        </div>
      </div>
    )}
    >
      <LoginPageContent />
    </Suspense>
  )
}
