import { notFound } from 'next/navigation'
import { cache } from 'react'
import { getUserByUsername } from '@/api/user'
import { isNotFoundLikeError } from '@/utils/common/error'

// layout、generateMetadata 与页面共享同一次请求；仅明确不存在时当作 404，其余错误交给错误边界
const getCachedUser = cache(async (username: string) => {
  return getUserByUsername(username)
    .then(r => r.data)
    .catch((error) => {
      if (isNotFoundLikeError(error))
        return null
      throw error
    })
})

/** 取用户，不存在时 404；由 layout.tsx 在 loading.tsx 的骨架流出之前调用，状态码才是真正的 404 */
export async function getExistingUser(username: string) {
  const user = await getCachedUser(username)
  if (!user)
    notFound()
  return user
}
