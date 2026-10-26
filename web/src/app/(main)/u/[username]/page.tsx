import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { getUserByUsername } from '@/api/user'
import { isNotFoundLikeError } from '@/utils/common/error'
import { formatDisplayName } from '@/utils/common/username'
import { UserPage } from './user'

// 元信息与页面共享同一次请求；仅明确不存在时当作 404，其余错误交给错误边界
const getCachedUser = cache(async (username: string) => {
  return getUserByUsername(username)
    .then(r => r.data)
    .catch((error) => {
      if (isNotFoundLikeError(error))
        return null
      throw error
    })
})

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>
}): Promise<Metadata> {
  const { username } = await params
  const user = await getCachedUser(username)
  if (user)
    return { title: formatDisplayName(user) }
  const t = await getTranslations('UserPage')
  return { title: t('user_not_found') }
}

// 用户页主体在客户端拉取，但存在性必须在这里服务端判定：否则 /u/任意字符串 都会返回 200（软 404）
export default async function Page({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params
  const user = await getCachedUser(username)
  if (!user)
    notFound()
  return (
    <div>
      <UserPage />
    </div>
  )
}
