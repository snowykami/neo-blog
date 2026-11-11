import type { Post } from '@/models/post'
import { getLocale } from 'next-intl/server'
import { cacheLife, cacheTag } from 'next/cache'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { getPostByIdServer } from '@/api/post.server'
import { permanentRedirect } from '@/i18n/navigation'
import { CacheTag, skipBackendAtBuild } from '@/lib/cache-tags'
import { isNotFoundLikeError } from '@/utils/common/error'
import { getPostUrl } from '@/utils/common/route'

// 跨请求缓存（按 id / slug 分条，各语言的页面共用一条）：文章页按地址缓存，各语言的首次生成、悬停时的按链接预取、后台重新生成都先读这里。
// 后端改了文章、分类、标签后 posts 标签失效（见 lib/cache-tags.ts），下次访问重新取。
// 不带登录身份，所有人看到的一样：私密文章对所有人 404，草稿在后台预览里看（/console/posts/preview/[id]）。
// 仅在后端明确表示不存在 / 无权查看 / 参数非法时视为 404，不缓存（CacheTag.NoStore）；其余错误直接抛出，同样不进缓存，
// 交给错误边界，避免把 500、超时显示成 404
async function loadPost(id: string): Promise<Post | null> {
  'use cache'
  cacheLife('detail')
  cacheTag(CacheTag.Posts)
  try {
    return (await getPostByIdServer({ id })).data
  }
  catch (error) {
    if (!isNotFoundLikeError(error))
      throw error
    cacheTag(CacheTag.NoStore)
    return null
  }
}

// 同一请求内 generateMetadata 与页面共用一次读取
const getCachedPost = cache((id: string) => {
  skipBackendAtBuild()
  return loadPost(id)
})

/**
 * 取文章并判定地址：不存在 → 404；用 id 访问但文章有 slug → 永久跳转到规范地址（保持当前语言：/en/p/123 → /en/p/slug）。
 * 在 loading.tsx 的骨架里面调用也能得到真正的 404 / 308：文档请求访问还没缓存的地址时，Next 先把整页生成完再发送
 * （根参数 [locale] 不在构建期生成，见 lib/cache-tags.ts 的 BUILD_PLACEHOLDER_PARAM），生成期间的 notFound() / permanentRedirect()
 * 会设置状态码；生成好的 308 按地址缓存，404 不缓存（见 web/cache-handler.mjs）
 */
export async function getCanonicalPost(id: string): Promise<Post> {
  const post = await getCachedPost(id)
  if (!post)
    notFound()
  if (post.slug && post.slug !== id)
    permanentRedirect({ href: getPostUrl({ post }), locale: await getLocale() })
  return post
}
