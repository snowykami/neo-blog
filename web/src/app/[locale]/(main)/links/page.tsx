import type { Metadata } from 'next'
import type { PublicFriendsData } from '@/models/friend'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { locale as rootLocale } from 'next/root-params'
import { connection } from 'next/server'
import { Suspense } from 'react'
import { getPublicFriends } from '@/api/friend'
import BlogSidebar from '@/components/blog-sidebar'
import { getCachedSidebarData } from '@/components/blog-sidebar/sidebar-data'
import { BlogSidebarSkeleton } from '@/components/blog-sidebar/sidebar-skeleton'
import { SiteShell } from '@/components/layout/site-shell'
import { Skeleton } from '@/components/ui/skeleton'
import { localeAlternates } from '@/i18n/alternates'
import { resolveRouteLocale } from '@/i18n/routing'
import { skipBackendAtBuild } from '@/lib/cache-tags'
import { mainPath } from '@/utils/common/route'
import { FriendsDirectory } from './friends-directory'

export async function generateMetadata(): Promise<Metadata> {
  const locale = resolveRouteLocale(await rootLocale())
  setRequestLocale(locale)
  const routeT = await getTranslations('Route')
  return {
    title: routeT('friends'),
    alternates: localeAlternates(mainPath.friends, locale),
  }
}

const EMPTY_PUBLIC_FRIENDS: PublicFriendsData = {
  groups: [],
  siteInfo: {
    name: '',
    url: '',
    avatar: '',
    description: '',
  },
}

async function FriendsContent() {
  // 构建期占位预渲染先短路退出，保留静态外壳预取提示位
  skipBackendAtBuild()
  await connection()
  const [friendsRes, sidebarData] = await Promise.all([
    getPublicFriends().catch(() => null),
    getCachedSidebarData(),
  ])
  const initialData = friendsRes?.data ?? EMPTY_PUBLIC_FRIENDS
  return (
    <SiteShell sidebar={<BlogSidebar initialData={sidebarData} />}>
      <FriendsDirectory initialData={initialData} />
    </SiteShell>
  )
}

function FriendsSkeleton() {
  return (
    <SiteShell skeleton sidebar={<BlogSidebarSkeleton />}>
      <div className="grid gap-4" aria-busy="true">
        <div className="surface-card grid gap-3 rounded-2xl bg-card p-5 md:p-6">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <div className="surface-card grid gap-4 rounded-2xl bg-card p-5 md:p-6">
          <Skeleton className="h-6 w-28" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-[74px] w-full rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    </SiteShell>
  )
}

export default function FriendsPage() {
  return (
    <Suspense fallback={<FriendsSkeleton />}>
      <FriendsContent />
    </Suspense>
  )
}
