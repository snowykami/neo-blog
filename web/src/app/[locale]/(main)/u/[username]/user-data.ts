import type { User } from '@/models/user'
import { cacheLife, cacheTag } from 'next/cache'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { getUserByUsername } from '@/api/user'
import { CacheTag, skipBackendAtBuild } from '@/lib/cache-tags'
import { isNotFoundLikeError } from '@/utils/common/error'

// 跨请求缓存（各语言的页面共用一条）：用户页按地址缓存，按链接预取与重新生成先读这里；用户资料变化时 users 标签失效。
// 仅明确不存在时当作 404（不缓存，见 CacheTag.NoStore），其余错误交给错误边界、同样不进缓存
async function loadUser(username: string): Promise<User | null> {
  'use cache'
  cacheLife('detail')
  cacheTag(CacheTag.Users)
  try {
    return (await getUserByUsername(username)).data
  }
  catch (error) {
    if (!isNotFoundLikeError(error))
      throw error
    cacheTag(CacheTag.NoStore)
    return null
  }
}

// generateMetadata 与页面共享同一次读取
const getCachedUser = cache((username: string) => {
  skipBackendAtBuild()
  return loadUser(username)
})

/**
 * 取用户，不存在时 404。在 loading.tsx 的骨架里面调用也能得到真正的 404：文档请求访问还没缓存的地址时，
 * Next 先把整页生成完再发送（见 p/[id]/post-data.ts 的说明）
 */
export async function getExistingUser(username: string): Promise<User> {
  const user = await getCachedUser(username)
  if (!user)
    notFound()
  return user
}
