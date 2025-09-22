
import { useRouter, usePathname } from "next/navigation"

/**
 * 用于跳转到登录页并自动带上 redirect_back 参数
 * 用法：const toLogin = useToLogin(); <Button onClick={toLogin}>去登录</Button>
 */
export const loginPath = "/login"
export const resetPasswordPath = "/reset-password"

export function useToLogin() {
  const router = useRouter()
  const pathname = usePathname()
  return () => {
    router.push(`${loginPath}?redirect_back=${encodeURIComponent(pathname)}`)
  }
}

export function useToResetPassword() {
  const router = useRouter()
  const pathname = usePathname()
  return () => {
    router.push(`${resetPasswordPath}?redirect_back=${encodeURIComponent(pathname)}`)
  }
}

export function useToUserProfile() {
  const router = useRouter();
  return (username: string) => {
    router.push(`/u/${username}`);
  };
}

