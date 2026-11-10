import type { Metadata } from 'next'
import { getLocale } from 'next-intl/server'
import { localeAlternates } from '@/i18n/alternates'
import { getUserUrl } from '@/utils/common/route'
import { formatDisplayName } from '@/utils/common/username'
import { UserPage } from './user'
import { getExistingUser } from './user-data'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>
}): Promise<Metadata> {
  const { username } = await params
  // 与 layout 共用同一次请求；不存在的用户已在 layout 判定 404（见 layout.tsx）
  const user = await getExistingUser(username)
  return { title: formatDisplayName(user), alternates: localeAlternates(getUserUrl(user), await getLocale()) }
}

// 用户页主体在客户端拉取；存在性在 layout 里服务端判定
export default function Page() {
  return (
    <div>
      <UserPage />
    </div>
  )
}
