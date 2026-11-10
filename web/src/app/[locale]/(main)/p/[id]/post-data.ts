import { getLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { getPostByIdServer } from '@/api/post.server'
import { permanentRedirect } from '@/i18n/navigation'
import { isNotFoundLikeError } from '@/utils/common/error'
import { getPostUrl } from '@/utils/common/route'

// 同一请求内 layout、generateMetadata 与页面共用一次请求（React cache 只在单次请求内去重）
// 不带登录身份，所有人看到的一样：私密文章对所有人 404，草稿在后台预览里看（/console/posts/preview/[id]）
const getCachedPost = cache(async (id: string) => {
  return getPostByIdServer({ id })
    .then(res => res.data)
    .catch((error) => {
      // 仅在后端明确表示不存在 / 无权查看 / 参数非法时视为 404，其余错误交给错误边界，避免把 500、超时显示成 404
      if (isNotFoundLikeError(error))
        return null
      throw error
    })
})

/**
 * 取文章并判定地址：不存在 → 404；用 id 访问但文章有 slug → 永久跳转到规范地址（保持当前语言：/en/p/123 → /en/p/slug）。
 * 由 layout.tsx 在 loading.tsx 的骨架流出之前调用，状态码才是真正的 404 / 308（见 layout.tsx）
 */
export async function getCanonicalPost(id: string) {
  const post = await getCachedPost(id)
  if (!post)
    notFound()
  if (post.slug && post.slug !== id)
    permanentRedirect({ href: getPostUrl({ post }), locale: await getLocale() })
  return post
}
