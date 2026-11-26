'use client'

import type { UserInitialPostsData } from './user-data'
import type { User } from '@/models/user'
import { useEffect, useRef, useState } from 'react'
import { getUserByUsername } from '@/api/user'
import { SiteShell } from '@/components/layout/site-shell'
import { UserContentTabs } from '@/components/user/user-content-tabs'
import { UserHeader } from '@/components/user/user-header'
import { getUserUrl } from '@/utils/common/route'

/**
 * 用户主页：资料由服务端取好传进来（页面按地址缓存，见 page.tsx），首帧就是完整的资料卡，浏览器不再取一次。
 * 与登录态有关的部分（本人的邮箱、能否查看「喜欢」）由各组件按 useAuth 补上。
 * 被 Activity 保留的页面重新显示时，先照旧显示已有资料，再在后台取一次最新的（资料可能刚在后台改过），取不到时保持原样
 */
export function UserPage({ user: initialUser, initialPosts }: { user: User, initialPosts?: UserInitialPostsData }) {
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
      <UserContentTabs userId={user.id} baseUrl={getUserUrl(user)} showLikes={!!user.showLikes} initialPosts={initialPosts} />
    </SiteShell>
  )
}
