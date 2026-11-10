import type { Post } from '@/models/post'
import { usePathname, useRouter } from '@/i18n/navigation'
import { splitLocalePrefix } from '@/i18n/routing'
import { consolePath, getPostViewUrl, getUserUrl } from '@/utils/common/route'

/**
 * 用于跳转到登录页并自动带上 redirect_back 参数
 * 用法：const toLogin = useToLogin(); <Button onClick={toLogin}>去登录</Button>
 */
export const authPath = '/auth'
export const loginPath = `${authPath}/login`
export const registerPath = `${authPath}/register`
export const resetPasswordPath = `${authPath}/reset-password`

/**
 * 登录 / 注册后回到的地址（查询参数 redirect_back）：不带语言前缀的站内路径，跳转时由导航按当前语言补上前缀。
 * 万一带了前缀（/en/p/x）先去掉，避免跳到 /en/en/p/x
 */
export function readRedirectBack(searchParams: Pick<URLSearchParams, 'get'>): string {
  const value = searchParams.get('redirect_back') || '/'
  return value.startsWith('/') && !value.startsWith('//') ? splitLocalePrefix(value).pathname : value
}

export function useToLogin() {
  const router = useRouter()
  const pathname = usePathname()
  return () => {
    router.push(`${loginPath}?redirect_back=${encodeURIComponent(pathname)}`)
  }
}

export function useToUserProfile() {
  const router = useRouter()
  return (username: string) => {
    router.push(getUserUrl({ username }))
  }
}

// 后台的「查看」：私密文章只在后台可见，打开后台预览；公开文章打开前台文章页
export function useToPost() {
  const router = useRouter()
  return ({ post }: { post: Post }) => {
    router.push(getPostViewUrl(post))
  }
}

export function useToEditPost() {
  const router = useRouter()
  return ({ post }: { post: Post }) => {
    router.push(`${consolePath.post}/edit/${post.id}`)
  }
}
