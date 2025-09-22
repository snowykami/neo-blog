import { AuthHeader } from "@/components/auth/common/auth-header";
import { ResetPasswordForm } from "@/components/auth/reset-password/reset-password-form";
export default function Page() {
  return (
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <AuthHeader />
        <ResetPasswordForm />
      </div>
    </div>
  )
}