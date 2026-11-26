import type { Post } from '@/models/post'
import type { User } from '@/models/user'
import { cacheLife, cacheTag } from 'next/cache'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { listPosts } from '@/api/post'
import { getUserByUsername } from '@/api/user'
import { CacheTag, skipBackendAtBuild } from '@/lib/cache-tags'
import { OrderBy } from '@/models/common'
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
 * 取用户，不存在时触发 404（404 不写进缓存，见 CacheTag.NoStore）
 */
export async function getExistingUser(username: string): Promise<User> {
  const user = await getCachedUser(username)
  if (!user)
    notFound()
  return user
}

export interface UserInitialPostsData {
  posts: Post[]
  total: number
}

function slimUserPost(post: Post): Post {
  return post.description || post.excerpt ? { ...post, content: '' } : post
}

async function loadUserFirstPagePosts(userId: number, pageSize: number): Promise<UserInitialPostsData> {
  'use cache'
  cacheLife('detail')
  cacheTag(CacheTag.Posts, CacheTag.Users)
  const res = await listPosts({
    userId,
    page: 1,
    size: pageSize,
    orderBy: OrderBy.CreatedAt,
    desc: true,
  })
  return {
    posts: (res.data.posts || []).map(slimUserPost),
    total: res.data.total || 0,
  }
}

export const getCachedUserFirstPagePosts = cache((userId: number, pageSize: number): Promise<UserInitialPostsData> => {
  skipBackendAtBuild()
  return loadUserFirstPagePosts(userId, pageSize)
})
