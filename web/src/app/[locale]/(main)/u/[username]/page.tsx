import type { Metadata } from 'next'
import { getLocale } from 'next-intl/server'
import { localeAlternates } from '@/i18n/alternates'
import { getUserUrl } from '@/utils/common/route'
import { formatDisplayName } from '@/utils/common/username'
import { UserPage } from './user'
import { getExistingUser } from './user-data'

// 用户页按 ISR 缓存：构建时不预渲染，每个用户（每种语言）在第一次被访问时生成；用户资料变化时 users 标签失效（见 lib/cache-tags.ts）。
// 页面主体（文章、评论、点赞列表）在浏览器里取，服务端只判定存在性与标题
export function generateStaticParams() {
  return []
}

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
