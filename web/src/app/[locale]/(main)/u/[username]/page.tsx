import type { Metadata } from 'next'
import { localeAlternates } from '@/i18n/alternates'
import { resolveRouteLocale } from '@/i18n/routing'
import { BUILD_PLACEHOLDER_PARAM } from '@/lib/cache-tags'
import { getUserUrl } from '@/utils/common/route'
import { formatDisplayName } from '@/utils/common/username'
import { UserPage } from './user'
import { getExistingUser } from './user-data'

// 用户页按地址缓存：构建时只预渲染占位参数（见 lib/cache-tags.ts 的 BUILD_PLACEHOLDER_PARAM），每个用户（每种语言）在第一次被访问时生成；
// 用户资料变化时 users 标签失效（见 lib/cache-tags.ts）。服务端取资料（存在性、标题与资料卡），文章、评论、点赞列表在浏览器里取
export function generateStaticParams() {
  return [{ username: BUILD_PLACEHOLDER_PARAM }]
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string, username: string }>
}): Promise<Metadata> {
  const { locale: rawLocale, username } = await params
  const locale = resolveRouteLocale(rawLocale)
  // 与页面共用同一次读取；不存在的用户判定 404
  const user = await getExistingUser(username)
  return { title: formatDisplayName(user), alternates: localeAlternates(getUserUrl(user), locale) }
}

// 资料在服务端取好直接传给页面（首帧即是完整资料卡，浏览器不再取）；文章、评论、点赞列表在浏览器里取。
// 段级骨架由同目录 loading.tsx 提供（属于所有用户页共用的 App Shell）
export default async function Page({ params }: { params: Promise<{ locale: string, username: string }> }) {
  const { username } = await params
  const user = await getExistingUser(username)
  return <UserPage user={user} />
}
