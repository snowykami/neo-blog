'use client'

import type { User } from '@/models/user'
import { useEffect, useRef, useState } from 'react'
import { getUserByUsername } from '@/api/user'
import { PostList } from '@/components/blog-home/post-list'
import { SiteShell } from '@/components/layout/site-shell'
import { Skeleton } from '@/components/ui/skeleton'
import { UserContentTabs } from '@/components/user/user-content-tabs'
import { UserHeader } from '@/components/user/user-header'
import { useSiteInfo } from '@/contexts/site-info-context'

/**
 * 用户主页骨架：路由切换时的 loading.tsx 用它（也是整页加载时先出的静态外壳），版式与真实页面一致：
 * 资料卡 + 标签栏 + 文章列表（与列表加载态相同的行数），正文流进来替换时页脚不会从页面中部被顶下去
 */
export function UserPageSkeleton() {
  const { siteInfo } = useSiteInfo()
  return (
    <SiteShell skeleton>
      <div className="flex flex-col items-center gap-5 rounded-2xl bg-card p-6 md:flex-row md:gap-6 md:p-8" aria-busy="true">
        <Skeleton className="size-28 shrink-0 rounded-full md:size-32" />
        <div className="grid w-full max-w-sm justify-items-center gap-3 md:justify-items-start">
          <div className="grid justify-items-center gap-1 md:justify-items-start">
            <Skeleton className="h-8 w-48 md:h-9" />
            <Skeleton className="h-6 w-32" />
          </div>
          <Skeleton className="h-7 w-64 max-w-full" />
        </div>
      </div>
      {/* 与 UserContentTabs、UserPosts 的结构一致：标签栏，文章标题，列表加载态 */}
      <div className="grid gap-4">
        <Skeleton className="mx-4 h-9 w-64 md:mx-2" />
        <section className="grid gap-4">
          <Skeleton className="mx-4 h-7 w-32 md:mx-2 md:h-8" />
          <PostList posts={[]} isLoading skeletonCount={siteInfo.postsPerPage || 10} />
        </section>
      </div>
    </SiteShell>
  )
}

/**
 * 用户主页：资料由服务端取好传进来（页面按地址缓存，见 page.tsx），首帧就是完整的资料卡，浏览器不再取一次。
 * 与登录态有关的部分（本人的邮箱、能否查看「喜欢」）由各组件按 useAuth 补上。
 * 被 Activity 保留的页面重新显示时，先照旧显示已有资料，再在后台取一次最新的（资料可能刚在后台改过），取不到时保持原样
 */
export function UserPage({ user: initialUser }: { user: User }) {
  // 后台刷新得到的资料；记下它基于哪一份服务端资料，服务端给了新的（router.refresh、换了用户）时以服务端为准
  const [refreshed, setRefreshed] = useState<{ base: User, user: User } | null>(null)
  const user = refreshed?.base === initialUser ? refreshed.user : initialUser
  // 首次挂载不刷新（资料刚由服务端取到）；之后每次 effect 重新执行即为 Activity 重新显示
  const shownRef = useRef(false)
  // 服务端给了新资料时不必再取，只在重新显示时取：effect 只依赖用户名，资料本身从 ref 读
  const initialUserRef = useRef(initialUser)
  initialUserRef.current = initialUser
  const username = initialUser.username
  useEffect(() => {
    if (!shownRef.current) {
      shownRef.current = true
      return
    }
    let cancelled = false
    getUserByUsername(username)
      .then((res) => {
        if (!cancelled && res.data)
          setRefreshed({ base: initialUserRef.current, user: res.data })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [username])

  return (
    <SiteShell>
      <UserHeader user={user} />
      <UserContentTabs userId={user.id} showLikes={!!user.showLikes} />
    </SiteShell>
  )
}
