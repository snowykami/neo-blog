
import { Post } from "@/models/post"
import { useRouter, usePathname } from "next/navigation"

/**
 * 用于跳转到登录页并自动带上 redirect_back 参数
 * 用法：const toLogin = useToLogin(); <Button onClick={toLogin}>去登录</Button>
 */
export const authPath = "/auth"
export const loginPath = authPath + "/login"
export const registerPath = authPath + "/register"
export const resetPasswordPath = authPath + "/reset-password"

export const consolePath = {
  dashboard: "/console",
  post: "/console/post",
  comment: "/console/comment",
  file: "/console/file",
  user: "/console/user",
  global: "/console/global",
  userProfile: "/console/user-profile",
  userSecurity: "/console/user-security",
  userPreference: "/console/user-preference",
}

export function useToLogin() {
  const router = useRouter()
  const pathname = usePathname()
  return () => {
    router.push(`${loginPath}?redirect_back=${encodeURIComponent(pathname)}`)
  }
}

export function useToUserProfile() {
  const router = useRouter();
  return (username: string) => {
    router.push(`/u/${username}`);
  };
}

export function useToPost(){
  const router = useRouter();
  return ({post}:{post: Post}) => {
    router.push(`/p/${post.id}`);
  };
}

export function useToEditPost(){
  const router = useRouter();
  return ({post}:{post: Post}) => {
    router.push(`${consolePath.post}/edit/${post.id}`);
  };
}