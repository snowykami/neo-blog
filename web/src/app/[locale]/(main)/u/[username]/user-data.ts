import { unstable_cache } from 'next/cache'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { getUserByUsername } from '@/api/user'
import { CacheTag, DETAIL_REVALIDATE_SECONDS, nullIfNotFound, UncachedNotFound } from '@/lib/cache-tags'
import { isNotFoundLikeError } from '@/utils/common/error'

// 跨请求缓存（各语言的页面共用一条）：用户页按 ISR 缓存，视口预取与重新生成先读这里；用户资料变化时 users 标签失效。
// 仅明确不存在时当作 404（不缓存，见 UncachedNotFound），其余错误交给错误边界、同样不进缓存
const loadUser = unstable_cache(
  async (username: string) => getUserByUsername(username)
    .then(r => r.data)
    .catch((error) => {
      if (isNotFoundLikeError(error))
        throw new UncachedNotFound()
      throw error
    }),
  ['user-by-username'],
  { revalidate: DETAIL_REVALIDATE_SECONDS, tags: [CacheTag.Users] },
)

// layout、generateMetadata 与页面共享同一次读取
const getCachedUser = cache((username: string) => loadUser(username).catch(nullIfNotFound))

/** 取用户，不存在时 404；由 layout.tsx 在 loading.tsx 的骨架流出之前调用，状态码才是真正的 404 */
export async function getExistingUser(username: string) {
  const user = await getCachedUser(username)
  if (!user)
    notFound()
  return user
}
