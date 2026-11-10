import { getLocale } from 'next-intl/server'
import { unstable_cache } from 'next/cache'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { getPostByIdServer } from '@/api/post.server'
import { permanentRedirect } from '@/i18n/navigation'
import { CacheTag, DETAIL_REVALIDATE_SECONDS, nullIfNotFound, UncachedNotFound } from '@/lib/cache-tags'
import { isNotFoundLikeError } from '@/utils/common/error'
import { getPostUrl } from '@/utils/common/route'

// 跨请求缓存（按 id / slug 分条，各语言的页面共用一条）：文章页按 ISR 缓存，视口预取、各语言的首次生成、后台重新生成都先读这里。
// 后端改了文章、分类、标签后 posts 标签失效（见 lib/cache-tags.ts），下次访问重新取。
// 不带登录身份，所有人看到的一样：私密文章对所有人 404，草稿在后台预览里看（/console/posts/preview/[id]）。
// 不存在的文章不缓存（见 UncachedNotFound）；其余错误直接抛出，同样不进缓存
const loadPost = unstable_cache(
  async (id: string) => getPostByIdServer({ id })
    .then(res => res.data)
    .catch((error) => {
      // 仅在后端明确表示不存在 / 无权查看 / 参数非法时视为 404，其余错误交给错误边界，避免把 500、超时显示成 404
      if (isNotFoundLikeError(error))
        throw new UncachedNotFound()
      throw error
    }),
  ['post-detail'],
  { revalidate: DETAIL_REVALIDATE_SECONDS, tags: [CacheTag.Posts] },
)

// 同一请求内 layout、generateMetadata 与页面共用一次读取（React cache 只在单次请求内去重）
const getCachedPost = cache((id: string) => loadPost(id).catch(nullIfNotFound))

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
